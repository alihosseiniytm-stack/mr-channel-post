// Pure helpers for x_post.mjs: formatting, post text, duplicate check, ramp cap, spacing, Buffer request counter. No network here (unit-tested).
export const CFG = {
  MIN_MOVE_USD: 1e6,        // event threshold: whale opened/added >= this in the freshness window
  FRESH_MS: 2 * 3600e3,     // data of THAT moment: fill must be <= 2 h old
  SPACING_MS: 2 * 3600e3,   // >= 2 h between posts
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
  const url = `${base}/en/whale/${m.address}/`;
  const act = `${m.side} opened${m.lev ? ` at ${m.lev}x` : ""}`;
  const wr = m.win != null ? ` · ${Math.round(m.win * 100)}% win rate (${m.trades} trades)` : "";
  const rec = m.rank ? `📊 Track record: No. ${m.rank} of Hyperliquid whales this month, ${sg(m.pnl30)} profit${wr}`
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
export function canPost(state, now) {
  const d = state.days[dayKey(now)] || { posts: 0, reqs: 0 };
  const cap = rampCap(dayIndex(state, now));
  if (d.posts >= cap) return { ok: false, why: `daily cap ${cap} reached (day ${dayIndex(state, now)})` };
  if (state.last && now - Date.parse(state.last) < CFG.SPACING_MS) return { ok: false, why: "spacing < 2 h since last post" };
  if (d.reqs + CFG.REQ_PER_POST > CFG.REQ_HARD_STOP) return { ok: false, why: `Buffer request counter ${d.reqs}/${CFG.REQ_HARD_STOP}: hard stop` };
  return { ok: true };
}
export function countReq(state, now, n = 1) { const k = dayKey(now); (state.days[k] ||= { posts: 0, reqs: 0 }).reqs += n; }
export function recordPost(state, now) { const k = dayKey(now); (state.days[k] ||= { posts: 0, reqs: 0 }).posts += 1; state.last = new Date(now).toISOString(); if (!state.start) state.start = k; }
