// Hourly: GeckoTerminal (blocks Cloudflare Worker IPs with 429, works from GitHub runners) -> big DEX trades per wallet -> MarketRadar bot /evm-ingest.
// 2026-10-01: wider net (owner moved tracking effort from Solana to the other networks): 12 pools per chain from two trending pages, smaller min trade size, ingest in chunks (the endpoint takes at most 5 pools / 400 trades per call).
const CHAINS = ["robinhood", "eth", "bsc"], POOLS = 12, MAX_TRADES = 60;
const MIN_USD = { eth: 4000, bsc: 3000, robinhood: 500 }, MIN_LIQ = { eth: 50000, bsc: 30000, robinhood: 5000 };
const URLS = String(process.env.INGEST_URL || "").split(/[ ,]+/).filter(Boolean), KEY = process.env.INGEST_KEY, URL_ = URLS[0];
if (!URL_ || !KEY) { console.error("missing INGEST_URL / INGEST_KEY"); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function G(path) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch("https://api.geckoterminal.com/api/v2" + path, { headers: { accept: "application/json" } });
    if (r.status === 429) { await sleep(8000 * (a + 1)); continue; }
    if (!r.ok) throw new Error("gt " + r.status + " " + path);
    await sleep(2500);
    return r.json();
  }
  throw new Error("gt 429 " + path);
}
async function post(chain, pools, trades) {
  // several ingest endpoints (any of them is enough): the first that answers 2xx wins
  let last = { ok: false, status: 0, text: "no endpoint" };
  for (const u of URLS) {
    try {
      const res = await fetch(u, { method: "POST", headers: { "content-type": "application/json", "x-ingest-key": KEY }, body: JSON.stringify({ chain, pools, trades }) });
      last = { ok: res.ok, status: res.status, text: (await res.text()).slice(0, 100) };
      if (res.ok) return last;
    } catch (e) { last = { ok: false, status: 0, text: String(e.message || e).slice(0, 80) }; }
  }
  return last;
}
let failed = 0;
for (const chain of CHAINS) {
  try {
    const all = [];
    for (const page of [1, 2]) {
      try {
        const tp = await G(`/networks/${chain}/trending_pools?include=base_token&page=${page}`);
        const toks = {};
        for (const inc of tp.included || []) if (inc.type === "token") toks[inc.id] = inc.attributes || {};
        for (const p of tp.data || []) {
          const a = p.attributes || {}, tk = toks[((p.relationships || {}).base_token || {}).data?.id] || {};
          all.push({ addr: a.address, vol: Number((a.volume_usd || {}).h24) || 0, liq: Number(a.reserve_in_usd) || 0, symbol: tk.symbol || String(a.name || "").split(" / ")[0], name: tk.name || null, logo: tk.image_url && tk.image_url !== "missing.png" ? tk.image_url : null, token: tk.address || null, dex: ((p.relationships || {}).dex || {}).data?.id || null, quote: String(((p.relationships || {}).quote_token || {}).data?.id || "").split("_")[1] || null });
        }
      } catch (e) { console.log(chain, "page", page, "skip", e.message); }
    }
    const seen = new Set();
    const pools = all.filter((p) => p.addr && p.liq >= MIN_LIQ[chain] && !seen.has(p.addr) && seen.add(p.addr)).sort((a, b) => b.vol - a.vol).slice(0, POOLS);
    const trades = [];
    for (const p of pools) {
      try {
        const tr = await G(`/networks/${chain}/pools/${p.addr}/trades?trade_volume_in_usd_greater_than=${MIN_USD[chain]}`);
        const big = (tr.data || []).map((x) => x.attributes || {}).sort((a, b) => Number(b.volume_in_usd) - Number(a.volume_in_usd)).slice(0, MAX_TRADES);
        for (const a of big) { const t = Math.floor(Date.parse(a.block_timestamp) / 1000), usd = Number(a.volume_in_usd); if (a.tx_from_address && t && usd > 0 && (a.kind === "buy" || a.kind === "sell")) trades.push({ pool: p.addr, wallet: a.tx_from_address, t, side: a.kind, usd, px: Number(a.kind === "buy" ? a.price_to_in_usd : a.price_from_in_usd) || null }); }
      } catch (e) { console.log(chain, "pool", p.addr.slice(0, 8), "skip", e.message); }
    }
    const meta = pools.map(({ addr, symbol, name, logo, token, dex, quote }) => ({ addr, symbol, name, logo, token, dex, quote }));
    let n = 0, bad = 0;
    for (let i = 0; i < meta.length; i += 5) { const r = await post(chain, meta.slice(i, i + 5), []); if (!r.ok) bad++; }
    for (let i = 0; i < trades.length; i += 400) { const r = await post(chain, [], trades.slice(i, i + 400)); if (!r.ok) bad++; else n += Math.min(400, trades.length - i); }
    console.log(chain, "pools", pools.length, "trades", trades.length, "posted", n, bad ? "ERRORS " + bad : "ok");
    if (bad) failed++;
  } catch (e) { failed++; console.log(chain, "ERROR", e.message); }
}
process.exit(failed === CHAINS.length ? 1 : 0);
