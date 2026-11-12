// Coverage of the top 200 coins: same rules as the app (native pages, platforms on Solana/Ethereum/BNB/Robinhood, curated BTC wrappers, verified wrapped search)
import fs from "node:fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (u) => { for (let a = 0; a < 4; a++) { try { const r = await fetch(u); if (r.status === 429) { await sleep(20000); continue; } if (!r.ok) return null; return await r.json(); } catch (e) { await sleep(3000); } } return null; };
const markets = [];
for (const page of [1, 2]) { const m = await J(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=${page}&sparkline=false`); markets.push(...(m || [])); await sleep(8000); }
console.log("markets", markets.length);
const list = await J("https://api.coingecko.com/api/v3/coins/list?include_platform=true");
const plat = {}; for (const c of list || []) plat[c.id] = c.platforms || {};
console.log("platform list", Object.keys(plat).length);
const NATIVE = new Set(["ETH", "SOL", "BNB"]);          // own direct pages
const SWAPONLY = new Set(["TON", "TRX", "USDT", "XAUT"]); // Swap tab only
const EVMDEX = { eth: ["uniswap_v2", "uniswap_v3", "uniswap-v4-ethereum"], bsc: ["pancakeswap_v2", "pancakeswap-v3-bsc", "uniswap-bsc", "pancakeswap-infinity-clmm", "uniswap-v4-bsc"] };
const rows = [];
for (const c of markets) {
  const S = c.symbol.toUpperCase(), pf = plat[c.id] || {}, o = { rk: c.market_cap_rank, s: S, id: c.id, how: [] };
  if (NATIVE.has(S)) o.how.push("native-page");
  if (SWAPONLY.has(S)) o.how.push("swap-tab");
  if (pf.solana && pf.solana.length >= 32) o.how.push("sol");
  if ((pf.ethereum || "").length === 42) o.how.push("eth");
  if ((pf["binance-smart-chain"] || "").length === 42) o.how.push("bsc");
  if ((pf.robinhood || "").length === 42) o.how.push("robinhood");
  if (S === "BTC") o.how.push("wrapped(cbBTC/WBTC/BTCB)");
  rows.push(o);
}
const need = rows.filter((r) => !r.how.length);
console.log("coins without a direct route yet:", need.length, "-> searching verified wrapped tokens");
for (const o of need) {
  const c = markets.find((m) => m.id === o.id); const S = o.s;
  for (const [gt, key] of [["solana", "sol"], ["bsc", "bsc"], ["eth", "eth"]]) {
    const sr = await J(`https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(S)}&network=${gt}&include=base_token&page=1`); await sleep(2300);
    if (!sr) continue; const toks = {}; for (const x of sr.included || []) toks[x.id] = x.attributes || {};
    const cands = []; const seen = new Set();
    for (const p of sr.data || []) { const at = p.attributes, rel = p.relationships, bid = rel.base_token.data.id, tk = toks[bid] || {}; const liq = +at.reserve_in_usd || 0, vol = at.volume_usd ? +at.volume_usd.h24 : 0; if (liq < 100000 || vol < 20000 || !String(tk.symbol || "").toUpperCase().includes(S)) continue; const tok = bid.split("_")[1]; if (!tok || seen.has(tok.toLowerCase())) continue; seen.add(tok.toLowerCase()); const dex = rel.dex.data.id; if (key !== "sol" && !(EVMDEX[key] || []).includes(dex)) continue; cands.push({ tok, liq }); }
    cands.sort((a, b) => b.liq - a.liq);
    for (const cd of cands.slice(0, 3)) {
      let ok = false;
      if (key === "sol") { const r = await J("https://lite-api.jup.ag/tokens/v2/search?query=" + cd.tok); const t = r && r[0]; ok = !!(t && t.id === cd.tok && t.isVerified === true && +t.liquidity >= 100000 && String(t.symbol).toUpperCase().includes(S)); }
      else { await sleep(2300); const i = await J(`https://api.geckoterminal.com/api/v2/networks/${gt}/tokens/${cd.tok}/info`); const cg = String((i && i.data && i.data.attributes.coingecko_coin_id) || "").toLowerCase(); ok = !!(cg && (cg.includes(c.id) || c.id.includes(cg))); }
      if (ok) { o.how.push("wrapped-" + key); break; }
    }
  }
  console.log(String(o.rk).padStart(3), S.padEnd(8), o.how.join(",") || "NONE");
  fs.writeFileSync("cov200.json", JSON.stringify(rows));
}
fs.writeFileSync("cov200.json", JSON.stringify(rows));
const none = rows.filter((r) => !r.how.length);
console.log("\nTOTAL", rows.length, "| buyable:", rows.length - none.length, "| not buyable:", none.length);
console.log("NOT BUYABLE:", none.map((r) => r.rk + ":" + r.s).join(" "));
