const RPC = "https://rpc.hyperliquid.xyz/evm";
const call = async (to, data) => { const r = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) })).json(); return r.result || ("ERR " + (r.error && r.error.message || "").slice(0, 40)); };
const tail = (x) => x && x.startsWith("0x") ? "0x" + x.slice(-40) : x;
for (const [label, a] of [["V2 candidate b4a9", "0xb4a9C4e6Ea8E2191d2FA5B380452a634Fb21240A"], ["V3 cand 8549", "0x8549fd7ffc092f8366e416e129a622ec060104ea"], ["V3 cand cf68", "0xcf6848bc4bf6d74f1677cf08f0a1cb84354c9b53"], ["V3 cand 278d", "0x278d858f05b94576c1e6f73285886876ff6ef8d2"]]) {
  console.log(label, "factory()", tail(await call(a, "0xc45a0155")), "WETH()", tail(await call(a, "0xad5c4648")), "WETH9()", tail(await call(a, "0x4aa4a4fc")));
}
