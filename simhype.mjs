import { keccak256, concat, pad, toHex, hexToBigInt } from "viem";
const U = "https://rpc.hyperliquid.xyz/evm";
const rpc = async (m, p) => { const j = await (await fetch(U, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) })).json(); if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200)); return j.result; };
const w = (x) => x.toLowerCase().replace("0x", "").padStart(64, "0"), u = (n) => BigInt(n).toString(16).padStart(64, "0");
const W = "0x5555555555555555555555555555555555555555", USDC = "0xb88339CB7199b77E23DB6E890353E22632Ba630f", USDT0 = "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb";
const ROUTERS = { prjx: ["0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B", "0x239F11a7A3E08f2B8110D4CA9F6B95d4c8865258"], hyperswap: ["0x4E2960a8cd19B467b82d26D83fAcb0fAE26b094D", "0x03A918028f22D9E1473B7959C927AD7425A45C7C"] };
const user = "0x1111111111111111111111111111111111111111";
const path = (a, fee, b) => (a + fee.toString(16).padStart(6, "0") + b.slice(2)).toLowerCase().replace(/^0x/, "");
function exactInput(user, pathHex, amountIn, minOut, deadline) {
  const len = pathHex.length / 2, padded = pathHex + "0".repeat((64 - (pathHex.length % 64)) % 64);
  return "0xc04b8d59" + u(32) + u(160) + w(user) + u(deadline) + u(amountIn) + u(minOut) + u(len) + padded;
}
const deadline = Math.floor(Date.now() / 1000) + 1200;
for (const [name, [router, quoter]] of Object.entries(ROUTERS)) {
  // native HYPE in -> USDC out
  const amt = 10n ** 18n;
  const pHex = path(W, 500, USDC);
  const data = exactInput(user, pHex, amt, 0, deadline);
  try {
    const r = await rpc("eth_call", [{ from: user, to: router, data, value: "0x" + amt.toString(16) }, "latest", { [user]: { balance: "0x" + (10n ** 21n).toString(16) } }]);
    console.log(name, "native HYPE->USDC exactInput simulated out:", Number(BigInt(r)) / 1e6, "USDC");
  } catch (e) { console.log(name, "native-in FAILED", e.message); }
}
// token in: scan slots for USDT0 on prjx router
async function slots(token, spender) {
  const BIG = "0x" + (10n ** 30n).toString(16).padStart(64, "0"); let bal = null, al = null;
  for (let s = 0; s < 30 && bal === null; s++) { const key = keccak256(concat([pad(user, { size: 32 }), pad(toHex(s), { size: 32 })])); const r = await rpc("eth_call", [{ to: token, data: "0x70a08231" + w(user) }, "latest", { [token]: { stateDiff: { [key]: BIG } } }]); if (hexToBigInt(r) === 10n ** 30n) bal = s; }
  for (let s = 0; s < 30 && al === null; s++) { const inner = keccak256(concat([pad(user, { size: 32 }), pad(toHex(s), { size: 32 })])); const key = keccak256(concat([pad(spender, { size: 32 }), inner])); const r = await rpc("eth_call", [{ to: token, data: "0xdd62ed3e" + w(user) + w(spender) }, "latest", { [token]: { stateDiff: { [key]: BIG } } }]); if (hexToBigInt(r) === 10n ** 30n) al = s; }
  return { bal, al, BIG };
}
for (const [tname, token] of [["USDT0", USDT0], ["USDC", USDC]]) {
  const [router] = ROUTERS.prjx; const sl = await slots(token, router);
  console.log(tname, "slots", sl.bal, sl.al);
  if (sl.bal === null || sl.al === null) continue;
  const bkey = keccak256(concat([pad(user, { size: 32 }), pad(toHex(sl.bal), { size: 32 })]));
  const inner = keccak256(concat([pad(user, { size: 32 }), pad(toHex(sl.al), { size: 32 })])); const akey = keccak256(concat([pad(router, { size: 32 }), inner]));
  const amt = 100n * 10n ** 6n;
  const data = exactInput(user, path(token, 500, W), amt, 0, deadline);
  try { const r = await rpc("eth_call", [{ from: user, to: router, data }, "latest", { [token]: { stateDiff: { [bkey]: sl.BIG, [akey]: sl.BIG } } }]); console.log("prjx", tname, "-> WHYPE simulated out:", Number(BigInt(r)) / 1e18); } catch (e) { console.log("prjx", tname, "FAILED", e.message); }
}
