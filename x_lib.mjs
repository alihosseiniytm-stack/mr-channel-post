// Pure helpers for x_post.mjs: formatting, post text, duplicate check, ramp cap, spacing, Buffer request counter. No network here (unit-tested).
export const CFG = {
  MIN_MOVE_USD: 1e6,        // event threshold: whale opened/added >= this in the freshness window
  FRESH_MS: 2 * 3600e3,     // data of THAT moment: fill must be <= 2 h old
  SPACING_MS: 2 * 3600e3,   // legacy (10-30); T50-09 timing uses TIMING.SPACING_MIN (90 min) below
  REQ_HARD_STOP: 80,        // Buffer free: 100 requests / 24 h -> stop at 80
  MIN_TRADES: 10, MIN_WIN: 0.55, // whale quality gate (owner-approved 10-30 11:05Z): positive 30d profit AND win rate >= 55% over >= 10 closed trades (/whale-stats)
  REQ_PER_POST: 3,          // budget reserved per post (createPost = 1 in practice)
};
export const usd = (n) => { const a = Math.abs(n); return "$" + (a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + "M" : a >= 1e3 ? (a / 1e3).toFixed(0) + "K" : a.toFixed(0)); };
export const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
export const px = (n) => (n >= 1000 ? Math.round(n).toLocaleString("en-US") : n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toPrecision(3));
export const qty = (n) => { const a = Math.abs(n); return a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e4 ? Math.round(a).toLocaleString("en-US") : a >= 100 ? a.toFixed(0) : a.toFixed(1); };
export const sg = (n) => (n >= 0 ? "+" : "-") + usd(n);
export const sizeEmoji = (v) => (v >= 1e7 ? "🐋🐋" : v >= 5e6 ? "🐋" : v >= 2e6 ? "🐳" : "🦈");

const norm = (t) => t.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
export const sim = (a, b) => { const A = new Set(norm(a)), B = new Set(norm(b)); let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i || 1); };
export const isDup = (text, key, h) => h.some((p) => p.key === key || sim(p.text, text) >= 0.8);

export const qualifies = (st, pnl30) => !!st && st.trades >= CFG.MIN_TRADES && st.winRate >= CFG.MIN_WIN && pnl30 > 0;
export const wlabel = (st) => `Whale · ${Math.round(st.winRate * 100)}% win rate`;

// m = {address, coin, side:"LONG"|"SHORT", sizeCoin, notional, lev, entry, label, rank, pnl30, roi}
export function makeText(m, base = "https://marketradarwhale.com", thread = false) {
  const url = `${base}/go/x/whale/en/whale/${m.address}/`; // T41-21: /go/<src>/<kind>/ = counted click (site Worker), then 302 to the page
  const act = `${m.side} opened${m.lev ? ` at ${m.lev}x` : ""}`;
  const wr = m.win != null ? ` · ${Math.round(m.win * 100)}% win rate (${m.trades} trades)` : "";
  const rec = m.rank ? `📊 Track record: No. ${m.rank} on the Radar Top 100 this month, ${sg(m.pnl30)} profit${wr}`
                     : m.pnlMonth != null ? `📊 Track record: ${sg(m.pnlMonth)} this month${wr}` : `📊 Track record: full trade history on its page`;
  const text = `${sizeEmoji(m.notional)} ${qty(m.sizeCoin)} ${m.coin} (${usd(m.notional)}) ${act}
Entry $${px(m.entry)} · ${m.label}
${rec}
${thread ? "" : url + "\n"}#${m.coin} #crypto`;
  return { text, url, reply: thread ? `Full trade history of this whale 👇\n${url}` : null, key: m.address + ":" + m.coin + ":" + m.side };
}

export const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
export const emptyState = () => ({ start: null, days: {}, last: null });
export function dayIndex(state, now) { return state.start ? Math.floor((Date.parse(dayKey(now)) - Date.parse(state.start)) / 864e5) + 1 : 1; }
// ramp (owner 10-30 10:15Z): days 1-3 = 3/day, days 4-7 = 5/day, week 2+ = 8/day
export const rampCap = (idx) => (idx <= 3 ? 3 : idx <= 7 ? 5 : 8);
// T50-09 TIMING (2026-11-12, research log MAP/50 "X timing"): normal posts only inside peak windows (UTC), BREAKING (>= $5M whale move /
// big transfer / liquidation) any hour but at most EXTRA per day on top of the ramp cap; >= SPACING_MIN between ANY 2 posts.
// Every number is a repo variable (x-post.yml env): X_PEAK_WINDOWS "02-05,07-10,13-17,19-22", X_BREAKING_MIN, X_BREAKING_EXTRA, X_SPACING_MIN, X_ZERO_POST_H.
const num = (v, d) => (v != null && v !== "" && isFinite(Number(v)) ? Number(v) : d);
export const parseWindows = (str) => String(str || "").split(",").map((w) => w.trim().split("-").map(Number)).filter((w) => w.length === 2 && w.every((h) => h >= 0 && h <= 24) && w[0] !== w[1]);
export function timingCfg(env = (typeof process !== "undefined" ? process.env : {})) {
  const win = parseWindows(env.X_PEAK_WINDOWS || "02-05,07-10,13-17,19-22");
  return { WINDOWS: win.length ? win : parseWindows("02-05,07-10,13-17,19-22"), BREAKING_MIN: num(env.X_BREAKING_MIN, 5e6), BREAKING_EXTRA: num(env.X_BREAKING_EXTRA, 1), SPACING_MIN: num(env.X_SPACING_MIN, 90), ZERO_POST_H: num(env.X_ZERO_POST_H, 24) };
}
export const TIMING = timingCfg();
// [start,end) in UTC hours; a window may wrap midnight ("22-02")
export function inWindow(now, wins = TIMING.WINDOWS) { const d = new Date(now), h = d.getUTCHours() + d.getUTCMinutes() / 60; return wins.some(([a, b]) => (a < b ? h >= a && h < b : h >= a || h < b)); }
// decide(state, now, usd): {ok, kind:"normal"|"breaking", why}. usd = Infinity -> "could ANY event post now?" (pre-check before fetching data)
export function decide(state, now, usd = 0, T = TIMING) {
  const d = state.days[dayKey(now)] || { posts: 0, reqs: 0 }, idx = dayIndex(state, now), cap = Math.min(rampCap(idx), Math.floor(CFG.REQ_HARD_STOP / CFG.REQ_PER_POST));
  if (d.reqs + CFG.REQ_PER_POST > CFG.REQ_HARD_STOP) return { ok: false, why: `Buffer request counter ${d.reqs}/${CFG.REQ_HARD_STOP}: hard stop` };
  if (state.last && now - Date.parse(state.last) < T.SPACING_MIN * 60e3) return { ok: false, why: `spacing < ${T.SPACING_MIN} min since last post (${state.last})` };
  const win = inWindow(now, T.WINDOWS), brk = d.breaking || 0, big = usd >= T.BREAKING_MIN;
  if (win && d.posts < cap) return { ok: true, kind: "normal", why: `peak window, ${d.posts}/${cap} today` };
  if (big && brk < T.BREAKING_EXTRA && d.posts < cap + T.BREAKING_EXTRA) return { ok: true, kind: "breaking", why: `BREAKING ${usd === Infinity ? ">= " + usd_(T.BREAKING_MIN) : usd_(usd)} ${win ? "over daily cap" : "outside peak window"} (${brk}/${T.BREAKING_EXTRA} extra used)` };
  if (!win) return { ok: false, why: `outside peak windows ${T.WINDOWS.map((w) => w.join("-")).join(",")} UTC and ${big ? `breaking extra ${brk}/${T.BREAKING_EXTRA} used` : `${usd_(usd)} < BREAKING ${usd_(T.BREAKING_MIN)}`}` };
  return { ok: false, why: `daily cap ${cap} reached (day ${idx})${big ? `, breaking extra ${brk}/${T.BREAKING_EXTRA} used` : ""}` };
}
const usd_ = (n) => (isFinite(n) ? usd(n) : "any");
// legacy name kept for old callers/tests: same rules for an event of unknown size (normal post only)
export const canPost = (state, now, usdv = 0, T = TIMING) => decide(state, now, usdv, T);
// 0-POSTS ALARM (T50-09 LEFT 3): true when no post went out for ZERO_POST_H hours (state.last = whale + big transfer posts)
export function zeroPosts(state, now, hours = TIMING.ZERO_POST_H) { const t = state && state.last ? Date.parse(state.last) : NaN; return { alarm: !(now - t <= hours * 3600e3), hoursSince: isFinite(t) ? Math.round((now - t) / 360e3) / 10 : null }; }
export function countReq(state, now, n = 1) { const k = dayKey(now); (state.days[k] ||= { posts: 0, reqs: 0 }).reqs += n; }
export function recordPost(state, now, kind = "normal") { const k = dayKey(now); const d = (state.days[k] ||= { posts: 0, reqs: 0 }); d.posts += 1; if (kind === "breaking") d.breaking = (d.breaking || 0) + 1; state.last = new Date(now).toISOString(); if (!state.start) state.start = k; }
