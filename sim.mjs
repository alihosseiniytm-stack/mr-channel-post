import fs from "node:fs";
import { keccak256, concat, pad, toHex, hexToBigInt } from "viem";
const src = fs.readFileSync("../whale-alert-worker/src/tradeApp.js", "utf8");
const grab = (start, endMark) => { const a = src.indexOf(start); const b = src.indexOf(endMark, a); if (a < 0 || b < 0) throw new Error("grab " + start); return src.slice(a, b + endMark.length); };
const pre = grab("var EVM_DIRECT = {", "\n};") + "\n" + grab("var EVM_SERVICE_FEE_BPS", ";") + "\n" + grab("function evmPackPath(parts){", "\n}") + "\n" + grab("function evmWord(x){", "}") + "\n" + grab("function evmUintWord(n){", "}") + "\n";
const engine = fs.readFileSync("../whale-alert-worker/evm_engine.js", "utf8");
const RPC = { bsc: "https://bsc-rpc.publicnode.com", eth: "https://ethereum-rpc.publicnode.com" };
async function rpc(chain, method, params) { const r = await (await fetch(RPC[chain], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json(); if (r.error) throw new Error(r.error.message || JSON.stringify(r.error)); return r.result; }
const mod = new Function("evmProxyRpc", pre + engine + "\nreturn { engBestRoute, engBuildSwap, engSpender, ENG_STABLES, engApproveData, engWithdrawData, engRouterSet, engV2Quote, engV3Quote, engNorm };")(rpc);
export { rpc, mod, keccak256, concat, pad, toHex };
// ---- storage-slot discovery for state overrides ----
const BIG = "0x" + (10n ** 30n).toString(16).padStart(64, "0");
export async function findSlots(chain, token, holder, spender) {
  let balSlot = null, allowSlot = null;
  for (let s = 0; s < 20 && balSlot === null; s++) {
    const key = keccak256(concat([pad(holder, { size: 32 }), pad(toHex(s), { size: 32 })]));
    const r = await rpc(chain, "eth_call", [{ to: token, data: "0x70a08231" + holder.slice(2).padStart(64, "0") }, "latest", { [token]: { stateDiff: { [key]: BIG } } }]);
    if (hexToBigInt(r) === 10n ** 30n) balSlot = s;
  }
  for (let s = 0; s < 20 && allowSlot === null; s++) {
    const inner = keccak256(concat([pad(holder, { size: 32 }), pad(toHex(s), { size: 32 })]));
    const key = keccak256(concat([pad(spender, { size: 32 }), inner]));
    const r = await rpc(chain, "eth_call", [{ to: token, data: "0xdd62ed3e" + holder.slice(2).padStart(64, "0") + spender.slice(2).padStart(64, "0") }, "latest", { [token]: { stateDiff: { [key]: BIG } } }]);
    if (hexToBigInt(r) === 10n ** 30n) allowSlot = s;
  }
  return { balSlot, allowSlot };
}
export function overrideFor(token, holder, spender, slots) {
  const bkey = keccak256(concat([pad(holder, { size: 32 }), pad(toHex(slots.balSlot), { size: 32 })]));
  const inner = keccak256(concat([pad(holder, { size: 32 }), pad(toHex(slots.allowSlot), { size: 32 })]));
  const akey = keccak256(concat([pad(spender, { size: 32 }), inner]));
  return { stateDiff: { [bkey]: BIG, [akey]: BIG } };
}
