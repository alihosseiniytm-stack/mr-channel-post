import { rpc, mod, findSlots, overrideFor } from "./sim.mjs";
const user = "0x00000000000000000000000000000000000dEaD1";
const chain = "bsc", USDT = mod.ENG_STABLES.bsc[0].a;
const amount = 100n * 10n ** 18n;
// 1) route: 100 USDT -> BNB (native out)
const W = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const route = await mod.engBestRoute(chain, USDT, W, amount);
console.log("route USDT->BNB:", route && { kind: route.kind, fees: route.fees, out: Number(route.out) / 1e18 });
const minOut = route.out * 88n / 100n;
const tx = mod.engBuildSwap(chain, route, false, true, amount, minOut, user);
const spender = mod.engSpender(route);
const slots = await findSlots(chain, USDT, user, spender);
console.log("USDT slots:", slots);
const ov = { [USDT]: overrideFor(USDT, user, spender, slots), [user]: { balance: "0xde0b6b3a7640000" } };
try {
  if (route.kind === "v3") { console.log("v3 sell->native uses exactInput to the user (WBNB) in this engine; simulating the exactInput leg"); }
  const r = await rpc(chain, "eth_call", [{ from: user, to: tx.to, data: tx.data, value: tx.value }, "latest", ov]);
  console.log("SIM OK, returned:", String(r).slice(0, 80));
} catch (e) { console.log("SIM FAIL:", e.message); }
