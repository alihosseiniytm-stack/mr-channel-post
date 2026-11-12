const G = async (p) => (await fetch("https://api.geckoterminal.com/api/v2" + p)).json();
const i = await G("/networks/bsc/tokens/0xba2ae424d960c26247dd6c32edc70b295c744c43/info"); console.log("bsc doge", i.data.attributes.coingecko_coin_id, i.data.attributes.gt_score, i.data.attributes.is_honeypot);
for (const m of ["DoGEV7LASBkQbibMc5k5vKnTZoMg423GpJ5QtJEGfm7R", "DogePMoL8zXQtYbvAYNFTFST9pewYi6uHWpZvFUtnBBz", "Ci11wAJVj4tMeBo4EJUUKNnejAvHorcktcMSHmSLQdx4", "EhD6AjTzgpBVVc9aAdVFU7ar52gAymFCYhFkMWDubCJW", "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij"]) {
  const r = await (await fetch("https://lite-api.jup.ag/tokens/v2/search?query=" + m)).json(); const t = r[0] || {};
  console.log("jup", m.slice(0, 8), t.symbol, "verified", t.isVerified, "organic", t.organicScoreLabel, "liq", Math.round(t.liquidity || 0), "tags", JSON.stringify(t.tags));
}
const w = await (await fetch("https://lite-api.jup.ag/tokens/v2/search?query=wrapped%20doge")).json(); console.log("jup search 'wrapped doge':", w.slice(0,5).map(t=>t.symbol+":"+t.isVerified+":"+Math.round(t.liquidity||0)));
const x = await (await fetch("https://lite-api.jup.ag/tokens/v2/search?query=XRP")).json(); console.log("jup XRP:", x.slice(0,6).map(t=>t.symbol+"/"+t.name+":"+t.isVerified+":"+Math.round(t.liquidity||0)));
