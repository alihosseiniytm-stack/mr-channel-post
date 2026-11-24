// X posts via Buffer GraphQL API (free plan). EVENT-TRIGGERED: a whale OPENED/ADDED >= threshold within the last 2 h -> post now (Buffer mode shareNow).
// usage: node x_post.mjs [--n 1] [--mode dry|draft|live] [--min 1000000] [--save]     env: BUFFER_API_KEY, BUFFER_CHANNEL_ID, X_POST_LIVE
// dry = texts+images only, nothing sent (prints the timing decision). draft = Buffer drafts (not live; no caps). live = shareNow, ENFORCES T50-09 timing
// (peak windows UTC, BREAKING >= $5M any hour +1/day, 90 min spacing; x_lib decide()), ramp cap, request counter; refuses unless X_POST_LIVE=true.
// Old queue version kept as x_post.old-20261030.mjs.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { CFG, TIMING, qualifies, wlabel, usd, short, makeText, isDup, decide, inWindow, countReq, recordPost, emptyState, dayIndex, rampCap, foreignLinks } from "./x_lib.mjs";
import { renderCard, closeCards } from "./x_card.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg("n", 1)), THREAD = process.argv.includes("--thread"), MODE = arg("mode", "dry"), MIN = Number(arg("min", CFG.MIN_MOVE_USD));
const BASE = "https://marketradarwhale.com", RAW = "https://raw.githubusercontent.com/alihosseiniytm-stack/mr-channel-post/main/";
const HIST = "x_history.json", STATE = "x_state.json";
const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);
const hist = load(HIST, []), state = load(STATE, emptyState());
const save = () => { if (MODE !== "dry" || process.argv.includes("--save")) { fs.writeFileSync(HIST, JSON.stringify(hist.slice(-14), null, 1)); fs.writeFileSync(STATE, JSON.stringify(state, null, 1)); } };

const hl = (body) => fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

// T50-21: open positions >= min of the given wallets, straight from HL (5 at a time; a failed wallet is skipped, never guessed)
export async function scanTop(wallets, min, max = 100) {
  const out = [], list = (wallets || []).map((w) => w.address).filter((a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a)).slice(0, max);
  for (let i = 0; i < list.length; i += 5) {
    const rs = await Promise.all(list.slice(i, i + 5).map((a) => hl({ type: "clearinghouseState", user: a }).then((s) => [a, s]).catch(() => [a, null])));
    for (const [a, s] of rs) for (const ap of s?.assetPositions || []) {
      const p = ap.position || {}, v = Number(p.positionValue);
      if (p.coin && !p.coin.includes(":") && isFinite(v) && v >= min) out.push({ address: a, coin: p.coin, value: v, leverage: p.leverage?.value ?? null });
    }
  }
  return out;
}

export async function findEvents(now = Date.now()) {
  const [feed, lb] = await Promise.all([fetch(BASE + "/whale-feed").then((r) => r.json()), fetch(BASE + "/whale-leaderboard?limit=100").then((r) => r.json())]);
  const rank = new Map(lb.sort((a, b) => b.pnl - a.pnl).map((w, i) => [w.address.toLowerCase(), { rank: i + 1, ...w }]));
  // T50-21 (2026-11-24): /whale-feed went STALE (header x-feed-newest-age-s 45,808 s = 12.7 h, 28 items, 4 >= $1M from 1 wallet) ->
  // since 11-15 most peak-window runs said "no new event" (whale posts 3-5/day -> 0-2/day). Second source, read straight from Hyperliquid:
  // open positions >= MIN of OUR leaderboard top 100 (clearinghouseState, weight 2 each = ~200 of HL's 1200/min); same fresh-fill + quality gates below.
  const live = await scanTop(lb, MIN);
  const seen = new Set(), cands = [...feed.filter((p) => !p.coin.includes(":") && p.value >= MIN), ...live].filter((p) => { const k = p.address.toLowerCase() + ":" + p.coin; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.value - a.value).slice(0, 40);
  console.log(`sources: whale-feed ${feed.length} items (>= ${usd(MIN)}: ${feed.filter((p) => !p.coin.includes(":") && p.value >= MIN).length}), HL top-100 scan ${live.length} positions >= ${usd(MIN)}, candidates ${cands.length}`);
  const fills = new Map(), out = [], mids = await hl({ type: "allMids" });
  for (const p of cands) {
    // T50-21: userFillsByTime (only the 2 h window = small reply, low HL weight) instead of the full userFills; a non-array reply
    // (rate limit / error) = unknown -> skip this wallet (never treated as "no fills"), one retry after 2 s
    if (!fills.has(p.address)) { let r = null; for (let k = 0; k < 2 && !Array.isArray(r); k++) { if (k) await new Promise((s) => setTimeout(s, 2000)); r = await hl({ type: "userFillsByTime", user: p.address, startTime: now - CFG.FRESH_MS }).catch(() => null); } fills.set(p.address, Array.isArray(r) ? r : []); if (!Array.isArray(r)) console.log("SKIP fills unknown:", short(p.address)); }
    const f = fills.get(p.address).filter((x) => x.coin === p.coin && /^Open (Long|Short)$/.test(x.dir) && x.time >= now - CFG.FRESH_MS);
    if (!f.length) continue;
    const dir = f[0].dir.endsWith("Long") ? "LONG" : "SHORT", same = f.filter((x) => x.dir === f[0].dir);
    const sizeCoin = same.reduce((s, x) => s + Number(x.sz), 0), notional = same.reduce((s, x) => s + Number(x.sz) * Number(x.px), 0);
    if (notional < MIN) continue;
    const r = rank.get(p.address.toLowerCase());
    const st = await fetch(BASE + "/whale-stats?addr=" + p.address).then((x) => x.json()).catch(() => null);
    let pnlMonth, pnlAll;
    if (!r) { const pf = await hl({ type: "portfolio", user: p.address }).catch(() => null); const g = (k) => Number(pf?.find((x) => x[0] === k)?.[1].pnlHistory.at(-1)?.[1]); pnlMonth = g("month"); pnlAll = g("allTime"); if (!isFinite(pnlMonth)) pnlMonth = pnlAll = undefined; }
    if (!qualifies(st, r ? r.pnl : pnlMonth)) { console.log("SKIP whale quality:", short(p.address), st ? `${st.trades} trades ${Math.round(st.winRate * 100)}% win` : "no stats", "30d", r ? Math.round(r.pnl) : pnlMonth); continue; }
    out.push({ now: +mids[p.coin], win: st.winRate, trades: st.trades, pnlMonth, pnlAll, address: p.address, coin: p.coin, side: dir, sizeCoin, notional, lev: p.leverage, entry: notional / sizeCoin, fillT: Math.max(...same.map((x) => x.time)),
      label: wlabel(st), rank: r?.rank, pnl30: r?.pnl, roi: r?.roi });
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
  console.log(`mode=${MODE} day=${dayIndex(state, now)} cap=${rampCap(dayIndex(state, now))} reqs today=${state.days[new Date(now).toISOString().slice(0, 10)]?.reqs || 0} | timing: windows ${TIMING.WINDOWS.map((w) => w.join("-")).join(",")} UTC (now ${inWindow(now) ? "IN" : "OUT"}), BREAKING >= ${usd(TIMING.BREAKING_MIN)} +${TIMING.BREAKING_EXTRA}/day, spacing ${TIMING.SPACING_MIN} min, last post ${state.last}`);
  const pre = decide(state, now, Infinity); console.log("TIMING pre-check:", pre.ok ? "open (" + pre.why + ")" : "closed (" + pre.why + ")");
  if (MODE === "live" && !pre.ok) { console.log("SKIP:", pre.why); process.exit(0); }
  const evs = await findEvents(now), picks = [];
  for (const m of evs) {
    const post = makeText(m);
    if (isDup(post.text, post.key, hist)) { console.log("SKIP duplicate:", post.key); continue; }
    const dc = decide(state, now, m.notional); console.log(`TIMING ${m.coin} ${m.side} ${usd(m.notional)}: ${dc.ok ? "POST " + dc.kind : "SKIP"} (${dc.why})`);
    if (MODE === "live" && !dc.ok) continue;
    picks.push({ m, post }); if (picks.length >= N) break;
  }
  if (!picks.length) { console.log("no new event (>= " + usd(MIN) + " opened in the last 2 h)"); process.exit(0); }
  fs.mkdirSync("x-img", { recursive: true });
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/\D/g, "");
  const files = [];
  for (const [i, { m }] of picks.entries()) {
    const candles = (await hl({ type: "candleSnapshot", req: { coin: m.coin, interval: "15m", startTime: now - 13 * 3600e3 } })).map((c) => ({ t: c.t, o: +c.o, h: +c.h, l: +c.l, c: +c.c }));
    const f = `x-img/${stamp}-${i}-${m.coin}.png`; await renderCard(m, candles, f); files.push(f);
  }
  await closeCards();
  if (MODE !== "dry" && (process.env.GITHUB_ACTIONS || process.argv.includes("--push"))) { // image URLs must be public before Buffer fetches them
    execFileSync("git", ["add", "x-img"]); try { execFileSync("git", ["commit", "-m", "x images " + stamp]); execFileSync("git", ["pull", "--rebase"]); execFileSync("git", ["push"]); } catch (e) { console.log("git:", e.message.slice(0, 200)); }
  }
  const cid = MODE === "dry" ? null : process.env.BUFFER_CHANNEL_ID;
  for (const [i, { m }] of picks.entries()) {
    const isT = THREAD && i === picks.length - 1; // --thread: only the LAST post of the run is a thread (main without link + reply with link), the others keep the link in the post
    const post = makeText(m, undefined, isT);
    if (foreignLinks(post.text + "\n" + (post.reply || "")).length) { console.log("REFUSED: outside link in text (D334)", foreignLinks(post.text)); process.exit(1); }
    console.log("POST", i, `(fill ${((now - m.fillT) / 60000).toFixed(0)} min old)\n` + post.text + "\nimage: " + files[i]);
    if (MODE !== "dry") {
      let kind = "normal"; if (MODE === "live") { const c = decide(state, Date.now(), m.notional); if (!c.ok) { console.log("SKIP:", c.why); break; } kind = c.kind; }
      for (let k = 0; k < 12; k++) { if ((await fetch(RAW + files[i], { method: "HEAD" })).ok) break; await new Promise((r) => setTimeout(r, 5000)); }
      const q = `mutation($i:CreatePostInput!){createPost(input:$i){... on PostActionSuccess{post{id status}} ... on MutationError{message}}}`;
      const input = { text: post.text, channelId: cid, schedulingType: "automatic", mode: MODE === "live" ? "shareNow" : "addToQueue", assets: [{ image: { url: RAW + files[i] } }] };
      if (MODE === "draft") input.saveToDraft = true;
      if (isT) input.metadata = { twitter: { thread: [{ text: post.text, assets: input.assets }, { text: post.reply }] } }; // main post without link + reply with the whale page link
      const res = await gql(q, { i: input });
      if (res.createPost.message) throw new Error("createPost: " + res.createPost.message);
      console.log("buffer id", res.createPost.post.id, res.createPost.post.status);
      if (MODE === "live") { recordPost(state, Date.now(), kind); console.log("recorded", kind); }
    }
    hist.push({ key: post.key, text: post.text, at: new Date().toISOString(), file: files[i], mode: MODE });
  }
  save();
}
