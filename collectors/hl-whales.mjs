// Hyperliquid wide whale collector (2026-10-09). Runs on GitHub Actions (free for public repos, a fresh IP per run) instead of the Cloudflare Worker (50 outbound requests per invocation = the reason only ~100 whales were tracked).
// Reads the public leaderboard (~14k accounts), keeps every account above MIN_ACCT, reads each one's open positions from the public Hyperliquid API (no key, no middleman) and keeps a warehouse in Turso:
//   hl_wallets   one row per account (value + PnL windows), refreshed once a day
//   hl_positions only the STATIC part of an open position (size, entry, leverage, liquidation); value/uPnL are computed at read time from mark prices, so a row is written only when the position really changes
//   hl_meta      last-run summary
// Write budget (Turso free = 10M row-writes/month): ~14k wallet rows/day + position changes only.
const TURSO_URL = (process.env.TURSO_URL || "").replace(/^libsql:/, "https:"), TURSO_TOKEN = process.env.TURSO_TOKEN || "";
const MIN_ACCT = Number(process.env.MIN_ACCT || 100000), MAX_WALLETS = Number(process.env.MAX_WALLETS || 8000), RPS = Number(process.env.RPS || 8);
const T0 = Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!TURSO_URL || !TURSO_TOKEN) { console.log("TURSO_URL / TURSO_TOKEN missing"); process.exit(1); }

async function turso(stmts) {
  const requests = stmts.map((s) => ({ type: "execute", stmt: { sql: s[0], args: (s[1] || []).map((v) => (v == null ? { type: "null" } : typeof v === "number" ? { type: Number.isInteger(v) ? "integer" : "float", value: Number.isInteger(v) ? String(v) : v } : { type: "text", value: String(v) })) } })).concat([{ type: "close" }]);
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(TURSO_URL + "/v2/pipeline", { method: "POST", headers: { authorization: "Bearer " + TURSO_TOKEN, "content-type": "application/json" }, body: JSON.stringify({ requests }), signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error("turso " + r.status + " " + (await r.text()).slice(0, 120));
      const j = await r.json(); for (const x of j.results) if (x.type === "error") throw new Error("turso stmt " + JSON.stringify(x.error).slice(0, 160));
      return j.results;
    } catch (e) { if (a === 2) throw e; await sleep(1500 * (a + 1)); }
  }
}
const val = (c) => (c && c.type !== "null" ? c.value : null);
async function hl(body) {
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      if (r.status === 429) { await sleep(4000 * (a + 1)); continue; }
      if (!r.ok) throw new Error("hl " + r.status);
      return await r.json();
    } catch (e) { if (a === 4) return null; await sleep(1000 * (a + 1)); }
  }
  return null;
}

await turso([
  ["CREATE TABLE IF NOT EXISTS hl_wallets (wallet TEXT PRIMARY KEY, acct REAL, pnl_d REAL, pnl_w REAL, pnl_m REAL, pnl_a REAL, vlm_m REAL, name TEXT, updated INTEGER)"],
  ["CREATE TABLE IF NOT EXISTS hl_positions (wallet TEXT NOT NULL, coin TEXT NOT NULL, szi REAL NOT NULL, entry REAL, lev REAL, liq REAL, cross INTEGER, seen INTEGER NOT NULL, PRIMARY KEY (wallet, coin))"],
  ["CREATE INDEX IF NOT EXISTS hl_positions_coin ON hl_positions (coin)"],
  ["CREATE TABLE IF NOT EXISTS hl_meta (k TEXT PRIMARY KEY, v TEXT)"],
]);

// 1) leaderboard
let rows = null;
for (let a = 0; a < 3 && !rows; a++) {
  try { const lbRes = await fetch("https://stats-data.hyperliquid.xyz/Mainnet/leaderboard", { signal: AbortSignal.timeout(240000) }); if (!lbRes.ok) throw new Error("http " + lbRes.status); rows = (await lbRes.json()).leaderboardRows || []; }
  catch (e) { console.log("leaderboard attempt " + (a + 1) + " failed: " + String(e.message || e).slice(0, 80)); await sleep(5000); }
}
if (!rows || rows.length < 1000) { console.log("leaderboard unavailable"); process.exit(1); }
const pw = (r, w) => { const x = (r.windowPerformances || []).find((p) => p[0] === w); return x && x[1] ? { pnl: Number(x[1].pnl || 0), vlm: Number(x[1].vlm || 0) } : { pnl: 0, vlm: 0 }; };
const all = rows.map((r) => ({ w: String(r.ethAddress).toLowerCase(), acct: Number(r.accountValue || 0), d: pw(r, "day").pnl, wk: pw(r, "week").pnl, m: pw(r, "month"), a: pw(r, "allTime").pnl, name: r.displayName || null })).filter((x) => /^0x[0-9a-f]{40}$/.test(x.w));
const targets = all.filter((x) => x.acct >= MIN_ACCT).sort((a, b) => b.acct - a.acct).slice(0, MAX_WALLETS);
console.log("leaderboard rows", all.length, "tracked (>= $" + MIN_ACCT + ")", targets.length);

// 2) wallet table once a day (14k rows) - only when the last refresh is older than 20 h
const lastW = Number(val(((await turso([["SELECT COALESCE(MAX(updated),0) FROM hl_wallets"]]))[0].response.result.rows[0] || [])[0])) || 0;
let walletWrites = 0;
if (Date.now() - lastW > 20 * 3600e3) {
  for (let i = 0; i < all.length; i += 400) {
    await turso(all.slice(i, i + 400).map((x) => ["INSERT INTO hl_wallets (wallet, acct, pnl_d, pnl_w, pnl_m, pnl_a, vlm_m, name, updated) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET acct=excluded.acct, pnl_d=excluded.pnl_d, pnl_w=excluded.pnl_w, pnl_m=excluded.pnl_m, pnl_a=excluded.pnl_a, vlm_m=excluded.vlm_m, name=excluded.name, updated=excluded.updated", [x.w, x.acct, x.d, x.wk, x.m.pnl, x.a, x.m.vlm, x.name, Date.now()]]));
    walletWrites += Math.min(400, all.length - i);
  }
}

// 3) existing positions -> diff -> write only changes
const ex = new Map();
const exW = new Map();
{ const res = (await turso([["SELECT wallet, coin, szi, entry, lev, liq FROM hl_positions"]]))[0].response.result.rows; for (const r of res) { ex.set(val(r[0]) + "|" + val(r[1]), { szi: Number(val(r[2])), entry: Number(val(r[3])) }); (exW.get(val(r[0])) || exW.set(val(r[0]), []).get(val(r[0]))).push(val(r[1])); } }
const stmts = []; let scanned = 0, failed = 0, posNow = 0, changed = 0, removed = 0;
const flush = async () => { while (stmts.length) await turso(stmts.splice(0, 300)); };
const queue = targets.slice(); const gap = 1000 / RPS; let nextAt = Date.now();
async function worker() {
  while (queue.length) {
    const t = queue.shift(); if (!t) break;
    const slot = Math.max(nextAt, Date.now()); nextAt = slot + gap; await sleep(slot - Date.now());
    const st = await hl({ type: "clearinghouseState", user: t.w });
    if (!st || !Array.isArray(st.assetPositions)) { failed++; continue; }
    scanned++;
    const seenCoins = new Set();
    for (const ap of st.assetPositions) {
      const p = ap.position; if (!p || !p.coin) continue; const szi = Number(p.szi); if (!szi) continue;
      seenCoins.add(p.coin); posNow++;
      const key = t.w + "|" + p.coin, old = ex.get(key), entry = Number(p.entryPx || 0);
      if (!old || old.szi !== szi || Math.abs(old.entry - entry) > 1e-12) { changed++; stmts.push(["INSERT INTO hl_positions (wallet, coin, szi, entry, lev, liq, cross, seen) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(wallet, coin) DO UPDATE SET szi=excluded.szi, entry=excluded.entry, lev=excluded.lev, liq=excluded.liq, cross=excluded.cross, seen=excluded.seen", [t.w, p.coin, szi, entry, Number((p.leverage && p.leverage.value) || 0), p.liquidationPx == null ? null : Number(p.liquidationPx), p.leverage && p.leverage.type === "cross" ? 1 : 0, Date.now()]]); }
    }
    for (const c of exW.get(t.w) || []) if (!seenCoins.has(c)) { removed++; stmts.push(["DELETE FROM hl_positions WHERE wallet = ? AND coin = ?", [t.w, c]]); }
    if (stmts.length >= 300) await flush();
    if (scanned % 500 === 0) console.log("scanned", scanned, "of", targets.length, "elapsed", Math.round((Date.now() - T0) / 1000) + "s");
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
await flush();
const summary = { at: Date.now(), leaderboard: all.length, tracked: targets.length, scanned, failed, positions: posNow, changed, removed, walletWrites, seconds: Math.round((Date.now() - T0) / 1000) };
await turso([["INSERT INTO hl_meta (k, v) VALUES ('last_run', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [JSON.stringify(summary)]]]);
console.log(JSON.stringify(summary));
if (scanned < targets.length * 0.7) { console.log("too many failed lookups"); process.exit(1); }
