// T50-09 X timing (2026-11-12): peak windows UTC, BREAKING >= $5M any hour (+1/day), 90 min spacing, daily cap, dedupe, 0-posts alarm.
// run: node --test tests/test_x_timing.mjs
import test from "node:test"; import assert from "node:assert/strict";
import { decide, inWindow, parseWindows, timingCfg, recordPost, countReq, emptyState, zeroPosts, isDup, makeText, TIMING } from "../x_lib.mjs";
import { xPick } from "../x_bigtx.mjs";
const T = timingCfg({}), at = (iso) => Date.parse(iso), M = 60e3, H = 3600e3;
const week2 = () => { const s = emptyState(); s.start = "2026-11-01"; return s; }; // day >= 8 -> ramp cap 8

test("defaults: 4 windows, $5M, +1, 90 min, 24 h; repo vars override", () => {
  assert.deepEqual(T.WINDOWS, [[2, 5], [7, 10], [13, 17], [19, 22]]);
  assert.equal(T.BREAKING_MIN, 5e6); assert.equal(T.BREAKING_EXTRA, 1); assert.equal(T.SPACING_MIN, 90); assert.equal(T.ZERO_POST_H, 24);
  const o = timingCfg({ X_PEAK_WINDOWS: "12-14", X_BREAKING_MIN: "7000000", X_SPACING_MIN: "60", X_BREAKING_EXTRA: "2" });
  assert.deepEqual(o.WINDOWS, [[12, 14]]); assert.equal(o.BREAKING_MIN, 7e6); assert.equal(o.SPACING_MIN, 60); assert.equal(o.BREAKING_EXTRA, 2);
  assert.deepEqual(timingCfg({ X_PEAK_WINDOWS: "junk" }).WINDOWS, T.WINDOWS, "bad var -> defaults, never 'no windows'");
  assert.deepEqual(parseWindows("22-02"), [[22, 2]]); assert.ok(inWindow(at("2026-11-12T23:30:00Z"), [[22, 2]]) && inWindow(at("2026-11-12T01:59:00Z"), [[22, 2]]) && !inWindow(at("2026-11-12T02:00:00Z"), [[22, 2]]));
});

test("inside window -> normal post; outside -> skip", () => {
  const s = week2();
  assert.ok(inWindow(at("2026-11-12T14:00:00Z"), T.WINDOWS) && !inWindow(at("2026-11-12T11:00:00Z"), T.WINDOWS));
  assert.ok(inWindow(at("2026-11-12T02:00:00Z"), T.WINDOWS) && !inWindow(at("2026-11-12T05:00:00Z"), T.WINDOWS), "start inclusive, end exclusive");
  const a = decide(s, at("2026-11-12T14:00:00Z"), 1.2e6, T); assert.equal(a.ok, true); assert.equal(a.kind, "normal");
  const b = decide(s, at("2026-11-12T11:00:00Z"), 1.2e6, T); assert.equal(b.ok, false); assert.match(b.why, /outside peak windows/);
});

test("BREAKING outside window: $5M posts, $4.9M does not; only +1 per day", () => {
  const s = week2(), t = at("2026-11-12T11:00:00Z");
  assert.equal(decide(s, t, 4.9e6, T).ok, false, "$4.9M outside window = skip");
  const b = decide(s, t, 5e6, T); assert.equal(b.ok, true); assert.equal(b.kind, "breaking", "$5M exactly = breaking");
  recordPost(s, t, "breaking"); assert.equal(s.days["2026-11-12"].breaking, 1);
  const c = decide(s, at("2026-11-12T23:00:00Z"), 50e6, T); assert.equal(c.ok, false); assert.match(c.why, /breaking extra 1\/1 used/);
  assert.equal(decide(s, at("2026-11-13T11:00:00Z"), 50e6, T).ok, true, "next UTC day: new extra slot");
});

test("spacing: >= 90 min between ANY 2 posts, BREAKING included", () => {
  const s = week2(), t = at("2026-11-12T13:00:00Z"); recordPost(s, t);
  assert.match(decide(s, t + 89 * M, 1e6, T).why, /spacing < 90 min/);
  assert.match(decide(s, t + 89 * M, 100e6, T).why, /spacing/, "breaking still waits 90 min");
  assert.equal(decide(s, t + 90 * M, 1e6, T).ok, true);
});

test("daily cap: ramp cap in windows, then +1 BREAKING over the cap, never more", () => {
  const s = emptyState(); s.start = "2026-11-12"; // day 1 -> cap 3
  let t = at("2026-11-12T02:00:00Z");
  for (const h of ["02:00", "07:00", "13:00"]) { const d = decide(s, at("2026-11-12T" + h + ":00Z"), 1e6, T); assert.ok(d.ok && d.kind === "normal", h); recordPost(s, at("2026-11-12T" + h + ":00Z")); }
  t = at("2026-11-12T19:00:00Z");
  assert.match(decide(s, t, 1e6, T).why, /daily cap 3 reached/);
  const b = decide(s, t, 6e6, T); assert.ok(b.ok && b.kind === "breaking", "+1 breaking over cap"); recordPost(s, t, "breaking");
  assert.equal(decide(s, t + 2 * H, 60e6, T).ok, false, "cap + 1 = hard end of the day");
  assert.equal(s.days["2026-11-12"].posts, 4);
});

test("Buffer request stop still wins (80/day)", () => { const s = week2(), t = at("2026-11-12T14:00:00Z"); countReq(s, t, 78); assert.match(decide(s, t, 9e9, T).why, /hard stop/); });

test("pre-check (usd = Infinity) is open outside windows only while the breaking slot is free", () => {
  const s = week2(), t = at("2026-11-12T11:00:00Z");
  assert.equal(decide(s, t, Infinity, T).ok, true);
  recordPost(s, at("2026-11-12T03:00:00Z"), "breaking");
  assert.equal(decide(s, t, Infinity, T).ok, false);
});

test("dedupe: same whale event / same big transfer id never twice", () => {
  const m = { address: "0xabc0000000000000000000000000000000000001", coin: "BTC", side: "LONG", sizeCoin: 70, notional: 5.5e6, lev: 10, entry: 81000, label: "Whale · 60% win rate", rank: 5, pnl30: 1.5e6 };
  const p = makeText(m); assert.ok(isDup(p.text, p.key, [{ key: p.key, text: p.text }]));
  const now = at("2026-11-12T14:00:00Z"), it = { id: "eth:0x1:1", chain: "eth", usd: 30e6, t: now - 10 * M, tx: "0x1", from: "a", to: "b" };
  assert.equal(xPick([it], [], now, 20e6).id, "eth:0x1:1");
  assert.equal(xPick([it], ["eth:0x1:1"], now, 20e6), null, "posted id is skipped");
});

test("0-posts alarm: 24 h without a post", () => {
  const now = at("2026-11-12T14:00:00Z");
  assert.equal(zeroPosts({ last: "2026-11-12T01:00:00Z" }, now, 24).alarm, false);
  const z = zeroPosts({ last: "2026-11-11T13:59:00Z" }, now, 24); assert.equal(z.alarm, true); assert.equal(z.hoursSince, 24);
  assert.equal(zeroPosts({ last: null }, now, 24).alarm, true, "unknown is never safe");
  assert.equal(zeroPosts(null, now, 24).alarm, true);
  assert.equal(TIMING.ZERO_POST_H > 0, true);
});
