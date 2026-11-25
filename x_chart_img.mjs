// ONE X image look (T40-24 #x-chart, owner D349 + D351 2026-11-25): every X image (whale long/short card, big transfer, 24 h after-post,
// daily net-flow card) = OUR chart style: candles from the SAME source the live /en/chart/ reads (wh.marketradarwhale.com/candles, plan B
// Hyperliquid candleSnapshot), colours read LIVE from the site design tokens (the tokens.*.css the chart page links), so when the site look
// changes the X images change with it (no second chart design). Plan B tokens = the last known values below.
// Why not a screenshot of /en/chart/? Tested 2026-11-25 (headless, 1200x675): it works but carries the toolbar/drawing bar/sign-in UI and
// no API to place OUR marker on a candle; a render from the same JSON + same tokens gives a clean 1200x675 card (brief plan C).
import { chromium } from "playwright-core";

export const DEF_TOK = { bg: "#070b0f", panel: "#0d151b", panel2: "#121e26", border: "#1c2e38", accent: "#35e6b8", ink: "#eaf6f2", inkDim: "#7fa39a", up: "#35e6b8", down: "#ff5470", src: "default" };
const VARS = { "--bg": "bg", "--panel": "panel", "--panel-2": "panel2", "--border": "border", "--accent": "accent", "--ink": "ink", "--ink-dim": "inkDim", "--up": "up", "--down": "down" };
// first plain :root{...} block of the site tokens css = the dark (default) theme
export function parseTokens(css) {
  const m = String(css || "").match(/:root\s*\{([^}]*)\}/); const t = { ...DEF_TOK, src: "default" }; if (!m) return t;
  let n = 0; for (const [, k, v] of m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) if (VARS[k]) { t[VARS[k]] = v; n++; }
  if (n >= 5) t.src = "site"; return t;
}
let tokCache = null;
export async function siteTokens(base = "https://marketradarwhale.com") {
  if (tokCache) return tokCache;
  try {
    const html = await fetch(base + "/en/chart/", { signal: AbortSignal.timeout(15000) }).then((r) => r.text());
    const href = (html.match(/href="(\/assets\/tokens\.[^"]+\.css)"/) || [])[1]; if (!href) throw new Error("no tokens css link");
    tokCache = parseTokens(await fetch(base + href, { signal: AbortSignal.timeout(15000) }).then((r) => r.text()));
  } catch (e) { console.log("tokens: plan B default colours (" + e.message + ")"); tokCache = { ...DEF_TOK }; }
  return tokCache;
}
const TF_MS = { "15m": 900e3, "1h": 3600e3, "4h": 14400e3 };
// candles [{t ms, o, h, l, c}] oldest first; A = our candle store (the live chart's source), B = Hyperliquid
export async function getCandles(coin, tf = "1h", n = 48) {
  try {
    const j = await fetch(`https://wh.marketradarwhale.com/candles?m=${encodeURIComponent(coin)}&tf=${tf}&limit=${n}`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
    const c = (j.d || []).map((r) => ({ t: r[0] * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4] })).filter((r) => isFinite(r.c));
    if (c.length >= Math.min(n, 12)) return { candles: c.slice(-n), src: "mr-candles" };
  } catch (e) { console.log("candles A failed:", e.message); }
  const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: tf, startTime: Date.now() - (n + 1) * (TF_MS[tf] || 3600e3) } }), signal: AbortSignal.timeout(15000) }).then((r) => r.json());
  return { candles: (r || []).map((c) => ({ t: c.t, o: +c.o, h: +c.h, l: +c.l, c: +c.c })).slice(-n), src: "hyperliquid" };
}
export const px = (n) => (n >= 1000 ? Math.round(n).toLocaleString("en-US") : n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toPrecision(3));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const candleAt = (candles, t) => candles.filter((c) => c.t <= t).at(-1) || null;

// opt: { candles, tok, W, H, lines:[{p, label, color, dash}], marks:[{t, dir:"up"|"down", color, label}], bars:[{t, v}] (sub pane, +v up colour), badge:{text, sub, color} }
export function chartSvg(opt) {
  const { candles, tok = DEF_TOK, W = 1100, lines = [], marks = [], bars = null, badge = null } = opt;
  const H = (opt.H || 360) - (bars ? 80 : 0);
  const ps = [...candles.flatMap((c) => [c.l, c.h]), ...lines.map((l) => l.p).filter((p) => isFinite(p))];
  const lo = Math.min(...ps), hi = Math.max(...ps), pad = (hi - lo) * 0.1 || 1, y0 = lo - pad, y1 = hi + pad;
  const step = candles.length > 1 ? candles[1].t - candles[0].t : 3600e3, t0 = candles[0].t, t1 = candles.at(-1).t + step;
  const AX = W - 134, CW = badge ? Math.round(W * 0.74) : AX - 10;
  const X = (t) => ((t - t0) / (t1 - t0)) * CW, Y = (p) => H - ((p - y0) / (y1 - y0)) * H, w = Math.max(2, CW / candles.length - 2);
  const grid = [0, 1, 2, 3].map((i) => { const p = y0 + ((y1 - y0) * i) / 3, y = Y(p); const hide = lines.some((l) => Math.abs(Y(l.p) - y) < 22);
    return `<line x1="0" x2="${AX}" y1="${y}" y2="${y}" stroke="${tok.border}"/>${hide ? "" : `<text x="${AX + 10}" y="${y + 7}" fill="${tok.inkDim}" font-size="20">${px(p)}</text>`}`; }).join("");
  const body = candles.map((c) => { const col = c.c >= c.o ? tok.up : tok.down, x = X(c.t) + w / 2;
    return `<line x1="${x}" x2="${x}" y1="${Y(c.h)}" y2="${Y(c.l)}" stroke="${col}" stroke-width="1.5"/><rect x="${x - w / 2}" y="${Math.min(Y(c.o), Y(c.c))}" width="${w}" height="${Math.max(1.5, Math.abs(Y(c.o) - Y(c.c)))}" fill="${col}"/>`; }).join("");
  // horizontal level lines + their right-axis labels (kept >= 34 px apart)
  const ys = lines.map((l) => Y(l.p)).map((y, i, a) => y); for (let k = 0; k < 3; k++) for (let i = 1; i < ys.length; i++) for (let j = 0; j < i; j++) if (Math.abs(ys[i] - ys[j]) < 34) ys[i] = ys[j] + (ys[i] >= ys[j] ? 34 : -34);
  const lv = lines.map((l, i) => { const y = Y(l.p), ly = Math.min(Math.max(ys[i], 16), H - 4);
    return `<line x1="0" x2="${AX}" y1="${y}" y2="${y}" stroke="${l.color}" stroke-width="2.5"${l.dash ? ` stroke-dasharray="${l.dash}"` : ""}/><rect x="${AX + 2}" y="${ly - 16}" width="${W - AX - 2}" height="32" rx="5" fill="${l.color}"/><text x="${AX + 10}" y="${ly + 7}" fill="${tok.bg}" font-size="18" font-weight="700">${esc(l.label)}</text>`; }).join("");
  // markers on the candle of the event: "down" = arrow above the high pointing down, "up" = arrow below the low pointing up, + label box
  const mk = marks.map((m) => { const c = candleAt(candles, m.t) || candles[0], x = X(c.t) + w / 2, dn = m.dir === "down";
    const ay = dn ? Y(c.h) - 8 : Y(c.l) + 8, pts = dn ? `${x},${ay} ${x - 12},${ay - 22} ${x + 12},${ay - 22}` : `${x},${ay} ${x - 12},${ay + 22} ${x + 12},${ay + 22}`;
    const lw = Math.max(90, String(m.label || "").length * 11 + 20), lx = Math.min(Math.max(x - lw / 2, 0), CW - lw), lyy = dn ? Math.max(ay - 62, -10) : Math.min(ay + 30, H - 24);
    return `<line x1="${x}" x2="${x}" y1="0" y2="${H}" stroke="${m.color}" stroke-dasharray="3 5" opacity="0.55"/><polygon points="${pts}" fill="${m.color}" stroke="${tok.bg}" stroke-width="2"/>${m.label ? `<rect x="${lx}" y="${lyy}" width="${lw}" height="32" rx="6" fill="${m.color}"/><text x="${lx + lw / 2}" y="${lyy + 22}" text-anchor="middle" fill="${tok.bg}" font-size="18" font-weight="800">${esc(m.label)}</text>` : ""}`; }).join("");
  let sub = "";
  if (bars) { const mx = Math.max(1, ...bars.map((b) => Math.abs(b.v))), base = H + 50;
    sub = `<line x1="0" x2="${AX}" y1="${base}" y2="${base}" stroke="${tok.border}"/><text x="${AX + 10}" y="${base + 7}" fill="${tok.inkDim}" font-size="16">net flow</text>` + bars.map((b) => { const c = candleAt(candles, b.t); if (!c) return ""; const h = (Math.abs(b.v) / mx) * 34;
      return `<rect x="${X(c.t)}" y="${b.v >= 0 ? base - h : base}" width="${w}" height="${Math.max(1, h)}" fill="${b.v >= 0 ? tok.up : tok.down}"/>`; }).join(""); }
  const bg = badge ? (() => { const bx = CW + 14, bw = AX - CW - 28, by = H / 2; return `<rect x="${bx}" y="${by - 34}" width="${bw}" height="68" rx="10" fill="${badge.color}"/><text x="${bx + bw / 2}" y="${by + 2}" text-anchor="middle" fill="${tok.bg}" font-size="28" font-weight="800">${esc(badge.text)}</text><text x="${bx + bw / 2}" y="${by + 25}" text-anchor="middle" fill="${tok.bg}" font-size="16" font-weight="600">${esc(badge.sub || "")}</text>`; })() : "";
  const TH = H + (bars ? 80 : 0);
  return `<svg width="${W}" height="${TH + 24}" viewBox="0 -12 ${W} ${TH + 24}">${grid}${body}${lv}${mk}${sub}${bg}</svg>`;
}

// the one card frame: brand line + date, title, up to 4 number tiles, the chart, footer (coin/tf left, site right)
export function frameHtml({ tok = DEF_TOK, title, titleColor, when, nums = [], svg, foot }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0}
body{width:1200px;height:675px;background:${tok.bg};color:${tok.ink};font-family:"Segoe UI","Noto Sans",Arial,"Noto Color Emoji",sans-serif;padding:30px 50px;position:relative;overflow:hidden}
.top{display:flex;justify-content:space-between;align-items:center}.brand{font-size:26px;font-weight:700;color:${tok.accent}}.dt{font-size:22px;color:${tok.inkDim}}
h1{font-size:46px;margin:10px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}h1 b{color:${titleColor || tok.accent}}
.nums{display:flex;gap:16px;margin:10px 0 8px}.n{flex:1;background:${tok.panel};border:1px solid ${tok.border};border-radius:12px;padding:10px 16px}
.n span{display:block;font-size:17px;color:${tok.inkDim}}.n b{font-size:30px;white-space:nowrap}
.wm{position:absolute;left:0;right:0;top:390px;text-align:center;font-size:64px;font-weight:800;color:${tok.ink};opacity:.05}
.foot{position:absolute;bottom:12px;left:50px;right:50px;display:flex;justify-content:space-between;color:${tok.inkDim};font-size:18px}</style></head><body>
<div class="top"><div class="brand">🐋 MarketRadar Whale</div><div class="dt">${esc(when)}</div></div>
<h1>${title}</h1>
${nums.length ? `<div class="nums">${nums.map(([k, v]) => `<div class="n"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>` : ""}
<div class="wm">MarketRadar Whale</div>
${svg}
<div class="foot"><span>${esc(foot || "")}</span><span>marketradarwhale.com</span></div></body></html>`;
}
export const whenUtc = (t) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

let browser;
export async function renderPng(html, file) {
  browser ||= await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const pg = await browser.newPage({ viewport: { width: 1200, height: 675 } });
  await pg.setContent(html); await pg.screenshot({ path: file }); await pg.close();
}
export async function closeImg() { if (browser) await browser.close(); browser = null; }
