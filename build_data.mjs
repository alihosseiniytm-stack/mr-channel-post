// Builds the data JSON for the channel image from the PUBLIC MarketRadar endpoints + Hyperliquid (24h change uses prevDayPx, so it is always the 24-hour move).
// usage: node build_data.mjs en > data.json
const lang = process.argv[2] || "en";
const BASE = process.env.MR_BASE || "https://marketradarwhale.com";
const T = {
  en: { title: "Whale radar", sentiment: "Whale positioning (futures)", big: "Biggest open whale positions", flow: "Whale net flow (new money)", agree: "Whales agree on", move: "Market movers (24h)", short: "short", long: "long", whales: "whales", foot: "Live from Hyperliquid. Not financial advice." },
};
const L = T[lang] || T.en;
const get = async (p) => { const r = await fetch(BASE + p, { headers: { accept: "application/json" } }); if (!r.ok) throw new Error(p + " " + r.status); return r.json(); };
const usd = (n) => { const a = Math.abs(n); const s = a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + "M" : a >= 1e3 ? (a / 1e3).toFixed(0) + "K" : a.toFixed(0); return "$" + s; };
const sgn = (n) => (n >= 0 ? "+" : "-") + usd(n);
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const px = (n) => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toPrecision(3));

const [sent, pos, flow, cons, hl] = await Promise.all([
  get("/whale-sentiment").catch(() => null), get("/whale-live-positions").catch(() => null), get("/whale-netflow").catch(() => null), get("/whale-consensus").catch(() => null),
  fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }) }).then((r) => r.json()).catch(() => null),
]);
const cards = [];
if (sent && sent.coins) {
  const rows = sent.coins.slice(0, 3).map((c) => { const t = c.long + c.short || 1; const sp = Math.round((c.short / t) * 100); return { name: c.coin, value: usd(t), change: sp >= 50 ? sp + "% " + L.short : (100 - sp) + "% " + L.long, side: sp >= 50 ? "dn" : "up" }; });
  const tl = sent.totalLong, ts = sent.totalShort, tt = tl + ts || 1;
  rows.unshift({ name: "ALL", value: usd(tt), change: Math.round((ts / tt) * 100) >= 50 ? Math.round((ts / tt) * 100) + "% " + L.short : Math.round((tl / tt) * 100) + "% " + L.long, side: ts >= tl ? "dn" : "up" });
  cards.push({ title: L.sentiment, rows });
}
if (Array.isArray(pos)) {
  const rows = pos.slice().sort((a, b) => b.value - a.value).slice(0, 4).map((p) => ({ name: (Number(p.szi) < 0 ? "SHORT " : "LONG ") + p.coin + " " + p.leverage + "x", value: usd(p.value) + " · " + short(p.address), change: sgn(p.pnl), side: p.pnl >= 0 ? "up" : "dn" }));
  if (rows.length) cards.push({ title: L.big, rows });
}
if (cons && cons.coins) {
  const rows = cons.coins.map((c) => { const l = c.long ? c.long.n : 0, s = c.short ? c.short.n : 0; const side = l >= s ? "long" : "short"; const n = Math.max(l, s); const usdv = (side === "long" ? c.long.usd : c.short.usd) || 0; return { coin: c.coin, n, side, usdv, other: Math.min(l, s) }; })
    .filter((x) => x.n >= 3).sort((a, b) => b.n - a.n || b.usdv - a.usdv).slice(0, 4)
    .map((x) => ({ name: x.coin, value: x.n + " " + L.whales + " · " + usd(x.usdv), change: L[x.side].toUpperCase(), side: x.side === "long" ? "up" : "dn" }));
  if (rows.length) cards.push({ title: L.agree, rows });
}
if (flow && flow.coins) {
  const rows = flow.coins.slice().sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 5).map((c) => ({ name: c.coin, value: sgn(c.net), change: c.net >= 0 ? "IN" : "OUT", side: c.net >= 0 ? "up" : "dn" }));
  
}
if (hl && hl[0] && hl[1]) {
  const ms = hl[0].universe.map((u, i) => { const c = hl[1][i] || {}; const m = Number(c.markPx), p = Number(c.prevDayPx), v = Number(c.dayNtlVlm); return { coin: u.name, m, chg: p ? (m / p - 1) * 100 : 0, v, del: u.isDelisted }; }).filter((x) => !x.del && x.v > 5e6 && x.m);
  const up = ms.slice().sort((a, b) => b.chg - a.chg).slice(0, 2), dn = ms.slice().sort((a, b) => a.chg - b.chg).slice(0, 2);
  const f = (x) => ({ name: x.coin, value: "$" + px(x.m), change: (x.chg >= 0 ? "+" : "") + x.chg.toFixed(1) + "%", side: x.chg >= 0 ? "up" : "dn" });
  cards.push({ title: L.move, rows: [...up.map(f), ...dn.map(f)] });
}
const date = new Date().toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
console.log(JSON.stringify({ title: L.title, date, dir: "ltr", footer: L.foot, cards }, null, 1));
