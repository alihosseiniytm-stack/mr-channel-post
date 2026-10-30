// Clean X image card (1200x675): brand, side+coin, 4 numbers, 24 h 15m candlestick chart with the whale's ENTRY marker.
import { chromium } from "playwright-core";
import { usd, px, sg } from "./x_lib.mjs";

export function chartSvg(candles, entry, entryT, side, W = 1100, H = 300) {
  const lo = Math.min(...candles.map((c) => c.l), entry), hi = Math.max(...candles.map((c) => c.h), entry);
  const pad = (hi - lo) * 0.08 || 1, y0 = lo - pad, y1 = hi + pad, t0 = candles[0].t, t1 = candles.at(-1).t + 900e3;
  const X = (t) => ((t - t0) / (t1 - t0)) * (W - 90), Y = (p) => H - ((p - y0) / (y1 - y0)) * H;
  const w = Math.max(2, (W - 90) / candles.length - 2);
  const bars = candles.map((c) => { const up = c.c >= c.o, col = up ? "#4ade80" : "#f87171", x = X(c.t) + w / 2;
    return `<line x1="${x}" x2="${x}" y1="${Y(c.h)}" y2="${Y(c.l)}" stroke="${col}" stroke-width="1.5"/><rect x="${x - w / 2}" y="${Math.min(Y(c.o), Y(c.c))}" width="${w}" height="${Math.max(1.5, Math.abs(Y(c.o) - Y(c.c)))}" fill="${col}"/>`; }).join("");
  const ex = Math.min(Math.max(X(entryT), 0), W - 90), ey = Y(entry), mc = side === "LONG" ? "#4ade80" : "#f87171";
  const grid = [0, 1, 2, 3].map((i) => { const p = y0 + ((y1 - y0) * i) / 3; return `<line x1="0" x2="${W - 90}" y1="${Y(p)}" y2="${Y(p)}" stroke="#2b3d4f"/><text x="${W - 84}" y="${Y(p) + 5}" fill="#8fa3b8" font-size="16">${px(p)}</text>`; }).join("");
  return `<svg width="${W}" height="${H + 24}" viewBox="0 -12 ${W} ${H + 24}">${grid}${bars}<line x1="0" x2="${W - 90}" y1="${ey}" y2="${ey}" stroke="${mc}" stroke-dasharray="6 5" stroke-width="2"/><circle cx="${ex}" cy="${ey}" r="9" fill="#fff" stroke="${mc}" stroke-width="4"/><text x="${Math.min(ex + 14, W - 250)}" y="${ey + (side === "LONG" ? 30 : -14)}" fill="#fff" font-size="20" font-weight="700">ENTRY $${px(entry)}</text></svg>`;
}

export function cardHtml(m, candles) {
  const col = m.side === "LONG" ? "#4ade80" : "#f87171";
  const when = new Date(m.fillT).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  const nums = [["Position", usd(m.notional)], ["Entry", "$" + px(m.entry)], ["Leverage", m.lev ? m.lev + "x" : "—"], ["Whale 30d profit", m.rank ? sg(m.pnl30) : m.pnlMonth != null ? sg(m.pnlMonth) : "—"]];
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0}
body{width:1200px;height:675px;background:#101a24;color:#e8eef5;font-family:"Segoe UI","Noto Sans",Arial,"Noto Color Emoji",sans-serif;padding:34px 50px;position:relative}
.top{display:flex;justify-content:space-between;align-items:center}.brand{font-size:26px;font-weight:700;color:#5eb5f7}.dt{font-size:22px;color:#8fa3b8}
h1{font-size:56px;margin:14px 0 4px}h1 b{color:${col}}.nums{display:flex;gap:18px;margin:12px 0 14px}.n{flex:1;background:#1e2c3a;border:1px solid #2b3d4f;border-radius:12px;padding:12px 18px}
.n span{display:block;font-size:18px;color:#8fa3b8}.n b{font-size:34px}.foot{position:absolute;bottom:18px;left:50px;right:50px;display:flex;justify-content:space-between;color:#8fa3b8;font-size:18px}</style></head><body>
<div class="top"><div class="brand">🐋 MarketRadar Whale</div><div class="dt">${when}</div></div>
<h1><b>${m.side}</b> ${m.coin} · ${m.label}</h1>
<div class="nums">${nums.map(([k, v]) => `<div class="n"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
${chartSvg(candles, m.entry, m.fillT, m.side)}
<div class="foot"><span>${m.coin} 15m candles, last 24 h</span><span>marketradarwhale.com</span></div></body></html>`;
}

let browser;
export async function renderCard(m, candles, file) {
  browser ||= await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: 1200, height: 675 } });
  await pg.setContent(cardHtml(m, candles)); await pg.screenshot({ path: file }); await pg.close();
}
export async function closeCards() { if (browser) await browser.close(); browser = null; }
