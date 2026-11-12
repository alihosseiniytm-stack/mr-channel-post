const rpc = async (url, method, params) => { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); return r.json(); };
for (const url of ["https://rpc.hyperliquid.xyz/evm", "https://hyperliquid-json-rpc.stakely.io", "https://rpc.hyperlend.finance"]) {
  try { const r = await Promise.race([rpc(url, "eth_chainId", []), new Promise((_, j) => setTimeout(() => j(new Error("timeout")), 9000))]); console.log(url, JSON.stringify(r).slice(0, 80)); } catch (e) { console.log(url, "ERR", e.message); }
}
const G = async (p) => (await fetch("https://api.geckoterminal.com/api/v2" + p)).json();
const nets = await G("/networks?page=1"); const hy = (nets.data || []).filter(n => /hyper/i.test(n.id + n.attributes.name)); console.log("networks:", hy.map(n => n.id + ":" + n.attributes.name));
const dexes = await G("/networks/hyperevm/dexes"); console.log("dexes:", (dexes.data || []).map(d => d.id).join(", "));
const pools = await G("/networks/hyperevm/trending_pools?page=1"); console.log((pools.data || []).slice(0, 8).map(p => p.attributes.name + " " + p.relationships.dex.data.id + " liq " + Math.round(p.attributes.reserve_in_usd)).join("\n"));
