// X posts via Buffer GraphQL API (free plan). EVENT-TRIGGERED: a whale OPENED/ADDED >= threshold within the last 2 h -> post now (Buffer mode shareNow).
// usage: node x_post.mjs [--n 1] [--mode dry|draft|live] [--min 1000000] [--save]     env: BUFFER_API_KEY, BUFFER_CHANNEL_ID, X_POST_LIVE
// dry = texts+images only, nothing sent. draft = Buffer drafts (not live; no caps). live = shareNow, ENFORCES ramp cap, 2 h spacing, request counter; refuses unless X_POST_LIVE=true.
// Old queue version kept as x_post.old-20261030.mjs.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { CFG, usd, short, makeText, isDup, canPost, countReq, recordPost, emptyState, dayIndex, rampCap } from "./x_lib.mjs";
import { renderCard, closeCards } from "./x_card.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg("n", 1)), MODE = arg("mode", "dry"), MIN = Number(arg("min", CFG.MIN_MOVE_USD));
const BASE = "https://marketradarwhale.com", RAW = "https://raw.githubusercontent.com/alihosseiniytm-stack/mr-channel-post/main/";
const HIST = "x_history.json", STATE = "x_state.json";
const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);
const hist = load(HIST, []), state = load(STATE, emptyState());
const save = () => { if (MODE !== "dry" || process.argv.includes("--save")) { fs.writeFileSync(HIST, JSON.stringify(hist.slice(-14), null, 1)); fs.writeFileSync(STATE, JSON.stringify(state, null, 1)); } };

const hl = (body) => fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

export async function findEvents(now = Date.now()) {
  const [feed, lb] = await Promise.all([fetch(BASE + "/whale-feed").then((r) => r.json()), fetch(BASE + "/whale-leaderboard?limit=100").then((r) => r.json())]);
  const rank = new Map(lb.sort((a, b) => b.pnl - a.pnl).map((w, i) => [w.address.toLowerCase(), { rank: i + 1, ...w }]));
  const cands = feed.filter((p) => !p.coin.includes(":") && p.value >= MIN).sort((a, b) => b.value - a.value).slice(0, 14);
  const fills = new Map(), out = [];
  for (const p of cands) {
    if (!fills.has(p.address)) fills.set(p.address, await hl({ type: "userFills", user: p.address }).catch(() => []));
    const f = fills.get(p.address).filter((x) => x.coin === p.coin && /^Open (Long|Short)$/.test(x.dir) && x.time >= now - CFG.FRESH_MS);
    if (!f.length) continue;
    const dir = f[0].dir.endsWith("Long") ? "LONG" : "SHORT", same = f.filter((x) => x.dir === f[0].dir);
    const sizeCoin = same.reduce((s, x) => s + Number(x.sz), 0), notional = same.reduce((s, x) => s + Number(x.sz) * Number(x.px), 0);
    if (notional < MIN) continue;
    const r = rank.get(p.address.toLowerCase());
    let pnlMonth, pnlAll;
    if (!r) { const pf = await hl({ type: "portfolio", user: p.address }).catch(() => null); const g = (k) => Number(pf?.find((x) => x[0] === k)?.[1].pnlHistory.at(-1)?.[1]); pnlMonth = g("month"); pnlAll = g("allTime"); if (!isFinite(pnlMonth)) pnlMonth = pnlAll = undefined; }
    out.push({ pnlMonth, pnlAll, address: p.address, coin: p.coin, side: dir, sizeCoin, notional, lev: p.leverage, entry: notional / sizeCoin, fillT: Math.max(...same.map((x) => x.time)),
      label: r?.displayName || "Whale " + short(p.address), rank: r?.rank, pnl30: r?.pnl, roi: r?.roi });
  }
  return out.sort((a, b) => b.fillT - a.fillT);
}

async function gql(query, variables) {
  countReq(state, Date.now());
  const r = await fetch("https://api.buffer.com", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + process.env.BUFFER_API_KEY }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error("buffer " + r.status + " " + JSON.stringify(j.errors || j).slice(0, 400));
  return j.data;
}

if (process.argv[1].endsWith("x_post.mjs")) {
  if (MODE === "live" && process.env.X_POST_LIVE !== "true") { console.log("X_POST_LIVE is not true: live mode refused (switch OFF)"); process.exit(0); }
  const now = Date.now();
  console.log(`mode=${MODE} day=${dayIndex(state, now)} cap=${rampCap(dayIndex(state, now))} reqs today=${state.days[new Date(now).toISOString().slice(0, 10)]?.reqs || 0}`);
  if (MODE === "live") { const c = canPost(state, now); if (!c.ok) { console.log("SKIP:", c.why); process.exit(0); } }
  const evs = await findEvents(now), picks = [];
  for (const m of evs) {
    const post = makeText(m);
    if (isDup(post.text, post.key, hist)) { console.log("SKIP duplicate:", post.key); continue; }
    picks.push({ m, post }); if (picks.length >= N) break;
  }
  if (!picks.length) { console.log("no new event (>= " + usd(MIN) + " opened in the last 2 h)"); process.exit(0); }
  fs.mkdirSync("x-img", { recursive: true });
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/\D/g, "");
  const files = [];
  for (const [i, { m }] of picks.entries()) {
    const candles = (await hl({ type: "candleSnapshot", req: { coin: m.coin, interval: "15m", startTime: now - 24 * 3600e3 } })).map((c) => ({ t: c.t, o: +c.o, h: +c.h, l: +c.l, c: +c.c }));
    const f = `x-img/${stamp}-${i}-${m.coin}.png`; await renderCard(m, candles, f); files.push(f);
  }
  await closeCards();
  if (MODE !== "dry" && (process.env.GITHUB_ACTIONS || process.argv.includes("--push"))) { // image URLs must be public before Buffer fetches them
    execFileSync("git", ["add", "x-img"]); try { execFileSync("git", ["commit", "-m", "x images " + stamp]); execFileSync("git", ["pull", "--rebase"]); execFileSync("git", ["push"]); } catch (e) { console.log("git:", e.message.slice(0, 200)); }
  }
  const cid = MODE === "dry" ? null : process.env.BUFFER_CHANNEL_ID;
  for (const [i, { m, post }] of picks.entries()) {
    console.log("POST", i, `(fill ${((now - m.fillT) / 60000).toFixed(0)} min old)\n` + post.text + "\nimage: " + files[i]);
    if (MODE !== "dry") {
      if (MODE === "live") { const c = canPost(state, Date.now()); if (!c.ok) { console.log("SKIP:", c.why); break; } }
      for (let k = 0; k < 12; k++) { if ((await fetch(RAW + files[i], { method: "HEAD" })).ok) break; await new Promise((r) => setTimeout(r, 5000)); }
      const q = `mutation($i:CreatePostInput!){createPost(input:$i){... on PostActionSuccess{post{id status}} ... on MutationError{message}}}`;
      const input = { text: post.text, channelId: cid, schedulingType: "automatic", mode: MODE === "live" ? "shareNow" : "addToQueue", assets: [{ image: { url: RAW + files[i] } }] };
      if (MODE === "draft") input.saveToDraft = true;
      const res = await gql(q, { i: input });
      if (res.createPost.message) throw new Error("createPost: " + res.createPost.message);
      console.log("buffer id", res.createPost.post.id, res.createPost.post.status);
      if (MODE === "live") recordPost(state, Date.now());
    }
    hist.push({ key: post.key, text: post.text, at: new Date().toISOString(), file: files[i], mode: MODE });
  }
  save();
}
