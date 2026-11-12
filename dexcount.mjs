const nets = { eth: "eth", bsc: "bsc", robinhood: "robinhood" };
for (const [k, n] of Object.entries(nets)) {
  const tally = {};
  for (const page of [1, 2]) {
    for (const ep of ["trending_pools", "pools"]) {
      try {
        const j = await (await fetch(`https://api.geckoterminal.com/api/v2/networks/${n}/${ep}?page=${page}`)).json();
        for (const p of j.data || []) { const d = p.relationships.dex.data.id; tally[d] = (tally[d] || 0) + 1; }
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 2200));
    }
  }
  console.log(k, JSON.stringify(Object.entries(tally).sort((a, b) => b[1] - a[1])));
}
