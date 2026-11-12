import fs from "node:fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (u) => { for (let a = 0; a < 5; a++) { try { const r = await fetch(u); if (r.status === 429) { await sleep(25000); continue; } if (!r.ok) return null; return await r.json(); } catch (e) { await sleep(2000); } } return null; };
const markets = [];
for (const p of [1, 2, 3, 4]) { const m = await J(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${p}&sparkline=false`); markets.push(...(m || [])); await sleep(2500); }
const list = await J("https://api.coingecko.com/api/v3/coins/list?include_platform=true");
const plat = {}; for (const c of list || []) plat[c.id] = c.platforms || {};
const DIRECT = ["solana", "ethereum", "binance-smart-chain", "robinhood"];
const MORE = ["base", "arbitrum-one", "polygon-pos", "optimistic-ethereum", "avalanche", "hyperevm", "hyperliquid", "sui", "tron", "the-open-network", "aptos", "near-protocol", "cosmos", "stellar", "cardano", "ripple", "algorand", "starknet", "mantle", "linea", "scroll", "blast", "sonic", "berachain", "zksync", "polkadot", "fantom", "celo", "cronos", "gnosis", "xdai", "manta-pacific", "unichain", "monad"];
const THOR = new Set(["BTC", "LTC", "DOGE", "BCH", "XRP", "ATOM", "AVAX", "TRX", "BNB", "ETH", "SOL"]);
const out = { direct: 0, nativeThor: 0, moreEvm: 0, other: 0, none: 0 };
const rows = []; const evmMore = {}; const none = [];
for (const c of markets) {
  const S = c.symbol.toUpperCase(), pf = plat[c.id] || {}; const keys = Object.keys(pf).filter((k) => pf[k]);
  let cls;
  if (keys.some((k) => DIRECT.includes(k))) cls = "direct";
  else if (THOR.has(S)) cls = "nativeThor";
  else if (keys.some((k) => ["base", "arbitrum-one", "polygon-pos", "optimistic-ethereum", "avalanche", "mantle", "linea", "scroll", "blast", "sonic", "berachain", "zksync", "unichain", "hyperevm"].includes(k))) { cls = "moreEvm"; for (const k of keys) evmMore[k] = (evmMore[k] || 0) + 1; }
  else if (keys.length) cls = "other"; else cls = "none";
  out[cls]++; rows.push({ rk: c.market_cap_rank, s: S, cls, keys: keys.slice(0, 3) });
  if (cls === "none" || cls === "other") none.push(c.market_cap_rank + ":" + S);
}
console.log(markets.length, out); console.log("extra EVM chains among moreEvm:", evmMore);
console.log("own-chain/no-platform sample:", none.slice(0, 120).join(" "));
fs.writeFileSync("cov1000.json", JSON.stringify(rows));
