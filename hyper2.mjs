const RPC = "https://rpc.hyperliquid.xyz/evm";
const rpc = async (method, params) => (await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json());
const G = async (p) => { for (let i = 0; i < 3; i++) { const r = await fetch("https://api.geckoterminal.com/api/v2" + p); if (r.status === 429) { await new Promise(r => setTimeout(r, 8000)); continue; } return r.json(); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
for (const dex of ["hyperswap-v2", "hyperswap-v3", "project-x"]) {
  await sleep(2500);
  const pools = await G(`/networks/hyperevm/dexes/${dex}/pools?page=1`);
  const top = (pools.data || []).slice(0, 2);
  const tally = {};
  for (const p of top) {
    await sleep(2500);
    const tr = await G(`/networks/hyperevm/pools/${p.attributes.address}/trades`);
    for (const t of (tr.data || []).slice(0, 12)) { const h = t.attributes.tx_hash; const tx = await rpc("eth_getTransactionByHash", [h]); const to = tx.result && tx.result.to; if (to) tally[to] = (tally[to] || 0) + 1; }
  }
  console.log(dex, "pool(s):", top.map(p => p.attributes.name + " liq " + Math.round(p.attributes.reserve_in_usd)).join(" | "), "\n  tx.to tally:", JSON.stringify(tally));
}
