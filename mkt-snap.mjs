// Snapshot of public CoinGecko data for MarketRadar (top-200 table with sparklines + contract addresses of the top 1000). Runs on GitHub Actions because CoinGecko rate-limits shared Cloudflare Worker addresses. Public data only.
import fs from "node:fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (u) => { for (let a = 0; a < 5; a++) { try { const r = await fetch(u, { headers: { accept: "application/json", "user-agent": "MarketRadar-snapshot" } }); if (r.status === 429) { await sleep(30000); continue; } if (!r.ok) return null; return await r.json(); } catch (e) { await sleep(3000); } } return null; };
fs.mkdirSync("data", { recursive: true });
const m1 = await J("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=200&page=1&sparkline=true&price_change_percentage=24h");
if (Array.isArray(m1) && m1.length > 100) fs.writeFileSync("data/markets.json", JSON.stringify(m1));
else console.log("markets: no data, keeping the old file");
const all = [...(Array.isArray(m1) ? m1 : [])];
for (const p of [2, 3, 4]) { await sleep(8000); const m = await J(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${p}&sparkline=false`); if (Array.isArray(m)) all.push(...m); }
await sleep(8000);
const list = await J("https://api.coingecko.com/api/v3/coins/list?include_platform=true");
if (Array.isArray(list) && all.length > 150) {
  const want = new Set(all.map((c) => c.id)), keep = ["solana", "ethereum", "binance-smart-chain", "robinhood", "base", "arbitrum-one", "polygon-pos", "optimistic-ethereum"];
  const out = {};
  for (const c of list) { if (!want.has(c.id)) continue; const o = {}; for (const k of keep) if (c.platforms && c.platforms[k]) o[k] = c.platforms[k]; out[c.id] = o; }
  fs.writeFileSync("data/platforms.json", JSON.stringify(out));
  console.log("platforms for", Object.keys(out).length, "coins");
} else console.log("platform list: no data, keeping the old file");
fs.writeFileSync("data/updated.txt", new Date().toISOString() + "\n");
