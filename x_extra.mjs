// Pinned intro card + WHALE OF THE WEEK card (top 5 whales by 7-day profit, Fridays). usage: node x_extra.mjs pinned|weekly  -> x-img/samples_v3/{pinned,weekly}.png
// (Buffer API has no pin call: the owner pins the posted intro post by hand on X.)
import fs from "node:fs";
import { chromium } from "playwright-core";
import { usd, sg, short } from "./x_lib.mjs";
const BASE = "https://marketradarwhale.com";
const hl = (b) => fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const CSS = `*{box-sizing:border-box;margin:0}body{width:1200px;height:675px;background:#070b0f;color:#eaf6f2;font-family:"Segoe UI","Noto Sans",Arial,"Noto Color Emoji",sans-serif;padding:40px 56px;position:relative}
.brand{font-size:28px;font-weight:700;color:#5eb5f7}h1{font-size:60px;margin:22px 0 8px;line-height:1.1}h1 b{color:#35e6b8}.sub{font-size:28px;color:#7fa39a}
.foot{position:absolute;bottom:22px;left:56px;right:56px;display:flex;justify-content:space-between;color:#7fa39a;font-size:20px}`;
export const INTRO_TEXT = `🐋 MarketRadar Whale

We watch the biggest Hyperliquid whales live and post their new positions: size, entry price, leverage and each whale's real track record (win rate, 30-day profit).

Free to follow. Full trade history of every whale on our site 👇
${BASE}
#crypto #Hyperliquid`;
export const introHtml = () => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
.row{display:flex;gap:22px;margin-top:40px}.c{flex:1;background:#0d151b;border:1px solid #1c2e38;border-radius:16px;padding:26px 28px}.c i{font-style:normal;font-size:46px}.c b{display:block;font-size:30px;margin:10px 0 6px}.c span{font-size:22px;color:#7fa39a}</style></head><body>
<div class="brand">🐋 MarketRadar Whale</div><h1>Follow the <b>biggest whales</b><br>on Hyperliquid</h1><div class="sub">Live positions with proof, not rumours.</div>
<div class="row"><div class="c"><i>📍</i><b>New positions</b><span>Size, entry, leverage the moment a whale opens</span></div><div class="c"><i>📊</i><b>Track record</b><span>Only whales with real profit and a high win rate</span></div><div class="c"><i>🏆</i><b>Whale of the week</b><span>Top 5 whales by profit, every Friday</span></div></div>
<div class="foot"><span>Free to follow</span><span>marketradarwhale.com</span></div></body></html>`;

export async function weeklyData(n = 5) {
  const lb = (await fetch(BASE + "/whale-leaderboard?limit=100").then((r) => r.json())).sort((a, b) => b.pnl - a.pnl).slice(0, 30), rows = [];
  for (const w of lb) {
    const pf = await hl({ type: "portfolio", user: w.address }).catch(() => null), wk = Number(pf?.find((x) => x[0] === "week")?.[1].pnlHistory.at(-1)?.[1]);
    const st = await fetch(BASE + "/whale-stats?addr=" + w.address).then((r) => r.json()).catch(() => null);
    if (isFinite(wk) && wk > 0 && st && st.trades >= 10 && st.winRate >= 0.55) rows.push({ addr: w.address, week: wk, month: w.pnl, win: st.winRate, trades: st.trades });
  }
  return rows.sort((a, b) => b.week - a.week).slice(0, n);
}
export const weeklyHtml = (rows, date) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}h1{font-size:50px;margin:12px 0 18px}
table{width:100%;border-collapse:collapse;font-size:27px}th{font-size:18px;color:#7fa39a;text-align:right;font-weight:500;padding:0 14px 8px}th:first-child,th:nth-child(2){text-align:left}
td{padding:11px 14px;border-top:1px solid #1c2e38;text-align:right}td:first-child{color:#7fa39a;width:60px;text-align:left}td:nth-child(2){text-align:left}.g{color:#35e6b8;font-weight:700}</style></head><body>
<div class="brand">🐋 MarketRadar Whale</div><h1>🏆 Whale of the Week <span style="font-size:26px;color:#7fa39a">· ${date}</span></h1>
<table><tr><th>#</th><th>Whale</th><th>7-day profit</th><th>30-day profit</th><th>Win rate</th></tr>
${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${short(r.addr)}</td><td class="g">${sg(r.week)}</td><td>${sg(r.month)}</td><td>${Math.round(r.win * 100)}%</td></tr>`).join("")}</table>
<div class="foot"><span>Hyperliquid whales with positive profit, win rate ≥ 55% over ≥ 10 trades</span><span>marketradarwhale.com</span></div></body></html>`;
export const weeklyText = (rows) => `🏆 Whale of the Week: ${short(rows[0].addr)} made ${sg(rows[0].week)} in 7 days with a ${Math.round(rows[0].win * 100)}% win rate.\nTop 5 whales on Hyperliquid by weekly profit 👇\n#crypto #Hyperliquid`;

async function shot(html, file) { const b = await chromium.launch(), pg = await b.newPage({ viewport: { width: 1200, height: 675 } }); await pg.setContent(html); await pg.screenshot({ path: file }); await b.close(); }
if (process.argv[1].endsWith("x_extra.mjs")) {
  fs.mkdirSync("x-img/samples_v3", { recursive: true });
  if (process.argv[2] === "pinned") { await shot(introHtml(), "x-img/samples_v3/pinned.png"); console.log("OK pinned"); }
  if (process.argv[2] === "weekly") { const rows = await weeklyData(); console.log(rows.map((r) => `${short(r.addr)} wk ${Math.round(r.week)} win ${r.win}`).join("\n")); await shot(weeklyHtml(rows, new Date().toISOString().slice(0, 10)), "x-img/samples_v3/weekly.png"); console.log(weeklyText(rows)); }
}

// Buffer DRAFT of the pinned intro or the weekly card (runs in GitHub Actions: secrets from env, image must be pushed first). usage: node x_extra.mjs draft pinned|weekly
if (process.argv[1].endsWith("x_extra.mjs") && process.argv[2] === "draft") {
  const kind = process.argv[3], RAW = "https://raw.githubusercontent.com/alihosseiniytm-stack/mr-channel-post/main/";
  fs.mkdirSync("x-img/samples_v3", { recursive: true });
  let text, file = `x-img/samples_v3/${kind}.png`;
  if (kind === "pinned") { text = INTRO_TEXT; await shot(introHtml(), file); }
  else { const rows = await weeklyData(); text = weeklyText(rows) + "\n" + BASE; await shot(weeklyHtml(rows, new Date().toISOString().slice(0, 10)), file); }
  if (process.env.GITHUB_ACTIONS) { const { execFileSync } = await import("node:child_process"); execFileSync("git", ["add", "x-img"]); try { execFileSync("git", ["commit", "-m", "x extra image " + kind]); execFileSync("git", ["pull", "--rebase"]); execFileSync("git", ["push"]); } catch (e) { console.log("git:", e.message.slice(0, 200)); } }
  for (let k = 0; k < 12; k++) { if ((await fetch(RAW + file, { method: "HEAD" })).ok) break; await new Promise((r) => setTimeout(r, 5000)); }
  const q = `mutation($i:CreatePostInput!){createPost(input:$i){... on PostActionSuccess{post{id status}} ... on MutationError{message}}}`;
  const r = await fetch("https://api.buffer.com", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + process.env.BUFFER_API_KEY }, body: JSON.stringify({ query: q, variables: { i: { text, channelId: process.env.BUFFER_CHANNEL_ID, schedulingType: "automatic", mode: "addToQueue", saveToDraft: true, assets: [{ image: { url: RAW + file } }] } } }) });
  const j = await r.json(); console.log(kind, "draft:", JSON.stringify(j.data?.createPost || j.errors).slice(0, 300));
}
