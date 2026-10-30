// NEWS-EVENT whale posts (T50-11). Reusable template: event name + T0 (+ coins) -> 4 post types from OUR Hyperliquid whale data:
//   P1 shorts open before T0 | P2 biggest realized winners since T0 | P3 dip buyers after T0 | P4 self-custody angle.
// usage: node news_event.mjs --event "Binance hack" --t0 2026-10-29T20:24:00Z --coins BTC,ETH,BNB,SOL --out x-img/news_binance [--fills cache.json] [--mode analyze|publish] [--live]
//   analyze (default) = fetch/analyze, render 4 cards, write <out>/posts.json + telegram.txt, NOTHING sent.
//   publish = send posts.json to Buffer (P1 shareNow, P2-P4 customScheduled +2/+4/+6 h; draft unless --live). env BUFFER_API_KEY, BUFFER_CHANNEL_ID.
// TRUST GATE: facts only (times + sizes); assertClean() throws on accusation words; every text is checked before it is written.
import fs from "node:fs";
import { usd, px, qty, sg, sizeEmoji } from "./x_lib.mjs";

const BASE = "https://marketradarwhale.com", RAW = "https://raw.githubusercontent.com/alihosseiniytm-stack/mr-channel-post/main/";
export const FORBIDDEN = /insider|\bknew\b|\bknow(s|ing)?\b|suspicio|manipulat|front-?run|leak|tipped|accus|fraud|rigged|cheat|scam|predict|foresaw|foresee|illegal|criminal/i;
export function assertClean(t) { const m = String(t).match(FORBIDDEN); if (m) throw new Error("TRUST GATE: forbidden word '" + m[0] + "' in: " + String(t).slice(0, 80)); return t; }
export const hoursBefore = (t, t0) => { const m = Math.round((t0 - t) / 60000); return m < 90 ? m + " min" : m < 2880 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " d"; };
export const utc = (t) => new Date(t).toISOString().slice(11, 16) + " UTC";

// ---- pure selection helpers (unit-tested) ----
// position (signed coin size) of one wallet+coin right before t0, from its fills (needs startPosition on the fill)
export function posAtT0(fills, coin, t0) {
  const pre = fills.filter((x) => x.coin === coin && x.time < t0).sort((a, b) => a.time - b.time);
  if (!pre.length) return null;
  const l = pre.at(-1); return +l.startPosition + (l.side === "B" ? 1 : -1) * +l.sz;
}
// shorts: net short at t0, notional >= min, and an "Open Short" fill inside [t0-lookbackH, t0]
export function shortsAt(byAddr, t0, coins, min = 250e3, lookbackH = 24) {
  const out = [];
  for (const [addr, fills] of byAddr) for (const coin of coins) {
    const pos = posAtT0(fills, coin, t0); if (pos == null || pos >= 0) continue;
    const opens = fills.filter((x) => x.coin === coin && x.dir === "Open Short" && x.time < t0 && x.time >= t0 - lookbackH * 3600e3);
    if (!opens.length) continue;
    const last = opens.reduce((a, b) => (b.time > a.time ? b : a)), notional = Math.abs(pos) * +last.px;
    if (notional >= min) out.push({ addr, coin, size: Math.abs(pos), notional, lastOpenT: last.time, lastOpenPx: +last.px });
  }
  return out.sort((a, b) => b.notional - a.notional);
}
export function pnlSince(fills, coin, t0, pos, px0, midNow) { // short: P/L of the t0 position, closes after t0 realized at their fill price, rest marked to now
  let left = Math.abs(pos), pnl = 0;
  for (const f of fills.filter((x) => x.coin === coin && x.time >= t0 && /Close Short/.test(x.dir)).sort((a, b) => a.time - b.time)) { const q = Math.min(left, +f.sz); pnl += (px0 - +f.px) * q; left -= q; if (left <= 0) break; }
  return pnl + left * (px0 - midNow);
}
export const dipBuys = (byAddr, t0, coins, min = 250e3) => { const o = [];
  for (const [addr, fills] of byAddr) for (const coin of coins) { const b = fills.filter((x) => x.coin === coin && x.time >= t0 && x.dir === "Open Long"); if (!b.length) continue;
    const sz = b.reduce((s, x) => s + +x.sz, 0), n = b.reduce((s, x) => s + x.sz * x.px, 0); if (n >= min) o.push({ addr, coin, size: sz, notional: n, avg: n / sz, firstT: Math.min(...b.map((x) => x.time)) }); }
  return o.sort((a, b) => b.notional - a.notional); };
export const winners = (byAddr, t0, coins) => { const o = [];
  for (const [addr, fills] of byAddr) for (const coin of coins) { const f = fills.filter((x) => x.coin === coin && x.time >= t0); if (!f.length) continue; const p = f.reduce((s, x) => s + +x.closedPnl, 0); if (p > 0) o.push({ addr, coin, pnl: p, trades: f.length }); }
  return o.sort((a, b) => b.pnl - a.pnl); };

// ---- network ----
const hl = (b) => fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function loadFills(t0, coins, cache) {
  if (cache && fs.existsSync(cache)) return new Map(JSON.parse(fs.readFileSync(cache, "utf8")).map((o) => [o.a, o.f]));
  const [lb, feed] = await Promise.all([fetch(BASE + "/whale-leaderboard?limit=100").then((r) => r.json()), fetch(BASE + "/whale-feed").then((r) => r.json())]);
  const addrs = [...new Set([...lb.map((w) => w.address), ...feed.map((p) => p.address)].map((a) => a.toLowerCase()))], res = [];
  for (const a of addrs) { let f = []; try { f = await hl({ type: "userFillsByTime", user: a, startTime: t0 - 24 * 3600e3, endTime: Date.now() }); } catch { await sleep(3000); continue; }
    if (Array.isArray(f) && f.length) res.push({ a, f: f.filter((x) => coins.includes(x.coin)) }); await sleep(1100); }
  if (cache) fs.writeFileSync(cache, JSON.stringify(res));
  return new Map(res.map((o) => [o.a, o.f]));
}
async function profile(addr) { // track record: leaderboard rank/30d profit + win rate
  const [st, lb] = await Promise.all([fetch(BASE + "/whale-stats?addr=" + addr).then((r) => r.json()).catch(() => null), fetch(BASE + "/whale-leaderboard?limit=100").then((r) => r.json()).catch(() => [])]);
  const i = lb.sort((a, b) => b.pnl - a.pnl).findIndex((w) => w.address.toLowerCase() === addr);
  return { win: st?.winRate, trades: st?.trades, rank: i >= 0 ? i + 1 : null, pnl30: i >= 0 ? lb[i].pnl : null };
}
const rec = (p) => (p.rank ? `No. ${p.rank} of Hyperliquid whales this month (${sg(p.pnl30)})` : "") + (p.win != null && p.trades >= 5 ? `${p.rank ? " · " : ""}${Math.round(p.win * 100)}% win rate over ${p.trades} trades` : "");
const wurl = (a) => `${BASE}/en/whale/${a}/`;
const fit = (variants, max = 280) => { for (const v of variants) { const n = v.replace(/https?:\/\/\S+/g, "x".repeat(23)).length; if (n <= max) return v; } return variants.at(-1); };

// ---- cards (chartSvg from x_card; candle times are compressed so the 12 h filter inside chartSvg keeps the whole window) ----
import { chartSvg } from "./x_card.mjs";
import { chromium } from "playwright-core";
async function candlesFor(coin, from) { return (await hl({ type: "candleSnapshot", req: { coin, interval: "1h", startTime: from, endTime: Date.now() } })).map((c) => ({ t: c.t, o: +c.o, h: +c.h, l: +c.l, c: +c.c })); }
const cardPage = (head, sub, nums, svg, foot, col) => `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0}
body{width:1200px;height:675px;background:#070b0f;color:#eaf6f2;font-family:"Segoe UI","Noto Sans",Arial,"Noto Color Emoji",sans-serif;padding:30px 50px;position:relative}
.top{display:flex;justify-content:space-between}.brand{font-size:26px;font-weight:700;color:#5eb5f7}.dt{font-size:22px;color:#7fa39a}
h1{font-size:50px;margin:10px 0 2px}h1 b{color:${col}}.sub{font-size:23px;color:#ffcf5c;margin-bottom:8px}.nums{display:flex;gap:18px;margin:8px 0}.n{flex:1;background:#0d151b;border:1px solid #1c2e38;border-radius:12px;padding:10px 18px}
.n span{display:block;font-size:18px;color:#7fa39a}.n b{font-size:32px}.foot{position:absolute;bottom:14px;left:50px;right:50px;display:flex;justify-content:space-between;color:#7fa39a;font-size:18px}</style></head><body>
<div class="top"><div class="brand">🐋 MarketRadar Whale</div><div class="dt">${foot[0]}</div></div><h1>${head}</h1><div class="sub">${sub}</div>
<div class="nums">${nums.map(([k, v]) => `<div class="n"><span>${k}</span><b>${v}</b></div>`).join("")}</div>${svg}
<div class="foot"><span>${foot[1]}</span><span>marketradarwhale.com</span></div></body></html>`;
let browser;
async function shot(html, file) { browser ||= await chromium.launch(); const pg = await browser.newPage({ viewport: { width: 1200, height: 675 } }); await pg.setContent(html); await pg.screenshot({ path: file }); await pg.close(); }
export async function closeBrowser() { if (browser) await browser.close(); browser = null; }
function chart(candles, entry, entryT, side, now, lev) { // compress real time into <= 11 h so chartSvg keeps every candle
  const t0 = candles[0].t, k = Math.min(1, (11 * 3600e3) / (candles.at(-1).t - t0 + 900e3)), M = (t) => t0 + (t - t0) * k;
  return chartSvg(candles.map((c) => ({ ...c, t: M(c.t) })), entry, M(entryT), side, now, lev);
}

// ---- main builder ----
export async function buildPosts({ event, t0, coins, out, fillsCache, min = 250e3 }) {
  const byAddr = await loadFills(t0, coins, fillsCache), mids = await hl({ type: "allMids" });
  const shorts = shortsAt(byAddr, t0, coins, min), dips = dipBuys(byAddr, t0, coins, min), wins = winners(byAddr, t0, coins);
  const px0 = {}; for (const c of coins) { const k = await hl({ type: "candleSnapshot", req: { coin: c, interval: "1m", startTime: t0, endTime: t0 + 120e3 } }); px0[c] = k[0] ? +k[0].o : null; }
  const crashStart = t0 + 6 * 60e3; // first big down candle after T0 is read from HL candles in the report; text only uses T0-based facts
  const top = []; // best per wallet, top 3
  for (const s of shorts) { if (top.find((x) => x.addr === s.addr)) continue; top.push(s); if (top.length === 3) break; }
  for (const s of top) { const f = byAddr.get(s.addr), pos = -s.size; s.pnl = pnlSince(f, s.coin, t0, pos, px0[s.coin], +mids[s.coin]); s.px0 = px0[s.coin];
    const st = await hl({ type: "clearinghouseState", user: s.addr }); const p = st.assetPositions?.find((x) => x.position.coin === s.coin)?.position; s.now = p ? { szi: +p.szi, entry: +p.entryPx, upnl: +p.unrealizedPnl, lev: p.leverage?.value } : null; s.profile = await profile(s.addr); await sleep(300); }
  const evT = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC", posts = [];
  fs.mkdirSync(out, { recursive: true });
  const stateLine = (s) => (s.now && s.now.szi < 0 ? `still short (${usd(Math.abs(s.now.szi) * +mids[s.coin])})` : "since closed/reduced");
  // P1 (or fallback to winners if < 2 qualify)
  let p1;
  if (top.length >= 2) {
    const L = top.map((s) => `${sizeEmoji(s.notional)} ${usd(s.notional)} ${s.coin} short · added ${hoursBefore(s.lastOpenT, t0)} before`);
    const text = fit([`${sizeEmoji(top[0].notional)} Whales held big shorts before the ${event} sell-off (from ${utc(t0)}, Oct 29)\n${L.join("\n")}\nPublic Hyperliquid data 👇\n${wurl(top[0].addr)}\n#${top[0].coin} #crypto`,
      `${sizeEmoji(top[0].notional)} Whale shorts open before the ${event} sell-off\n${L.slice(0, 2).join("\n")}\n${wurl(top[0].addr)}\n#${top[0].coin} #crypto`]);
    p1 = { type: "P1-shorts", text, card: top[0], tele: top.map((s) => `${sizeEmoji(s.notional)} ${qty(s.size)} ${s.coin} SHORT (${usd(s.notional)}) · last added ${hoursBefore(s.lastOpenT, t0)} before ${utc(t0)} · ${stateLine(s)} · est. P/L since then ${sg(s.pnl)}\n📊 ${rec(s.profile) || "full history on its page"}\n${wurl(s.addr)}`).join("\n\n") };
  }
  const w3 = []; for (const w of wins) { if (w3.find((x) => x.addr === w.addr)) continue; w3.push(w); if (w3.length === 3) break; }
  for (const w of w3) w.profile = await profile(w.addr);
  if (!p1 && w3.length) p1 = { type: "P1-winners-fallback" };
  const defs = [];
  if (p1?.type === "P1-shorts") defs.push(p1);
  if (w3.length) { const L = w3.map((w) => `${sizeEmoji(w.pnl * 4)} ${sg(w.pnl)} ${w.coin} realized`);
    defs.push({ type: "P2-winners", text: fit([`🏆 Biggest whale winners of the ${event} crash (realized since ${utc(t0)})\n${L.join("\n")}\n${wurl(w3[0].addr)}\n#${w3[0].coin} #crypto`]), card: { ...w3[0], winner: true },
      tele: w3.map((w) => `${sg(w.pnl)} ${w.coin} realized since ${utc(t0)} · ${w.trades} fills\n📊 ${rec(w.profile) || "full history on its page"}\n${wurl(w.addr)}`).join("\n\n") }); }
  const d3 = []; for (const d of dips) { if (d3.find((x) => x.addr === d.addr)) continue; d3.push(d); if (d3.length === 3) break; }
  for (const d of d3) { d.chg = ((+mids[d.coin] - d.avg) / d.avg) * 100; d.profile = await profile(d.addr); }
  if (d3.length) { const L = d3.map((d) => `${sizeEmoji(d.notional)} ${usd(d.notional)} ${d.coin} bought · avg $${px(d.avg)} (${d.chg >= 0 ? "+" : ""}${d.chg.toFixed(1)}% at ${utc(Date.now())})`);
    defs.push({ type: "P3-dip", text: fit([`🛒 Whales buying the ${event} dip\n${L.join("\n")}\nPublic Hyperliquid data 👇\n${wurl(d3[0].addr)}\n#${d3[0].coin} #crypto`]), card: { ...d3[0], dip: true },
      tele: d3.map((d) => `${usd(d.notional)} ${d.coin} LONG opened after ${utc(t0)} · avg $${px(d.avg)} · now ${d.chg >= 0 ? "+" : ""}${d.chg.toFixed(1)}%\n📊 ${rec(d.profile) || "full history on its page"}\n${wurl(d.addr)}`).join("\n\n") }); }
  defs.push({ type: "P4-selfcustody", text: `🔐 After the ${event}: keep your funds in your own wallet.\nOn MarketRadar Whale you trade straight from your own wallet and follow the biggest Hyperliquid whales live.\n${BASE}/en/\n#crypto #selfcustody`,
    tele: `🔐 After the ${event}: keep your funds in your own wallet.\nOn MarketRadar Whale you trade straight from your own wallet and follow the biggest Hyperliquid whales live.\n${BASE}/en/`, card: { selfcustody: true } });
  // render
  const from = t0 - 3 * 3600e3;
  for (const [i, d] of defs.entries()) { assertClean(d.text); assertClean(d.tele || ""); const file = `${out}/P${i + 1}_${d.type}.png`; d.file = file; const c = d.card; let html;
    if (c.selfcustody) html = cardPage("Your keys, <b>your funds</b>", `${event}: exchange funds are not in your hands`, [["Trade from", "Your own wallet"], ["Custody", "Non-custodial"], ["Data", "Public, live"]], "<div style='height:300px'></div>", [evT(Date.now()), "Hyperliquid whale data"], "#35e6b8");
    else { const cs = await candlesFor(c.coin, Math.min(from, (c.lastOpenT || c.firstT || t0) - 3600e3)), now = +mids[c.coin];
      if (c.lastOpenT) html = cardPage(`<b>SHORT</b> ${c.coin} · ${usd(c.notional)}`, `⚡ ${event}: short last added ${hoursBefore(c.lastOpenT, t0)} before ${utc(t0)} · est. P/L since then: ${sg(c.pnl)}`, [["Position at T0", usd(c.notional)], ["Last added", utc(c.lastOpenT)], ["Entry", "$" + px(c.now?.entry ?? c.lastOpenPx)], ["Whale 30d profit", c.profile.pnl30 != null ? sg(c.profile.pnl30) : "—"]], chart(cs, c.now?.entry ?? c.lastOpenPx, c.lastOpenT, "SHORT", now, c.now?.lev), [evT(t0), `${c.coin} 1h candles`], "#ff5470");
      else if (c.winner) html = cardPage(`<b>${sg(c.pnl)}</b> ${c.coin} realized`, `${event}: realized profit since ${utc(t0)}`, [["Realized", sg(c.pnl)], ["Fills", String(c.trades)], ["Whale 30d profit", c.profile.pnl30 != null ? sg(c.profile.pnl30) : "—"]], chart(cs, px0[c.coin], t0, "SHORT", now), [evT(t0), `${c.coin} 1h candles · marker = ${utc(t0)}`], "#35e6b8");
      else html = cardPage(`<b>LONG</b> ${c.coin} · ${usd(c.notional)}`, `${event}: bought the dip after ${utc(t0)}`, [["Bought", usd(c.notional)], ["Avg entry", "$" + px(c.avg)], ["Now", (c.chg >= 0 ? "+" : "") + c.chg.toFixed(1) + "%"], ["Whale 30d profit", c.profile.pnl30 != null ? sg(c.profile.pnl30) : "—"]], chart(cs, c.avg, c.firstT, "LONG", now), [evT(c.firstT), `${c.coin} 1h candles`], "#35e6b8"); }
    await shot(html, file); }
  await closeBrowser();
  const outp = defs.map((d, i) => ({ n: i + 1, type: d.type, text: d.text, file: d.file, tele: d.tele, whale: d.card.addr || null }));
  fs.writeFileSync(out + "/posts.json", JSON.stringify({ event, t0: new Date(t0).toISOString(), built: new Date().toISOString(), qualifyingShorts: shorts.length, topShorts: top, winners: w3, dips: d3, posts: outp }, null, 1));
  fs.writeFileSync(out + "/telegram.txt", outp.map((p) => `--- P${p.n} ${p.type}\n${p.tele}`).join("\n\n"));
  return { shorts: shorts.length, posts: outp };
}

// ---- Buffer publish (runs in GitHub Actions, where BUFFER_* secrets live) ----
async function publish(out, live) {
  const j = JSON.parse(fs.readFileSync(out + "/posts.json", "utf8")), key = process.env.BUFFER_API_KEY, cid = process.env.BUFFER_CHANNEL_ID; if (!key || !cid) throw new Error("BUFFER_API_KEY / BUFFER_CHANNEL_ID missing");
  const q = `mutation($i:CreatePostInput!){createPost(input:$i){... on PostActionSuccess{post{id status dueAt}} ... on MutationError{message}}}`, res = [], only = (process.env.ONLY || "").split(",").filter(Boolean).map(Number);
  for (const p of j.posts) { if (only.length && !only.includes(p.n)) continue; assertClean(p.text);
    for (let k = 0; k < 12; k++) { if ((await fetch(RAW + p.file, { method: "HEAD" })).ok) break; await sleep(5000); }
    const input = { text: p.text, channelId: cid, schedulingType: "automatic", assets: [{ image: { url: RAW + p.file } }] };
    if (!live) { input.mode = "addToQueue"; input.saveToDraft = true; } else if (p.n === 1) input.mode = "shareNow"; else { input.mode = "customScheduled"; input.dueAt = new Date(Date.now() + (p.n - 1) * 2 * 3600e3).toISOString(); }
    const r = await fetch("https://api.buffer.com", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: JSON.stringify({ query: q, variables: { i: input } }) }).then((x) => x.json());
    const o = r.data?.createPost; console.log("P" + p.n, p.type, JSON.stringify(o || r.errors).slice(0, 300)); res.push({ n: p.n, mode: input.mode, dueAt: input.dueAt, result: o || r.errors }); }
  fs.writeFileSync(out + "/publish_log.json", JSON.stringify({ at: new Date().toISOString(), live, res }, null, 1));
}

if (/[\/]news_event.mjs$/.test(process.argv[1] || "")) {
  const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
  const out = arg("out", "x-img/news_event");
  if (arg("mode", "analyze") === "publish") await publish(out, process.argv.includes("--live"));
  else { const r = await buildPosts({ event: arg("event", "Binance hack"), t0: Date.parse(arg("t0")), coins: arg("coins", "BTC,ETH,BNB,SOL").split(","), out, fillsCache: arg("fills") });
    console.log("qualifying shorts:", r.shorts); for (const p of r.posts) console.log("\n== P" + p.n, p.type, p.file, "\n" + p.text); }
}
