const G = async (p) => (await fetch("https://api.geckoterminal.com/api/v2" + p)).json();
for (const net of ["solana", "bsc"]) {
  const j = await G(`/search/pools?query=DOGE&network=${net}&include=base_token&page=1`);
  const toks = {}; for (const x of j.included || []) toks[x.id] = x.attributes;
  for (const p of (j.data || []).slice(0, 8)) {
    const a = p.attributes, bid = p.relationships.base_token.data.id, tk = toks[bid] || {};
    console.log(net, tk.symbol, "|", tk.name, "| liq", Math.round(a.reserve_in_usd), "| vol", Math.round(a.volume_usd.h24), "|", bid.split("_")[1]);
  }
  await new Promise((r) => setTimeout(r, 2500));
}
// token info with coingecko id for the suspicious solana one(s)
const sol = await G(`/search/pools?query=DOGE&network=solana&include=base_token&page=1`);
const ids = [...new Set((sol.data || []).map((p) => p.relationships.base_token.data.id.split("_")[1]))].slice(0, 4);
for (const addr of ids) { await new Promise((r) => setTimeout(r, 2500)); const i = await G(`/networks/solana/tokens/${addr}/info`); const a = i.data && i.data.attributes || {}; console.log("info", addr.slice(0, 8), a.symbol, "cg:", a.coingecko_coin_id, "gt_score", a.gt_score); }
