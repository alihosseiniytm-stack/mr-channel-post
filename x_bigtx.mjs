// X posts for BIG TRANSFERS (T30-25 + T50-09, 2026-11-06; T40-24 #x-chart 2026-11-25 owner D349/D351). Source = OUR reader on mr-hub
// (public copy): https://wh.marketradarwhale.com/btf/free.json. Text names no exchange (R53). Shares x_state.json with x_post.mjs, so the
// SAME ramp cap/day, T50-09 timing (peak windows, BREAKING >= $5M +1/day, 90 min spacing; x_lib decide()) and Buffer request stop apply.
// T40-24 jobs, tried in this order each run, at most ONE post per run (spacing):
//   big    = the biggest fresh transfer, COIN RANKING: native BTC/ETH/SOL/XRP/BNB to/from an exchange first, then other native moves,
//            then stablecoins; stablecoin mint/burn/treasury only >= $100M. Chart image (our chart look, x_chart_img.mjs) with the marker
//            on its candle. PER_DAY 2 (owner 11-07). The pick rule is NO LONGER a 1:1 mirror of vps/mr-hub/bigtx/bigtx_core.mjs xPick
//            (that one feeds the bot/site; this one ranks for X) - tests: tests/test_x_chart.mjs.
//   after  = 24-30 h after a big post: a follow-up post "price since: +x%" + the same chart now (x_bigtx_follow.json). Buffer can not
//            reply to an already-sent post (its API makes threads only at creation), so it is a standalone post that names the move.
//   flow   = 1/day: BTC + ETH net exchange flow of the last 24 h (free.json netflow) on our BTC chart with flow bars.
//   launch = ONCE: the chart-launch thread (docs/x_chart_launch_thread.md, x_thread.json) as one Buffer thread.
// Every post ends with ONE rotating "why our chart" line (x_lib whyChart, D351) + our own link with ?src (D347).
// usage: node x_bigtx.mjs [--mode dry|draft|live] [--min 20000000] [--job big|after|flow|launch]
//        node x_bigtx.mjs --mode dry --job after --test-coin BTC --test-t 2026-11-25T08:00:00Z   (price-since check on any time)
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { decide, countReq, recordPost, emptyState, foreignLinks, whyChart, usd } from "./x_lib.mjs";
import { chartSvg, frameHtml, siteTokens, getCandles, renderPng, closeImg, whenUtc, px, candleAt } from "./x_chart_img.mjs";
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const MODE = arg("mode", "dry"), MIN = Number(arg("min", 20e6)), JOB = arg("job", "all"), SRC = "https://wh.marketradarwhale.com/btf/free.json";
const STATE = "x_state.json", POSTED = "x_bigtx_posted.json", FOLLOW = "x_bigtx_follow.json", BASE = "https://marketradarwhale.com";
const RAW = "https://raw.githubusercontent.com/alihosseiniytm-stack/mr-channel-post/main/";
const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);

export const PER_DAY = 2;
// T30-31 (2026-11-12): network name = the feed item field "net" (all chains), fallback to the old map; unknown network = item never posted (never "Tron").
export const NET = { eth: "Ethereum", tron: "Tron", bsc: "BNB Chain", arb: "Arbitrum", base: "Base", btc: "Bitcoin", xrp: "XRP Ledger", ton: "TON", sol: "Solana" };
export const netOf = (x) => (x && typeof x.net === "string" && x.net.trim()) || NET[x && x.chain] || null;
const ok2 = (x) => x.conf !== "fail" && (x.src_n == null || x.src_n >= 2);
export const STABLE = new Set(["USDT", "USDC", "DAI", "FDUSD", "USDE", "PYUSD", "TUSD", "USD1", "RLUSD", "USDS"]);
// coin -> the chart market we draw (wrapped coins on their base chart); stablecoins -> BTC chart (the market at the moment of the move)
export const CHART_COIN = { BTC: "BTC", WBTC: "BTC", CBBTC: "BTC", ETH: "ETH", WETH: "ETH", STETH: "ETH", SOL: "SOL", WSOL: "SOL", XRP: "XRP", BNB: "BNB", WBNB: "BNB" };
export const chartCoin = (x) => CHART_COIN[String(x.coin || "").toUpperCase()] || "BTC";
export const STABLE_MINT_MIN = 100e6;
// idea 3 ranking tier: 0 = native coin to/from an exchange (pressure), 1 = other native moves, 2 = stablecoin moves; null = never posted
export function tierOf(x) {
  const c = String(x.coin || "").toUpperCase(), st = STABLE.has(c), nat = !!CHART_COIN[c];
  if (st && ["mint", "burn", "treasury"].includes(x.kind) && !(x.usd >= STABLE_MINT_MIN)) return null;
  if (nat) return x.kind === "exchange_in" || x.kind === "exchange_out" ? 0 : 1;
  return 2;
}
export function xPick(items, posted, now, min = MIN) {
  const done = new Set(posted || []), day = "d:" + new Date(now).toISOString().slice(0, 10);
  if ((posted || []).filter((p) => p === day).length >= PER_DAY) return null;
  const rt = new Set(); for (const x of items) for (const y of items) if (x !== y && x.tx === y.tx && x.from === y.to && x.to === y.from) rt.add(x.id);
  return items.filter((x) => x.usd >= min && now - x.t <= 2 * 3600e3 && !done.has(x.id) && !x.internal && !rt.has(x.id) && !!netOf(x) && ok2(x) && tierOf(x) != null)
    .sort((a, b) => tierOf(a) - tierOf(b) || b.usd - a.usd)[0] || null;
}
const fmtUsd = (n) => "$" + (n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + "M");
const SIDE = { exchange_in: ["an unknown wallet", "an exchange wallet"], exchange_out: ["an exchange wallet", "an unknown wallet"], exchange_move: ["an exchange wallet", "another exchange wallet"], treasury: ["the issuer treasury", "a wallet"], wallet: ["an unknown wallet", "an unknown wallet"] };
export const amtOf = (x) => Math.round(x.amount).toLocaleString("en-US") + " #" + x.coin + " (" + fmtUsd(x.usd) + ")";
export function xText(x, base = BASE, why = "") {
  const em = x.usd >= 1e8 ? "🚨🚨🚨" : x.usd >= 5e7 ? "🚨🚨" : "🚨";
  const amt = amtOf(x), net = netOf(x);
  const line = x.kind === "mint" ? `${amt} newly minted on ${net}` : x.kind === "burn" ? `${amt} burned on ${net}` : x.kind === "dex_swap" ? (x.toType === "dex" ? `${amt} moved from ${x.fromType === "exchange" ? "an exchange wallet" : "an unknown wallet"} into a DEX pool on ${net}` : `${amt} moved from a DEX pool to ${x.toType === "exchange" ? "an exchange wallet" : "an unknown wallet"} on ${net}`) : `${amt} moved from ${(SIDE[x.kind] || SIDE.wallet)[0]} to ${(SIDE[x.kind] || SIDE.wallet)[1]} on ${net}`;
  const w = whyLine(x);
  return `${em} ${line}${w ? "\n" + w : ""}\n\n${why ? why + "\n" : ""}${bigtxLink(x, base)}`;
}
// the ONE place that builds the big-transfer link: /go/x/bigtx/ = counted click, 302 keeps the query -> our chart on that coin + ?src (D347, D349)
export const bigtxLink = (x, base = BASE, src = "x_bigtx") => `${base}/go/x/bigtx/en/chart/?m=${chartCoin(x)}&tf=1h&src=${src}`;
export function whyLine(x) {
  const st = STABLE.has(String(x.coin || "").toUpperCase());
  if (x.kind === "exchange_in") return st ? "Stablecoins moving onto an exchange can mean buying power is getting ready." : "Coins sent to an exchange are often sold: possible sell pressure.";
  if (x.kind === "exchange_out") return st ? "Stablecoins leaving an exchange: less ready buying power there." : "Coins leaving an exchange are often held: possible accumulation.";
  if (x.kind === "mint" && st) return "New stablecoin supply often comes before buying.";
  return "";
}
// X length (URL = 23, emoji/CJK = 2) - posts must be <= 280
export const xLen = (t) => [...String(t).replace(/https?:\/\/\S+/g, "x".repeat(23))].reduce((n, ch) => n + (ch.codePointAt(0) > 0x2000 ? 2 : 1), 0);
export const pctSince = (p0, p1) => (isFinite(p0) && p0 > 0 && isFinite(p1) ? ((p1 - p0) / p0) * 100 : null);
const sgnPct = (p) => (p >= 0 ? "+" : "−") + Math.abs(p).toFixed(1) + "%";
const dirWord = (x) => (x.kind === "exchange_in" ? "onto an exchange" : x.kind === "exchange_out" ? "off an exchange" : x.kind === "mint" ? "minted" : x.kind === "burn" ? "burned" : "between wallets");
export function afterText(f, p1, base = BASE, why = "") {
  const p = pctSince(f.p0, p1);
  return `⏱ 24 h later: the ${f.amt} moved ${f.dir} yesterday.\n#${f.cc} since then: ${sgnPct(p)} ($${px(f.p0)} → $${px(p1)})\n\n${why ? why + "\n" : ""}${base}/go/x/bigtx/en/chart/?m=${f.cc}&tf=1h&src=x_after`;
}
// netflow: {h0, step, coins:{BTC:{in:[], out:[]}}} -> last n hours sums
export function flowSum(nf, coin, n = 24) {
  const c = nf && nf.coins && nf.coins[coin]; if (!c || !Array.isArray(c.in) || !Array.isArray(c.out)) return null;
  const i = c.in.slice(-n).reduce((a, b) => a + (+b || 0), 0), o = c.out.slice(-n).reduce((a, b) => a + (+b || 0), 0); return { in: i, out: o, net: i - o };
}
export function flowText(nf, base = BASE, why = "") {
  const ln = (c) => { const f = flowSum(nf, c); return f ? `#${c} in ${usd(f.in)}, out ${usd(f.out)}: net ${f.net >= 0 ? "+" : "-"}${usd(Math.abs(f.net))}` : null; };
  const rows = ["BTC", "ETH"].map(ln).filter(Boolean); if (!rows.length) return null;
  return `📊 Exchange flow, last 24 h\n${rows.join("\n")}\nNet + = onto exchanges (possible selling), - = leaving (possible holding).\n\n${why ? why + "\n" : ""}${base}/go/x/flow/en/chart/?m=BTC&tf=1h&src=x_flow`;
}

// ---------- images (one look: x_chart_img.mjs) ----------
export async function bigImg(x, file) {
  const cc = chartCoin(x), tok = await siteTokens(), { candles, src } = await getCandles(cc, "1h", 48);
  const dn = x.kind === "exchange_in", col = dn ? tok.down : x.kind === "exchange_out" ? tok.up : tok.accent;
  const svg = chartSvg({ candles, tok, H: 360, marks: [{ t: x.t, dir: dn ? "down" : "up", color: col, label: Math.round(x.amount).toLocaleString("en-US") + " " + x.coin }], lines: [{ p: candles.at(-1).c, label: "Now " + px(candles.at(-1).c), color: tok.accent }] });
  await renderPng(frameHtml({ tok, title: `<b style="color:${col}">${fmtUsd(x.usd)}</b> ${x.coin} ${dirWord(x)}`, when: whenUtc(x.t), nums: [["Amount", Math.round(x.amount).toLocaleString("en-US") + " " + x.coin], ["Value", fmtUsd(x.usd)], ["Network", netOf(x)], ["Flow", dn ? "→ exchange" : x.kind === "exchange_out" ? "exchange →" : x.kind]], svg, foot: `${cc} 1h candles, last 48 h · marker = the transfer` }), file);
  return { cc, p0: candles.at(-1).c };
}
async function afterImg(f, file) {
  const tok = await siteTokens(), { candles } = await getCandles(f.cc, "1h", 36), p1 = candles.at(-1).c, p = pctSince(f.p0, p1), col = p >= 0 ? tok.up : tok.down;
  const svg = chartSvg({ candles, tok, H: 360, marks: [{ t: f.t, dir: f.dir === "onto an exchange" ? "down" : "up", color: tok.accent, label: f.coin }], lines: [{ p: f.p0, label: "Then " + px(f.p0), color: "#378ADD", dash: "8 6" }, { p: p1, label: "Now " + px(p1), color: col }], badge: { text: sgnPct(p), sub: "since the move", color: col } });
  await renderPng(frameHtml({ tok, title: `24 h later: <b style="color:${col}">${f.cc} ${sgnPct(p)}</b>`, when: whenUtc(Date.now()), nums: [["The move", f.amt.replace(/#/g, "")], ["Direction", f.dir], ["Price then", "$" + px(f.p0)], ["Price now", "$" + px(p1)]], svg, foot: `${f.cc} 1h candles · marker = the transfer` }), file);
  return p1;
}
async function flowImg(nf, file) {
  const tok = await siteTokens(), { candles } = await getCandles("BTC", "1h", 48), c = nf.coins.BTC;
  const bars = c.in.map((v, i) => ({ t: nf.h0 + i * nf.step, v: (+c.out[i] || 0) - (+v || 0) })); // + = leaving exchanges (up colour)
  const b = flowSum(nf, "BTC"), e = flowSum(nf, "ETH");
  const svg = chartSvg({ candles, tok, H: 350, bars, lines: [{ p: candles.at(-1).c, label: "Now " + px(candles.at(-1).c), color: tok.accent }] });
  await renderPng(frameHtml({ tok, title: `Exchange flow, <b>last 24 h</b>`, when: whenUtc(Date.now()), nums: [["BTC in", usd(b.in)], ["BTC out", usd(b.out)], ["ETH in", e ? usd(e.in) : "—"], ["ETH out", e ? usd(e.out) : "—"]], svg, foot: "BTC 1h candles · bars = BTC net flow per hour (up = leaving exchanges)" }), file);
}

// ---------- post through Buffer (the proven image path: public raw GitHub URL of the committed PNG) ----------
function pushImg(file) {
  if (!(process.env.GITHUB_ACTIONS || process.argv.includes("--push"))) return;
  execFileSync("git", ["add", file]); try { execFileSync("git", ["commit", "-m", "x images " + file]); execFileSync("git", ["pull", "--rebase"]); execFileSync("git", ["push"]); } catch (e) { console.log("git:", e.message.slice(0, 200)); }
}
async function bufferPost(state, text, file, thread = null) {
  pushImg(file);
  for (let k = 0; k < 12; k++) { if ((await fetch(RAW + file, { method: "HEAD" })).ok) break; await new Promise((r) => setTimeout(r, 5000)); }
  const q = `mutation($i:CreatePostInput!){createPost(input:$i){... on PostActionSuccess{post{id status}} ... on MutationError{message}}}`;
  const input = { text, channelId: process.env.BUFFER_CHANNEL_ID, schedulingType: "automatic", mode: MODE === "live" ? "shareNow" : "addToQueue", assets: [{ image: { url: RAW + file } }] };
  if (MODE === "draft") input.saveToDraft = true;
  if (thread) input.metadata = { twitter: { thread: [{ text, assets: input.assets }, ...thread.map((t) => ({ text: t }))] } };
  const r = await fetch("https://api.buffer.com", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + process.env.BUFFER_API_KEY }, body: JSON.stringify({ query: q, variables: { i: input } }) }).then((r) => r.json());
  countReq(state, Date.now());
  const res = r?.data?.createPost;
  if (!res || res.message) throw new Error("createPost failed: " + JSON.stringify(r).slice(0, 300));
  console.log("buffer id", res.post.id, res.post.status); return res.post.id;
}
const guard = (text) => { const f = foreignLinks(text); if (f.length) throw new Error("REFUSED: outside link in text (D334) " + f.join(" ")); if (xLen(text) > 280) throw new Error("REFUSED: text " + xLen(text) + " > 280"); };

if ((process.argv[1] || "").endsWith("x_bigtx.mjs")) {
  if (MODE === "live" && process.env.X_POST_LIVE !== "true") { console.log("bigtx: X_POST_LIVE is not true: live refused"); process.exit(0); }
  const now = Date.now(), today = new Date(now).toISOString().slice(0, 10), state = load(STATE, emptyState()), posted = load(POSTED, []), follow = load(FOLLOW, { items: [], marks: [] });
  const stamp = new Date(now).toISOString().slice(0, 16).replace(/\D/g, ""); fs.mkdirSync("x-img", { recursive: true });
  const save = () => { if (MODE === "dry") return; fs.writeFileSync(POSTED, JSON.stringify(posted.slice(-200))); follow.items = follow.items.slice(-60); fs.writeFileSync(FOLLOW, JSON.stringify(follow, null, 1)); fs.writeFileSync(STATE, JSON.stringify(state, null, 1)); };
  let j = null; try { j = await fetch(SRC, { signal: AbortSignal.timeout(20000) }).then((r) => r.json()); } catch (e) { console.log("bigtx: source down", e.message); }
  const want = (k) => JOB === "all" || JOB === k;
  let done = false;
  const go = async (kind, usdv, text, file, thread) => {
    guard(text); for (const t of thread || []) guard(t);
    const dc = decide(state, Date.now(), usdv);
    console.log(`${kind.toUpperCase()} POST\n${text}\nimage: ${file}\nTIMING ${kind}: ${dc.ok ? "POST " + dc.kind : "SKIP"} (${dc.why})`);
    if (MODE === "dry" || (MODE === "live" && !dc.ok)) return false;
    try { await bufferPost(state, text, file, thread); } catch (e) { console.log(kind, e.message); save(); process.exitCode = 1; return false; }
    if (MODE === "live") recordPost(state, Date.now(), dc.kind); return true;
  };
  try {
    // 1) big transfer
    if (want("big") && j) {
      const x = xPick(j.items || [], posted, now), dayN = posted.filter((p) => p === "d:" + today).length;
      if (!x) console.log(dayN >= PER_DAY ? `big: daily cap ${dayN}/${PER_DAY} reached (owner 11-07)` : `big: no new transfer >= ${fmtUsd(MIN)} in the last 2 h (free list ${j.items?.length || 0} items)`);
      else {
        const file = `x-img/${stamp}-bigtx-${x.coin}.png`, im = await bigImg(x, file), p0 = (j.prices && j.prices[im.cc]) || im.p0;
        const text = xText(x, BASE, whyChart(state));
        if ((done = await go("bigtx tier " + tierOf(x), x.usd, text, file))) {
          posted.push(x.id); if (MODE === "live") posted.push("d:" + today);
          follow.items.push({ id: x.id, cc: im.cc, coin: x.coin, t: x.t, at: new Date().toISOString(), p0, amt: amtOf(x), dir: dirWord(x), after: null });
        }
      }
    }
    // 2) 24 h after-post (or a test on any coin/time: --test-coin BTC --test-t ISO)
    if (!done && want("after")) {
      const tc = arg("test-coin"), tt = arg("test-t");
      if (tc && tt) {
        const t = Date.parse(tt), { candles, src } = await getCandles(tc, "1h", 60), c0 = candleAt(candles, t), p1 = candles.at(-1).c;
        console.log(`AFTER TEST ${tc} from ${tt}: price then (1h candle close ${c0 && new Date(c0.t).toISOString()}) ${c0 && c0.c} -> now ${p1} = ${sgnPct(pctSince(c0.c, p1))} (source ${src})`);
        const f = { cc: tc, coin: tc, t, p0: c0.c, amt: "TEST #" + tc, dir: "onto an exchange" }; const file = `x-img/${stamp}-after-test-${tc}.png`; await afterImg(f, file); console.log(afterText(f, p1, BASE, "why-line") + "\nimage: " + file);
      } else {
        const f = follow.items.find((f) => !f.after && now - Date.parse(f.at) >= 24 * 3600e3 && now - Date.parse(f.at) <= 30 * 3600e3);
        const late = follow.items.filter((f) => !f.after && now - Date.parse(f.at) > 30 * 3600e3); for (const l of late) l.after = "expired";
        if (!f) console.log("after: nothing due (24-30 h old big posts: none)");
        else {
          const file = `x-img/${stamp}-after-${f.cc}.png`, p1 = await afterImg(f, file);
          if ((done = await go("after", 0, afterText(f, p1, BASE, whyChart(state)), file))) f.after = new Date().toISOString();
        }
      }
    }
    // 3) daily net-flow card (1/day)
    if (!done && want("flow") && j && j.netflow) {
      if (follow.marks.includes("flow:" + today)) console.log("flow: already posted today");
      else { const text = flowText(j.netflow, BASE, whyChart(state)); if (text) { const file = `x-img/${stamp}-flow.png`; await flowImg(j.netflow, file); if ((done = await go("flow", 0, text, file))) follow.marks.push("flow:" + today); } }
    }
    // 4) chart-launch thread, once
    if (!done && want("launch") && fs.existsSync("x_thread.json")) {
      const th = load("x_thread.json", null);
      if (!th || !th.id || th.enabled === false) console.log("launch: x_thread.json not enabled");
      else if (follow.marks.includes("launch:" + th.id)) console.log("launch: thread " + th.id + " already posted");
      else if (th.posts && th.posts.length) { // first post carries our chart (BTC + net-flow bars)
        const flowFile = `x-img/${stamp}-flow.png`; if (j && j.netflow && !fs.existsSync(flowFile)) await flowImg(j.netflow, flowFile);
        if (!fs.existsSync(flowFile)) console.log("launch: no chart image (netflow missing): skip this run");
        else if ((done = await go("launch thread", 0, th.posts[0], flowFile, th.posts.slice(1)))) follow.marks.push("launch:" + th.id);
      }
    }
  } finally { await closeImg(); }
  follow.marks = follow.marks.slice(-60); save();
}
