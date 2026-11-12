import { createPublicClient, http, encodeFunctionData, parseAbi, keccak256, encodeAbiParameters, parseAbiParameters, pad, toHex } from "viem";
const RPCS = { bsc: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"], eth: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"] };
for (const [chain, list] of Object.entries(RPCS)) for (const url of list) {
  try {
    const call = async (params, extra) => (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: extra ? [params, "latest", extra] : [params, "latest"] }) })).json();
    const base = await call({ to: chain === "bsc" ? "0x55d398326f99059fF775485246999027B3197955" : "0xdAC17F958D2ee523a2206206994597C13D831ec7", data: "0x313ce567" });
    const ov = await call({ to: chain === "bsc" ? "0x55d398326f99059fF775485246999027B3197955" : "0xdAC17F958D2ee523a2206206994597C13D831ec7", data: "0x313ce567" }, { "0x0000000000000000000000000000000000000001": { balance: "0xde0b6b3a7640000" } });
    console.log(chain, url, "decimals:", base.result, "| with stateOverride:", ov.result || JSON.stringify(ov.error).slice(0, 80));
  } catch (e) { console.log(chain, url, "ERR", e.message); }
}
