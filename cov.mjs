// Coverage test of the buy-route finder on the top coins (same rules as the app: platforms, curated BTC, verified wrapped search)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (u) => { for (let a = 0; a < 3; a++) { const r = await fetch(u); if (r.status === 429) { await sleep(15000); continue; } return r.json(); } return null; };
const SWAP = new Set(["ETH", "SOL", "BNB", "TON", "TRX", "USDT", "XAUT"]);
const EVMDEX = { eth: ["uniswap_v2", "uniswap_v3", "uniswap-v4-ethereum"], bsc: ["pancakeswap_v2", "pancakeswap-v3-bsc", "uniswap-bsc", "pancakeswap-infinity-clmm", "uniswap-v4-bsc"] };
const markets = await J("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=40&page=1&sparkline=false");
const rows = [];
for (const c of markets) {
  const S = c.symbol.toUpperCase(); const o = { s: S, rk: c.market_cap_rank, direct: [], wrapped: [], swap: SWAP.has(S) };
  if (!o.swap) {
    await sleep(6500);
    const j = await J(`https://api.coingecko.com/api/v3/coins/${c.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`);
    const pf = (j && j.platforms) || {};
    if (pf.solana) o.direct.push("sol"); if ((pf.ethereum || "").length === 42) o.direct.push("eth"); if ((pf["binance-smart-chain"] || "").length === 42) o.direct.push("bsc");
    if (S === "BTC") o.wrapped.push("sol", "eth", "bsc");
    if (!o.direct.length && S !== "BTC") {
      for (const [gt, key] of [["solana", "sol"], ["bsc", "bsc"], ["eth", "eth"]]) {
        const sr = await J(`https://api.geckoterminal.com/api/v2/search/pools?query=${S}&network=${gt}&include=base_token&page=1`); await sleep(2500);
        if (!sr) continue; const toks = {}; for (const x of sr.included || []) toks[x.id] = x.attributes || {};
        const cands = []; const seen = new Set();
        for (const p of sr.data || []) { const at = p.attributes, rel = p.relationships, bid = rel.base_token.data.id, tk = toks[bid] || {}; const liq = +at.reserve_in_usd || 0, vol = at.volume_usd ? +at.volume_usd.h24 : 0; if (liq < 100000 || vol < 20000 || !String(tk.symbol || "").toUpperCase().includes(S)) continue; const tok = bid.split("_")[1]; if (seen.has(tok.toLowerCase())) continue; seen.add(tok.toLowerCase()); const dex = rel.dex.data.id; if (key !== "sol" && !(EVMDEX[key] || []).includes(dex)) continue; cands.push({ tok, liq }); }
        cands.sort((a, b) => b.liq - a.liq);
        for (const cd of cands.slice(0, 4)) {
          let ok = false;
          if (key === "sol") { const r = await J("https://lite-api.jup.ag/tokens/v2/search?query=" + cd.tok); const t = r && r[0]; ok = !!(t && t.id === cd.tok && t.isVerified === true && +t.liquidity >= 100000 && String(t.symbol).toUpperCase().includes(S)); }
          else { await sleep(2500); const i = await J(`https://api.geckoterminal.com/api/v2/networks/${gt}/tokens/${cd.tok}/info`); const cg = String((i && i.data && i.data.attributes.coingecko_coin_id) || "").toLowerCase(); ok = !!(cg && (cg.includes(c.id) || c.id.includes(cg))); }
          if (ok) { o.wrapped.push(key); break; }
        }
      }
    }
  }
  rows.push(o); console.log(String(o.rk).padStart(3), o.s.padEnd(7), o.swap ? "SWAP" : "", "direct:", o.direct.join(",") || "-", "wrapped:", o.wrapped.join(",") || "-");
}
const ok = rows.filter((r) => r.swap || r.direct.length || r.wrapped.length).length;
console.log("\nbuyable:", ok, "of", rows.length);
