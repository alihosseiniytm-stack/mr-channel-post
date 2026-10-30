// Card v3 samples from LIVE data (nothing posted): quality-gated whales, fresh < 2 h. usage: node x_samples_v3.mjs [minUsd]  -> x-img/samples_v3/post_*.png
import fs from "node:fs";
import { findEvents } from "./x_post.mjs";
import { renderCard, closeCards } from "./x_card.mjs";
import { makeText } from "./x_lib.mjs";
const hl = (b) => fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const now = Date.now(), evs = await findEvents(now);
console.log("events:", evs.length);
fs.mkdirSync("x-img/samples_v3", { recursive: true });
const seen = new Set(), picks = [];
for (const m of evs) { const k = m.address + m.coin; if (seen.has(k)) continue; seen.add(k); picks.push(m); if (picks.length >= 3) break; }
for (const [i, m] of picks.entries()) {
  const candles = (await hl({ type: "candleSnapshot", req: { coin: m.coin, interval: "15m", startTime: now - 13 * 3600e3 } })).map((c) => ({ t: c.t, o: +c.o, h: +c.h, l: +c.l, c: +c.c }));
  const f = `x-img/samples_v3/post${i + 1}_${m.side}_${m.coin}.png`; await renderCard(m, candles, f);
  console.log("OK", f, `fill ${((now - m.fillT) / 60000).toFixed(0)} min old`, m.label, "30d", Math.round(m.pnl30 ?? m.pnlMonth)); console.log(makeText(m, undefined, true).text);
}
await closeCards();
