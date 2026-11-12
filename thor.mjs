const nodes = ["https://thornode.ninerealms.com", "https://thornode-v2.ninerealms.com", "https://gateway.liquify.com/chain/thorchain_api"];
for (const n of nodes) {
  try {
    const r = await fetch(n + "/thorchain/inbound_addresses"); const j = await r.json();
    console.log(n, r.status, Array.isArray(j) ? j.map(x => x.chain + (x.halted ? "(halted)" : "")).join(",") : JSON.stringify(j).slice(0, 100));
    const eth = j.find(x => x.chain === "ETH"), bsc = j.find(x => x.chain === "BSC");
    console.log(" ETH router", eth && eth.router, "BSC router", bsc && bsc.router);
    const q = await (await fetch(n + "/thorchain/quote/swap?from_asset=ETH.ETH&to_asset=BTC.BTC&amount=" + 10n ** 17n * 1n / 1n * 1n + "&destination=bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq&streaming_interval=1")).json();
    console.log(" quote 0.1 ETH->BTC:", JSON.stringify(q).slice(0, 600));
    break;
  } catch (e) { console.log(n, "ERR", e.message); }
}
