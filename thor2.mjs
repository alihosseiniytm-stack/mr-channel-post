const n = "https://gateway.liquify.com/chain/thorchain_api";
const dest = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
for (const [from, amt] of [["ETH.ETH", 0.05 * 1e8], ["BSC.BNB", 0.5 * 1e8]]) {
  const q = await (await fetch(`${n}/thorchain/quote/swap?from_asset=${from}&to_asset=BTC.BTC&amount=${Math.round(amt)}&destination=${dest}&tolerance_bps=300`)).json();
  console.log(from, "->BTC", JSON.stringify({ err: q.error, in: q.inbound_address, memo: q.memo, exp: q.expected_amount_out, fees: q.fees, secIn: q.inbound_confirmation_seconds, secOut: q.outbound_delay_seconds, total: q.total_swap_seconds, min: q.recommended_min_amount_in, warn: q.warning && q.warning.slice(0, 40) }));
}
const dg = await (await fetch(`${n}/thorchain/quote/swap?from_asset=ETH.ETH&to_asset=DOGE.DOGE&amount=${5e6}&destination=DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L`)).json();
console.log("ETH->DOGE", JSON.stringify({ err: dg.error, out: dg.expected_amount_out, memo: dg.memo }));
