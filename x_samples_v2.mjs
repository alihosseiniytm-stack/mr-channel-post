// Card v2 samples from LIVE data (nothing posted). usage: node x_samples_v2.mjs  -> x-img/samples_v2/*.png
import fs from "node:fs";
import { CFG } from "./x_lib.mjs";
import { findEvents } from "./x_post.mjs";
import { renderCard, closeCards } from "./x_card.mjs";
CFG.FRESH_MS = 72 * 3600e3;
process.argv.push("--min", "100000");
const hl = (b) => fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const now = Date.now(), evs = await findEvents(now), mids = await hl({ type: "allMids" });
for (const e of evs) e.now = +mids[e.coin];
const pl = (e) => ((e.now - e.entry) / e.entry) * (e.side === "LONG" ? 1 : -1);
console.log(evs.map((e) => `${e.side} ${e.coin} ${(pl(e) * 100).toFixed(2)}% ${Math.round(e.notional)}`).join("\n"));
const pick = [evs.filter((e) => e.side === "LONG" && pl(e) > 0).sort((a, b) => pl(b) - pl(a))[0], evs.filter((e) => e.side === "SHORT" && pl(e) > 0).sort((a, b) => pl(b) - pl(a))[0], evs.filter((e) => pl(e) < 0).sort((a, b) => pl(a) - pl(b))[0]];
fs.mkdirSync("x-img/samples_v2", { recursive: true });
const names = ["long_profit", "short_profit", "loss"];
for (const [i, m] of pick.entries()) { if (!m) { console.log("missing", names[i]); continue; }
  const candles = (await hl({ type: "candleSnapshot", req: { coin: m.coin, interval: "15m", startTime: now - 24 * 3600e3 } })).map((c) => ({ t: c.t, o: +c.o, h: +c.h, l: +c.l, c: +c.c }));
  const f = `x-img/samples_v2/${names[i]}_${m.side}_${m.coin}.png`; await renderCard(m, candles, f); console.log("OK", f, (pl(m) * 100).toFixed(2) + "%"); }
await closeCards();
