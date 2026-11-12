// Snapshot of public CoinGecko data for MarketRadar (top-200 table with sparklines + contract addresses of the top 1000). Runs on GitHub Actions because CoinGecko rate-limits shared Cloudflare Worker addresses. Public data only.
import fs from "node:fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (u) => { for (let a = 0; a < 5; a++) { try { const r = await fetch(u, { headers: { accept: "application/json", "user-agent": "MarketRadar-snapshot" } }); if (r.status === 429) { await sleep(30000); continue; } if (!r.ok) return null; return await r.json(); } catch (e) { await sleep(3000); } } return null; };
fs.mkdirSync("data", { recursive: true });
const m1 = await J("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=200&page=1&sparkline=true&price_change_percentage=24h");
if (Array.isArray(m1) && m1.length > 100) { const slim = m1.map((c) => { const sp = c.sparkline_in_7d && c.sparkline_in_7d.price; return Object.assign({}, c, { sparkline_in_7d: sp ? { price: sp.filter((_, i) => i % 6 === 0) } : undefined }); }); fs.writeFileSync("data/markets.json", JSON.stringify(slim)); }
else console.log("markets: no data, keeping the old file");
const all = [...(Array.isArray(m1) ? m1 : [])];
for (const p of [2, 3, 4]) { await sleep(8000); const m = await J(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${p}&sparkline=false`); if (Array.isArray(m)) all.push(...m); }
await sleep(8000);
const list = await J("https://api.coingecko.com/api/v3/coins/list?include_platform=true");
if (Array.isArray(list) && all.length > 150) {
  const want = new Set(all.map((c) => c.id)), keep = ["solana", "ethereum", "binance-smart-chain", "robinhood", "base", "arbitrum-one", "polygon-pos", "optimistic-ethereum", "hyperevm", "zksync", "mantle", "linea", "scroll", "avalanche", "sonic", "berachain", "unichain", "blast", "mode", "xdai", "celo", "cronos", "ink", "abstract", "world-chain", "ronin", "flare-network", "kaia", "monad", "sei-v2", "taiko", "moonbeam"];
  const out = {};
  for (const c of list) { if (!want.has(c.id)) continue; const o = {}; for (const k of keep) if (c.platforms && c.platforms[k]) o[k] = c.platforms[k]; out[c.id] = o; }
  fs.writeFileSync("data/platforms.json", JSON.stringify(out));
  console.log("platforms for", Object.keys(out).length, "coins");
} else console.log("platform list: no data, keeping the old file");
// T21-05 (2026-11-04): GeckoTerminal trending pools for the Mini App pump tab. GeckoTerminal rate-limits the shared Cloudflare
// Worker addresses; the bot /gt proxy (src/floor3/gt_proxy.js) serves this copy (labeled with its age) when the live call is refused.
for (const net of ["solana", "eth", "bsc", "robinhood"]) {
  const g = await J("https://api.geckoterminal.com/api/v2/networks/" + net + "/trending_pools?page=1&include=base_token");
  if (g && Array.isArray(g.data) && g.data.length) fs.writeFileSync("data/gt_trending_" + net + ".json", JSON.stringify({ mrw_snap_at: new Date().toISOString(), data: g.data, included: g.included || [] }));
  else console.log("gt " + net + ": no data, keeping the old file");
  await sleep(2500);
}
fs.writeFileSync("data/updated.txt", new Date().toISOString() + "\n");
