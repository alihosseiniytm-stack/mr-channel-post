// Clean X image card v2 (1200x675): brand, side+coin, 4 numbers, 24 h 15m candlestick chart in the Mini App whale-chart style:
// dashed ENTRY line + solid NOW line (coloured labels on the right axis), entry arrow, shaded entry->now zone (green profit / red loss) + P/L badge.
// m.now = current price (optional; without it the chart shows entry only). Colours = Mini App (--up #35e6b8, --down #ff5470, entry blue #378ADD, grid #1c2e38).
import { chromium } from "playwright-core";
import { usd, px, sg } from "./x_lib.mjs";

const UP = "#35e6b8", DN = "#ff5470", BLUE = "#378ADD", GRID = "#1c2e38", TXT = "#7fa39a";

export function chartSvg(all, entry, entryT, side, now, lev, W = 1100, H = 330) {
  const candles = all.filter((c) => c.t >= all.at(-1).t - 12 * 3600e3); // last 12 h only: y-range hugs the recent price
  const cur = now ?? candles.at(-1).c;
  const lo = Math.min(...candles.map((c) => c.l), entry, cur), hi = Math.max(...candles.map((c) => c.h), entry, cur);
  const pad = (hi - lo) * 0.1 || 1, y0 = lo - pad, y1 = hi + pad, t0 = candles[0].t, t1 = candles.at(-1).t + 900e3;
  const AX = W - 134, CW = Math.round(W * 0.75); // candles end at 76% of the width; AX = left edge of the price-label column
  const X = (t) => ((t - t0) / (t1 - t0)) * CW, Y = (p) => H - ((p - y0) / (y1 - y0)) * H;
  const w = Math.max(2, CW / candles.length - 2);
  const bars = candles.map((c) => { const up = c.c >= c.o, col = up ? UP : DN, x = X(c.t) + w / 2;
    return `<line x1="${x}" x2="${x}" y1="${Y(c.h)}" y2="${Y(c.l)}" stroke="${col}" stroke-width="1.5"/><rect x="${x - w / 2}" y="${Math.min(Y(c.o), Y(c.c))}" width="${w}" height="${Math.max(1.5, Math.abs(Y(c.o) - Y(c.c)))}" fill="${col}"/>`; }).join("");
  const long = side === "LONG", ey = Y(entry), ny = Y(cur), profit = long ? cur >= entry : cur <= entry, zc = profit ? UP : DN;
  const ec = candles.filter((c) => c.t <= entryT).at(-1) || candles[0], ex = X(ec.t) + w / 2;
  // grid: 4 lines; hide a grid label that would sit under an entry/now label
  const grid = [0, 1, 2, 3].map((i) => { const p = y0 + ((y1 - y0) * i) / 3, y = Y(p); const hide = Math.abs(y - ey) < 22 || Math.abs(y - ny) < 22;
    return `<line x1="0" x2="${AX}" y1="${y}" y2="${y}" stroke="${GRID}"/>${hide ? "" : `<text x="${AX + 10}" y="${y + 7}" fill="${TXT}" font-size="20">${px(p)}</text>`}`; }).join("");
  // label boxes in the right column; keep them >= 34 px apart
  let ly = [ey, ny]; if (Math.abs(ly[0] - ly[1]) < 34) { const mid = (ly[0] + ly[1]) / 2, s = ly[0] <= ly[1] ? 1 : -1; ly = [mid - 17 * s, mid + 17 * s]; }
  const box = (y, col, txt, fg = "#06120f") => `<rect x="${AX + 2}" y="${y - 16}" width="${W - AX - 2}" height="32" rx="5" fill="${col}"/><text x="${AX + 10}" y="${y + 7}" fill="${fg}" font-size="19" font-weight="700">${txt}</text>`;
  const zone = Math.abs(ey - ny) > 1 ? `<rect x="${ex}" y="${Math.min(ey, ny)}" width="${Math.max(0, CW - ex)}" height="${Math.abs(ey - ny)}" fill="${zc}" opacity="0.3"/>` : "";
  const entryLine = `<line x1="0" x2="${AX}" y1="${ey}" y2="${ey}" stroke="${BLUE}" stroke-dasharray="8 6" stroke-width="2.5"/>`;
  const nowLine = `<line x1="0" x2="${AX}" y1="${ny}" y2="${ny}" stroke="${zc}" stroke-width="2.5"/>`;
  // entry arrow on the entry candle: long = arrow up under the bar, short = arrow down above it
  const ay = long ? Y(ec.l) + 8 : Y(ec.h) - 8, ar = long ? `${ex},${ay} ${ex - 11},${ay + 20} ${ex + 11},${ay + 20}` : `${ex},${ay} ${ex - 11},${ay - 20} ${ex + 11},${ay - 20}`;
  const arrow = `<polygon points="${ar}" fill="${long ? UP : DN}" stroke="#070b0f" stroke-width="2"/>`;
  // P/L badge in the empty gap between the last candle and the label column
  const move = ((cur - entry) / entry) * (long ? 1 : -1) * 100, roe = move * (lev || 1), bx = CW + 14, bw = AX - CW - 28, by = Math.min(Math.max((ey + ny) / 2, 40), H - 40);
  const pl = `<rect x="${bx}" y="${by - 34}" width="${bw}" height="68" rx="10" fill="${zc}"/><text x="${bx + bw / 2}" y="${by + 2}" text-anchor="middle" fill="#06120f" font-size="28" font-weight="800">${roe >= 0 ? "+" : "−"}${Math.abs(roe).toFixed(1)}%</text><text x="${bx + bw / 2}" y="${by + 25}" text-anchor="middle" fill="#06120f" font-size="16" font-weight="600">ROE${lev ? " (" + lev + "x)" : ""}</text>`;
  return `<svg width="${W}" height="${H + 24}" viewBox="0 -12 ${W} ${H + 24}">${grid}${zone}${bars}${entryLine}${nowLine}${arrow}${pl}${box(ly[0], BLUE, "Entry " + px(entry), "#fff")}${box(ly[1], zc, "Now " + px(cur))}</svg>`;
}

export function cardHtml(m, candles) {
  const col = m.side === "LONG" ? UP : DN;
  const when = new Date(m.fillT).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  const nums = [["Position", usd(m.notional)], ["Entry", "$" + px(m.entry)], ["Leverage", m.lev ? m.lev + "x" : "—"], ["Whale 30d profit", m.pnl30 != null ? sg(m.pnl30) : m.pnlMonth != null ? sg(m.pnlMonth) : "—"]];
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0}
body{width:1200px;height:675px;background:#070b0f;color:#eaf6f2;font-family:"Segoe UI","Noto Sans",Arial,"Noto Color Emoji",sans-serif;padding:34px 50px;position:relative}
.top{display:flex;justify-content:space-between;align-items:center}.brand{font-size:26px;font-weight:700;color:#5eb5f7}.dt{font-size:22px;color:#7fa39a}
h1{font-size:56px;margin:14px 0 4px}h1 b{color:${col}}.nums{display:flex;gap:18px;margin:12px 0 10px}.n{flex:1;background:#0d151b;border:1px solid #1c2e38;border-radius:12px;padding:12px 18px}
.n span{display:block;font-size:18px;color:#7fa39a}.n b{font-size:34px}.foot{position:absolute;bottom:14px;left:50px;right:50px;display:flex;justify-content:space-between;color:#7fa39a;font-size:18px}</style></head><body>
<div class="top"><div class="brand">🐋 MarketRadar Whale</div><div class="dt">${when}</div></div>
<h1><b>${m.side}</b> ${m.coin} · ${m.label}</h1>
<div class="nums">${nums.map(([k, v]) => `<div class="n"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
${chartSvg(candles, m.entry, m.fillT, m.side, m.now, m.lev)}
<div class="foot"><span>${m.coin} 15m candles, last 12 h</span><span>marketradarwhale.com</span></div></body></html>`;
}

let browser;
export async function renderCard(m, candles, file) {
  browser ||= await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: 1200, height: 675 } });
  await pg.setContent(cardHtml(m, candles)); await pg.screenshot({ path: file }); await pg.close();
}
export async function closeCards() { if (browser) await browser.close(); browser = null; }
