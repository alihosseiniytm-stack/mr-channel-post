import { rpc, mod, findSlots, overrideFor } from "./sim.mjs";
const user = "0x00000000000000000000000000000000000dEaD1";
const cases = [
  // chain, label, inTok, outTok, amount(human), inDec, nativeIn, nativeOut
  ["bsc", "USDT -> CAKE", "stable", "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", 100, 18, false, false],
  ["bsc", "CAKE -> USDT", "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", "stable", 20, 18, false, false],
  ["bsc", "CAKE -> BNB",  "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", "native", 20, 18, false, true],
  ["bsc", "BNB -> CAKE",  "native", "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", 0.2, 18, true, false],
  ["eth", "USDT -> ETH",  "stable", "native", 200, 6, false, true],
  ["eth", "USDC -> LINK", "usdc", "0x514910771af9ca656af840dff83e8264ecf986ca", 200, 6, false, false],
  ["eth", "LINK -> USDC", "0x514910771af9ca656af840dff83e8264ecf986ca", "usdc", 10, 18, false, false],
  ["eth", "LINK -> ETH",  "0x514910771af9ca656af840dff83e8264ecf986ca", "native", 10, 18, false, true],
];
for (const [chain, label, a, b, hum, dec, nIn, nOut] of cases) {
  try {
    const W = chain === "bsc" ? "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" : "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    const stab = mod.ENG_STABLES[chain];
    const resolve = (x) => x === "stable" ? stab[0].a : x === "usdc" ? stab[1].a : x === "native" ? W : x;
    const tIn = resolve(a), tOut = resolve(b), amount = BigInt(Math.round(hum * 10 ** Math.min(dec, 9))) * 10n ** BigInt(Math.max(0, dec - 9));
    const route = await mod.engBestRoute(chain, tIn, tOut, amount);
    if (!route) { console.log(label.padEnd(14), chain, "NO ROUTE"); continue; }
    const kinds = [route];
    // also force the other family when both exist, to test both calldata builders
    const rs = route.rs; const viaW = tIn.toLowerCase() !== W.toLowerCase() && tOut.toLowerCase() !== W.toLowerCase();
    if (route.kind === "v3" && rs.v2) { const p = viaW ? [tIn, W, tOut] : [tIn, tOut]; const o = await mod.engV2Quote(chain, rs, p, amount); if (o > 0n) kinds.push({ kind: "v2", path: p, out: o, rs }); }
    if (route.kind === "v2" && rs.v3q) { for (const f of [500, 3000, 100, 2500, 10000]) { const p = viaW ? [tIn, f, W, 3000, tOut] : [tIn, f, tOut]; const o = await mod.engV3Quote(chain, rs, p, amount); if (o > 0n) { kinds.push({ kind: "v3", path: p, fees: [f], out: o, rs }); break; } } }
    for (const rt of kinds) {
      const minOut = rt.out * 88n / 100n;
      const tx = mod.engBuildSwap(chain, rt, nIn, nOut, amount, minOut, user);
      const ov = { [user]: { balance: "0x" + (10n ** 20n).toString(16) } };
      if (!nIn) { const spender = mod.engSpender(rt); const slots = await findSlots(chain, tIn, user, spender); if (slots.balSlot === null || slots.allowSlot === null) { console.log(label.padEnd(14), chain, rt.kind, "slot discovery failed", slots); continue; } ov[tIn] = overrideFor(tIn, user, spender, slots); }
      try { const r = await rpc(chain, "eth_call", [{ from: user, to: tx.to, data: tx.data, value: tx.value }, "latest", ov]); const ret = r && r.length >= 66 && rt.kind === "v3" ? "out=" + BigInt("0x" + r.slice(2, 66)) + " quote=" + rt.out : "no revert"; console.log(label.padEnd(14), chain, rt.kind.padEnd(2), "SIM OK", ret); }
      catch (e) { console.log(label.padEnd(14), chain, rt.kind.padEnd(2), "SIM FAIL:", e.message.slice(0, 100)); }
    }
  } catch (e) { console.log(label, "ERR", e.message.slice(0, 100)); }
}
