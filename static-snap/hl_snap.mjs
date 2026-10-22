// hl_snap.mjs (2026-10-22, CPU-limit fix): the Hyperliquid whale snapshot, computed ONCE per run here on GitHub instead of per visitor in the bot.
// Before: the bot's /whale-leaderboard and /whale-cards downloaded + parsed Hyperliquid's ~13 MB leaderboard per request (4,407 CPU-limit hits/day,
// 23% 5xx on the board, ~70% on site profiles). Now this job writes small, pre-sliced files to mr-static; the bot and the site read those first and
// keep the live path only as a fallback. Files (all under public/snap/hlb/):
//   meta.json            {at, counts}: freshness stamp (bot + site ignore the snapshot when it is older than 3 h; SENTINEL alarms after 30 min)
//   <win>.json           day/week/month/allTime: top 1000 PROFITABLE traders (pnl > 0, month volume >= $5M), sorted by pnl (bot row shape)
//   all200k-<k>.json     k = 0..9: every active trader (month volume >= $200k, any pnl) sorted by volume, 1000 rows per file (the 10,000 list)
//   addr-<c>.json        c = first hex char after 0x: {address: row} for the 10,000 list (single-wallet lookups for profile pages)
//   cards.json           the /whale-cards answer (top month traders with 30-day fill stats)
//   ../ws/<addr>.json    the /whale-stats answer per wallet (top 500 month wallets + every wallet the page shows elsewhere)
// The fill-stats functions below are copied VERBATIM from whale-alert-worker/src/index.js (tradeLists, orderToTrade, computeFillStats) so the numbers match.
import fs from "node:fs";
import path from "node:path";

const HL_LB = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
const HL_API = "https://api.hyperliquid.xyz/info";
const HL_MIN_MONTH_VOLUME_USD = 5e6; // same as the bot
const WINDOWS = ["day", "week", "month", "allTime"];
const ADDR = /^0x[0-9a-f]{40}$/;

function hlMonthVolume(row) {
  const p = (row.windowPerformances || []).find((x) => x[0] === "month");
  return p && p[1] && p[1].vlm !== undefined ? Number(p[1].vlm) || 0 : 0;
}
function shapeRow(r, win) {
  const perf = (r.windowPerformances || []).find((p) => p[0] === win);
  return { address: r.ethAddress, displayName: r.displayName || null, accountValue: Number(r.accountValue) || 0,
    pnl: perf ? Number(perf[1].pnl) || 0 : 0, roi: perf ? Number(perf[1].roi) || 0 : 0, monthVlm: hlMonthVolume(r) };
}
const put = (dir, name, obj) => { fs.mkdirSync(dir, { recursive: true }); const t = typeof obj === "string" ? obj : JSON.stringify(obj); fs.writeFileSync(path.join(dir, name), t); return t; };

function tradeLists(items) {
  const list = items.map((x) => {
    const notional = Number(x.notional) || 0, net = Number(x.net) || 0;
    return {
      coin: x.coin, side: x.side, net, pct: notional > 0 ? (net / notional) * 100 : null, notional,
      entryPx: x.entryPx !== undefined ? x.entryPx : (x.avgEntryPx !== undefined ? x.avgEntryPx : null),
      exitPx: x.exitPx !== undefined ? x.exitPx : (x.avgExitPx !== undefined ? x.avgExitPx : null),
      openedAt: x.openedAt || null, closedAt: x.closedAt || null, fees: Number(x.fees) || 0,
    };
  });
  const wins = list.filter((x) => x.net > 0), losses = list.filter((x) => x.net < 0);
  // Best / worst = ONE ranking that weighs BOTH the dollar result and the % result (owner 2026-09-29: "one best, chosen by profit money and profit
  // percent"): every candidate gets a rank by $ and a rank by %, the two ranks are added, the lowest sum wins (ties: the bigger $). Dust never
  // competes (P&L under $1, or a position under $100), so "SUI +$0" cannot be the best trade.
  const overallSort = (arr, dir) => {
    const byNet = arr.slice().sort((x, y) => dir * (y.net - x.net));
    const byPct = arr.slice().sort((x, y) => dir * (y.pct - x.pct));
    const rn = new Map(), rp = new Map();
    byNet.forEach((x, i) => rn.set(x, i));
    byPct.forEach((x, i) => rp.set(x, i));
    return arr.slice().sort((x, y) => (rn.get(x) + rp.get(x)) - (rn.get(y) + rp.get(y)) || dir * (y.net - x.net));
  };
  const meaningful = (arr) => arr.filter((x) => x.pct !== null && x.notional >= 100 && Math.abs(x.net) >= 1);
  return {
    allWins: wins.slice().sort((x, y) => y.net - x.net).slice(0, 50),
    allLosses: losses.slice().sort((x, y) => x.net - y.net).slice(0, 50),
    topWins: overallSort(meaningful(wins), 1).slice(0, 5),
    topLosses: overallSort(meaningful(losses), -1).slice(0, 5),
  };
}
// closing ORDER from userFills -> trade: exit = size-weighted fill price, entry = exit -/+ realized pnl per unit (closedPnl is the gross price move)
function orderToTrade(o) {
  const exitPx = o.size ? o.notional / o.size : null;
  const entryPx = o.size && exitPx !== null ? (o.side === "long" ? exitPx - o.gross / o.size : exitPx + o.gross / o.size) : null;
  return { coin: o.coin, side: o.side, net: o.net, notional: o.notional, entryPx, exitPx, openedAt: o.openedAt, closedAt: o.closedAt, fees: o.fees };
}
function computeFillStats(fills, now, days) {
  const cutoff = now - days * 864e5;
  const oldest = fills.length ? Number(fills[fills.length - 1].time) : now;
  const truncated = fills.length >= 2000 && oldest > cutoff;
  const from = truncated ? oldest : cutoff;
  const asc = fills.filter((f) => Number(f.time) >= from).slice().sort((a, b) => Number(a.time) - Number(b.time));
  const orders = {};
  const holds = [];
  const openAt = {}; // coin -> time the current flat->open episode began (only when the fill that opened it is inside the window)
  for (const f of asc) {
    const dir = String(f.dir || "");
    const sz = Math.abs(Number(f.sz)) || 0, px = Number(f.px) || 0, t = Number(f.time);
    const start = Number(f.startPosition) || 0;
    const signed = f.side === "B" ? sz : -sz;
    if (Math.abs(start) < 1e-9 && sz > 0) openAt[f.coin] = t;
    const end = start + signed;
    let episodeStart = null;
    if (Math.abs(end) < 1e-9 && openAt[f.coin] !== undefined && Math.abs(start) > 1e-9) { episodeStart = openAt[f.coin]; holds.push(t - episodeStart); delete openAt[f.coin]; }
    const pnl = Number(f.closedPnl) || 0;
    if (!(pnl !== 0 || /^(Close|Long > Short|Short > Long)/.test(dir))) continue;
    const k = f.coin + ":" + f.oid;
    const o = orders[k] || (orders[k] = { coin: f.coin, side: /^(Long|Close Long)/.test(dir) ? "long" : "short", net: 0, gross: 0, fees: 0, size: 0, notional: 0, closedAt: 0, openedAt: null });
    o.net += pnl - (Number(f.fee) || 0);
    o.gross += pnl;
    o.fees += Number(f.fee) || 0;
    o.size += sz;
    o.notional += sz * px;
    if (episodeStart !== null) o.openedAt = episodeStart;
    if (t > o.closedAt) o.closedAt = t;
  }
  const trades = Object.values(orders).sort((a, b) => a.closedAt - b.closedAt);
  const wins = trades.filter((x) => x.net > 0), losses = trades.filter((x) => x.net <= 0);
  const sum = (arr) => arr.reduce((s, x) => s + x.net, 0);
  const sorted = trades.slice().sort((a, b) => b.net - a.net);
  let cum = 0;
  const pts = trades.map((x) => { cum += x.net; return [x.closedAt, Math.round(cum * 100) / 100]; });
  const curve = [];
  if (pts.length <= 80) curve.push(...pts); else { const step = (pts.length - 1) / 79; for (let k = 0; k < 80; k++) curve.push(pts[Math.round(k * step)]); }
  const sumNotional = trades.reduce((s, x) => s + x.notional, 0);
  const sumNet = sum(trades);
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : null,
    avgWin: wins.length ? sum(wins) / wins.length : null,
    avgLoss: losses.length ? sum(losses) / losses.length : null,
    realizedTotal: sumNet,
    avgHoldMs: holds.length ? holds.reduce((s, x) => s + x, 0) / holds.length : null,
    best: sorted.slice(0, 3),
    worst: sorted.slice(-3).reverse(),
    ...tradeLists(trades.map(orderToTrade)),
    curve,
    endBalance: sumNotional > 0 ? 100 * (1 + sumNet / sumNotional) : 100,
    netOnHundredPerTrade: trades.reduce((s, x) => s + (x.notional > 0 ? (x.net * 100) / x.notional : 0), 0),
    windowDays: Math.round(((now - from) / 864e5) * 10) / 10,
    source: "hl-fills",
  };
}

// ---- 1. boards: one download of the 13 MB list, many small files. Throws on failure (caller then keeps the old bot path for this run). ----
export async function buildBoards(OUT, snapName) {
  const t0 = Date.now();
  const res = await fetch(HL_LB, { headers: { Accept: "application/json", "user-agent": "mr-static-publisher" }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error("hl leaderboard " + res.status);
  const data = await res.json();
  const all = (data.leaderboardRows || []).filter((r) => r && ADDR.test(String(r.ethAddress || "").toLowerCase()));
  if (all.length < 1000) throw new Error("hl leaderboard too small: " + all.length);
  const dir = path.join(OUT, "hlb"), counts = { total: all.length }, boards = {}, rows = [];
  for (const w of WINDOWS) {
    boards[w] = all.map((r) => shapeRow(r, w)).filter((r) => r.pnl > 0 && r.monthVlm >= HL_MIN_MONTH_VOLUME_USD).sort((a, b) => b.pnl - a.pnl).slice(0, 1000);
    counts[w] = boards[w].length;
    put(dir, w + ".json", boards[w]);
  }
  // the 10,000 active-trader list (site /<lang>/whales/all/ pages + profile lookups): month window, volume >= $200k, any pnl, by volume
  const list = all.map((r) => shapeRow(r, "month")).filter((r) => r.monthVlm >= 200000).sort((a, b) => b.monthVlm - a.monthVlm).slice(0, 10000);
  counts.all200k = list.length;
  for (let k = 0; k < 10; k++) put(dir, "all200k-" + k + ".json", list.slice(k * 1000, (k + 1) * 1000));
  const shards = {}; for (const c of "0123456789abcdef") shards[c] = {};
  for (const r of list) { const a = String(r.address).toLowerCase(); shards[a[2]][a] = r; }
  for (const c of Object.keys(shards)) put(dir, "addr-" + c + ".json", shards[c]);
  // the old variant files (app + mirrors read them): written from the same rows, so the job no longer calls the bot for them
  for (const w of ["day", "week", "month", "all"]) {
    const name = snapName("whale-leaderboard?window=" + w + "&limit=500");
    rows.push({ name, text: put(OUT, name + ".json", boards[w === "all" ? "month" : w].slice(0, 500)) });
  }
  const meta = { at: Date.now(), src: "github static-snap", ms: Date.now() - t0, counts };
  put(dir, "meta.json", meta);
  return { boards, list, meta, rows };
}

// ---- 2. per-wallet stats + whale cards. Hyperliquid allows ~1200 weight/min per IP and a userFills call costs ~20-120, so only a few wallets are
// refreshed per run (top 14 every ~30 min, the rest every ~4 h); everything else is carried over from the previous run's bundle on mr-static. ----
async function fills(addr) {
  const r = await fetch(HL_API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "userFills", user: addr }), signal: AbortSignal.timeout(20000) });
  if (r.status === 429) { const e = new Error("429"); e.rate = true; throw e; }
  if (!r.ok) throw new Error("userFills " + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}
function statsDoc(addr, v, at) {
  return { addr, trades: v.trades, wins: v.wins, losses: v.losses, winRate: v.winRate, avgWin: v.avgWin, avgLoss: v.avgLoss, realizedTotal: v.realizedTotal,
    avgHoldMs: v.avgHoldMs, best: v.best, worst: v.worst, allWins: v.allWins, allLosses: v.allLosses, topWins: v.topWins, topLosses: v.topLosses,
    lastTrade: null, openEpisodes: {}, curve: v.curve, firstTrackedAt: null, botLike: false, copy30: { trades: v.trades, endBalance: v.endBalance },
    source: v.source, windowDays: v.windowDays, snapAt: at };
}
export async function buildStats(OUT, STATIC_HOST, HLB, opts) {
  const budget = Number((opts && opts.budget) || process.env.HL_STATS_BUDGET || 10), now = Date.now(), log = [];
  let prev = { e: {} };
  try { const r = await fetch(STATIC_HOST + "/snap/ws/_bundle.json?t=" + now, { signal: AbortSignal.timeout(20000) }); if (r.ok) { const j = await r.json(); if (j && j.e) prev = j; } } catch (e) { log.push("no previous bundle (" + e.message + ")"); }
  const top = HLB.boards.month.slice(0, 500).map((r) => String(r.address).toLowerCase());
  const e = {};
  for (const a of top) if (prev.e[a]) e[a] = prev.e[a];
  const due = top.map((a, i) => ({ a, i, age: now - (e[a] ? e[a].at : 0) })).filter((x) => x.age > (x.i < 14 ? 30 * 60e3 : 4 * 3600e3))
    .sort((x, y) => (x.i < 14 ? 0 : 1) - (y.i < 14 ? 0 : 1) || y.age - x.age).slice(0, budget);
  let done = 0, failed = 0;
  for (const x of due) {
    try { e[x.a] = { at: Date.now(), v: computeFillStats(await fills(x.a), Date.now(), 30) }; done++; }
    catch (er) { failed++; if (er.rate) { log.push("hyperliquid 429: stopped after " + done); break; } }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const wsDir = path.join(OUT, "ws");
  let n = 0;
  for (const a of Object.keys(e)) { put(wsDir, a + ".json", statsDoc(a, e[a].v, e[a].at)); n++; }
  // wallets the existing hourly block already took from the bot (replica history: better than 30 days of fills) win over fill-only stats
  for (const f of fs.readdirSync(OUT)) {
    const m = /^whale-stats~addr-(0x[0-9a-fA-F]{40})\.json$/.exec(f);
    if (m) { fs.copyFileSync(path.join(OUT, f), path.join(wsDir, m[1].toLowerCase() + ".json")); n++; }
  }
  put(wsDir, "_bundle.json", { at: now, e });
  // whale cards = the bot's /whale-cards rule (top 14 profitable month traders, first 8 with a closed trade), from the same stats
  const cards = [];
  for (const r of HLB.boards.month.slice(0, 14)) {
    const x = e[String(r.address).toLowerCase()]; const v = x && x.v;
    if (!v || v.trades < 1 || cards.length >= 8) continue;
    cards.push({ address: r.address, displayName: r.displayName, pnl: r.pnl, stats: {
      trades: v.trades, wins: v.wins, losses: v.losses, winRate: v.winRate, avgWin: v.avgWin, avgLoss: v.avgLoss, realizedTotal: v.realizedTotal, avgHoldMs: v.avgHoldMs,
      best: v.best, worst: v.worst, topWins: v.topWins, topLosses: v.topLosses, copy30: { trades: v.trades, endBalance: v.endBalance }, source: v.source, windowDays: v.windowDays } });
  }
  const rows = [];
  if (cards.length >= 4) { const t = put(OUT, "whale-cards.json", cards); put(path.join(OUT, "hlb"), "cards.json", t); rows.push({ name: "whale-cards", text: t }); }
  // stamp the stats side into meta.json too (SENTINEL reads one file)
  const meta = Object.assign({}, HLB.meta, { statsAt: now, stats: { files: n, refreshed: done, failed, due: due.length, cards: cards.length } });
  put(path.join(OUT, "hlb"), "meta.json", meta);
  return { rows, cards: cards.length, files: n, refreshed: done, failed, log };
}
