import test from "node:test"; import assert from "node:assert/strict";
import { rampCap, canPost, countReq, recordPost, emptyState, isDup, makeText, CFG } from "../x_lib.mjs";
const T0 = Date.parse("2026-10-30T10:00:00Z"), H = 3600e3, D = 24 * H;
test("ramp caps", () => { assert.deepEqual([1, 3, 4, 7, 8, 20].map(rampCap), [3, 3, 5, 5, 8, 8]); });
test("daily cap + spacing", () => {
  const s = emptyState(); let t = T0;
  for (let i = 0; i < 3; i++) { assert.ok(canPost(s, t).ok, "post " + i); recordPost(s, t); t += 2 * H + 1; }
  assert.match(canPost(s, t).why, /daily cap 3/);
  assert.match(canPost(s, T0 + 1 * H).why ?? "", /cap|spacing/);
  assert.ok(canPost(s, T0 + D + 3 * H).ok, "next day, day 2 still cap 3");
});
test("spacing blocks within 2 h", () => { const s = emptyState(); recordPost(s, T0); assert.match(canPost(s, T0 + 1.9 * H).why, /spacing/); assert.ok(canPost(s, T0 + 2 * H).ok); });
test("day 4 cap 5, week 2 cap 8", () => { const s = emptyState(); recordPost(s, T0); const d4 = T0 + 3 * D; for (let i = 0; i < 4; i++) recordPost(s, d4 + i * 2.1 * H); assert.ok(canPost(s, d4 + 8.4 * H).ok); recordPost(s, d4 + 8.4 * H); assert.match(canPost(s, d4 + 10.6 * H).why, /daily cap 5/); });
test("request counter hard stop at 80", () => { const s = emptyState(); countReq(s, T0, 77); assert.ok(canPost(s, T0).ok, "77+3=80 still allowed"); countReq(s, T0, 1); assert.match(canPost(s, T0).why, /hard stop/); });
test("request counter resets next day", () => { const s = emptyState(); countReq(s, T0, 79); assert.ok(canPost(s, T0 + D).ok); });
test("duplicate text skipped", () => {
  const m = { address: "0xabc0000000000000000000000000000000000001", coin: "BTC", side: "LONG", sizeCoin: 70.9, notional: 5.5e6, lev: 10, entry: 81151, label: "Whale 0xabc0…0001", rank: 5, pnl30: 1.5e6, roi: 0.26 };
  const p = makeText(m); const h = [{ key: p.key, text: p.text }];
  assert.ok(isDup(p.text, p.key, h)); assert.ok(isDup(makeText({ ...m, address: "0xabc0000000000000000000000000000000000002" }).text.replace(/0002/g, "0001"), "other", h));
  assert.ok(!isDup(makeText({ ...m, coin: "ETH", sizeCoin: 900, notional: 2e6, entry: 2300, label: "Whale 0xdef0…0009", address: "0xdef0000000000000000000000000000000000009", rank: 40, pnl30: 9e5 }).text, "k2", h));
  assert.ok(p.text.length < 280 && (p.text.match(/#/g) || []).length <= 2 && !p.text.includes("@"));
});
