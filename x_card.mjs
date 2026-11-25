// X whale long/short card (1200x675). Since T40-24 #x-chart (owner D351 2026-11-25) it uses the ONE X image look of x_chart_img.mjs:
// our chart style + site design tokens; candles (15m, last 12 h) with the whale ENTRY (dashed line + arrow on the entry candle),
// the LIQUIDATION level when Hyperliquid gives it (m.liq), the NOW line and the ROE badge. Old v2 card: backups t40-24-x-chart_20261125T1758Z.
import { usd, px, sg } from "./x_lib.mjs";
import { chartSvg as chart, frameHtml, siteTokens, renderPng, closeImg, whenUtc, DEF_TOK } from "./x_chart_img.mjs";

const BLUE = "#378ADD";
export function chartSvg(all, entry, entryT, side, now, lev, liq = null, tok = DEF_TOK) {
  const candles = all.filter((c) => c.t >= all.at(-1).t - 12 * 3600e3); // last 12 h only
  const cur = now ?? candles.at(-1).c, long = side === "LONG", profit = long ? cur >= entry : cur <= entry, zc = profit ? tok.up : tok.down;
  const move = ((cur - entry) / entry) * (long ? 1 : -1) * 100, roe = move * (lev || 1);
  // liq level only when it is on a readable scale (within 25% of the price), else it would flatten the candles
  const liqOk = isFinite(liq) && liq > 0 && Math.abs(liq - cur) / cur <= 0.25;
  const lines = [{ p: entry, label: "Entry " + px(entry), color: BLUE, dash: "8 6" }, { p: cur, label: "Now " + px(cur), color: zc }];
  if (liqOk) lines.push({ p: liq, label: "Liq " + px(liq), color: tok.down, dash: "2 6" });
  return chart({ candles, tok, W: 1100, H: 330, lines, marks: [{ t: entryT, dir: long ? "up" : "down", color: long ? tok.up : tok.down, label: "" }],
    badge: { text: (roe >= 0 ? "+" : "−") + Math.abs(roe).toFixed(1) + "%", sub: "ROE" + (lev ? " (" + lev + "x)" : ""), color: zc } });
}

export function cardHtml(m, candles, tok = DEF_TOK) {
  const col = m.side === "LONG" ? tok.up : tok.down;
  const nums = [["Position", usd(m.notional)], ["Entry", "$" + px(m.entry)], ["Leverage", m.lev ? m.lev + "x" : "—"], ["Whale 30d profit", m.pnl30 != null ? sg(m.pnl30) : m.pnlMonth != null ? sg(m.pnlMonth) : "—"]];
  return frameHtml({ tok, title: `<b style="color:${col}">${m.side}</b> ${m.coin} · ${m.label}`, titleColor: col, when: whenUtc(m.fillT), nums,
    svg: chartSvg(candles, m.entry, m.fillT, m.side, m.now, m.lev, m.liq, tok), foot: `${m.coin} 15m candles, last 12 h${isFinite(m.liq) ? " · liquidation level" : ""}` });
}

export async function renderCard(m, candles, file) { await renderPng(cardHtml(m, candles, await siteTokens()), file); }
export const closeCards = closeImg;
