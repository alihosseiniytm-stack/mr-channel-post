// X posts for BIG TRANSFERS (T30-25 + T50-09, 2026-11-06). Source = OUR reader on mr-hub (public copy, 15 min late):
// https://wh.marketradarwhale.com/btf/free.json. Rule + text = mirror of whale-alert-worker/vps/mr-hub/bigtx/bigtx_core.mjs
// xPick/xText (tested in tests/30_whales/test_bigtx.mjs): >= $20M, <= 2 h old, never posted before, biggest first; text names
// no exchange (R53). Shares x_state.json with x_post.mjs, so the SAME ramp cap/day, T50-09 timing (peak windows, BREAKING >= $5M +1/day,
// 90 min spacing; x_lib decide()) and Buffer request stop apply.
// usage: node x_bigtx.mjs [--mode dry|draft|live] [--min 20000000]    live refuses unless X_POST_LIVE=true
import fs from "node:fs";
import { decide, countReq, recordPost, emptyState, foreignLinks } from "./x_lib.mjs";
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const MODE = arg("mode", "dry"), MIN = Number(arg("min", 20e6)), SRC = "https://wh.marketradarwhale.com/btf/free.json";
const STATE = "x_state.json", POSTED = "x_bigtx_posted.json";
const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);

// vizier 18 2026-11-07 (owner: 2 big-tx posts a day): skip internal moves + same-tx round trips (DeFi flash loans), max PER_DAY posts per UTC day (day markers "d:YYYY-MM-DD" kept in x_bigtx_posted.json)
export const PER_DAY = 2;
// T30-31 (2026-11-12): network name = the feed item field "net" (all chains), fallback to the old map; unknown network = item never posted (never "Tron").
export const NET = { eth: "Ethereum", tron: "Tron", bsc: "BNB Chain", arb: "Arbitrum", base: "Base", btc: "Bitcoin", xrp: "XRP Ledger", ton: "TON", sol: "Solana" };
export const netOf = (x) => (x && typeof x.net === "string" && x.net.trim()) || NET[x && x.chain] || null;
// also never post an unconfirmed (src_n < 2) or failed item (the feed filters this already; second guard here)
const ok2 = (x) => x.conf !== "fail" && (x.src_n == null || x.src_n >= 2);
export function xPick(items, posted, now, min = MIN) {
  const done = new Set(posted || []), day = "d:" + new Date(now).toISOString().slice(0, 10);
  if ((posted || []).filter((p) => p === day).length >= PER_DAY) return null;
  const rt = new Set(); for (const x of items) for (const y of items) if (x !== y && x.tx === y.tx && x.from === y.to && x.to === y.from) rt.add(x.id);
  return items.filter((x) => x.usd >= min && now - x.t <= 2 * 3600e3 && !done.has(x.id) && !x.internal && !rt.has(x.id) && !!netOf(x) && ok2(x)).sort((a, b) => b.usd - a.usd)[0] || null;
}
const fmtUsd = (n) => "$" + (n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + "M");
const SIDE = { exchange_in: ["an unknown wallet", "an exchange wallet"], exchange_out: ["an exchange wallet", "an unknown wallet"], exchange_move: ["an exchange wallet", "another exchange wallet"], treasury: ["the issuer treasury", "a wallet"], wallet: ["an unknown wallet", "an unknown wallet"] };
export function xText(x, base = "https://marketradarwhale.com") {
  const em = x.usd >= 1e8 ? "🚨🚨🚨" : x.usd >= 5e7 ? "🚨🚨" : "🚨";
  const amt = Math.round(x.amount).toLocaleString("en-US") + " #" + x.coin + " (" + fmtUsd(x.usd) + ")", net = netOf(x);
  // dex_swap (T30-31 worker 3): money into / out of a DEX pool = a big swap; "a DEX pool", never the venue name (R53)
  const line = x.kind === "mint" ? `${amt} newly minted on ${net}` : x.kind === "burn" ? `${amt} burned on ${net}` : x.kind === "dex_swap" ? (x.toType === "dex" ? `${amt} moved from ${x.fromType === "exchange" ? "an exchange wallet" : "an unknown wallet"} into a DEX pool on ${net}` : `${amt} moved from a DEX pool to ${x.toType === "exchange" ? "an exchange wallet" : "an unknown wallet"} on ${net}`) : `${amt} moved from ${(SIDE[x.kind] || SIDE.wallet)[0]} to ${(SIDE[x.kind] || SIDE.wallet)[1]} on ${net}`;
  // T50-21 (owner D334 2026-11-24): ONLY our own link (no explorer "Tx:" link); hash + explorer live on our big-transactions page.
  const why = whyLine(x);
  return `${em} ${line}${why ? "\n" + why : ""}\n\nFull list + details: ${bigtxLink(x, base)}`;
}
// T50-21: the ONE place that builds the post link (a later per-tx page on our site only changes this function).
// The live page has no coin/chain/tx filter param yet (checked assets/bigtx.d92d88ac17.js 2026-11-24: no URLSearchParams) -> plain page.
export const bigtxLink = (x, base = "https://marketradarwhale.com") => `${base}/go/x/bigtx/en/big-transactions/`;
// T50-21 vizier idea 2: one short "why it matters" line from the data we have (hedged, no exchange name, R53)
export const STABLE = new Set(["USDT", "USDC", "DAI", "FDUSD", "USDE", "PYUSD", "TUSD", "USD1", "RLUSD", "USDS"]);
export function whyLine(x) {
  const st = STABLE.has(String(x.coin || "").toUpperCase());
  if (x.kind === "exchange_in") return st ? "Stablecoins moving onto an exchange can mean buying power is getting ready." : "Coins sent to an exchange are often sold: possible sell pressure.";
  if (x.kind === "exchange_out") return st ? "Stablecoins leaving an exchange: less ready buying power there." : "Coins leaving an exchange are often held: possible accumulation.";
  if (x.kind === "mint" && st) return "New stablecoin supply often comes before buying.";
  return "";
}
if (process.argv[1].endsWith("x_bigtx.mjs")) {
  if (MODE === "live" && process.env.X_POST_LIVE !== "true") { console.log("bigtx: X_POST_LIVE is not true: live refused"); process.exit(0); }
  const now = Date.now(), state = load(STATE, emptyState()), posted = load(POSTED, []);
  let j; try { j = await fetch(SRC, { signal: AbortSignal.timeout(20000) }).then((r) => r.json()); } catch (e) { console.log("bigtx: source down", e.message); process.exit(0); }
  const x = xPick(j.items || [], posted, now);
  const dayN = posted.filter((p) => p === "d:" + new Date(now).toISOString().slice(0, 10)).length; // T50-21: say the real reason (cap vs no data)
  if (!x && dayN >= PER_DAY) { console.log(`bigtx: daily cap ${dayN}/${PER_DAY} reached (owner 11-07: 2 big-tx posts/day); free list ${j.items?.length || 0} items`); process.exit(0); }
  if (!x) { console.log(`bigtx: no new transfer >= ${fmtUsd(MIN)} in the last 2 h (free list ${j.items?.length || 0} items)`); process.exit(0); }
  const text = xText(x), dc = decide(state, now, x.usd);
  if (foreignLinks(text).length) { console.log("bigtx REFUSED: outside link in text (D334)", foreignLinks(text)); process.exit(1); }
  console.log("BIGTX POST\n" + text + `\nTIMING bigtx $${Math.round(x.usd)}: ${dc.ok ? "POST " + dc.kind : "SKIP"} (${dc.why})`);
  if (MODE === "dry") process.exit(0);
  if (MODE === "live" && !dc.ok) { console.log("bigtx SKIP:", dc.why); process.exit(0); }
  const q = `mutation($i:CreatePostInput!){createPost(input:$i){... on PostActionSuccess{post{id status}} ... on MutationError{message}}}`;
  const input = { text, channelId: process.env.BUFFER_CHANNEL_ID, schedulingType: "automatic", mode: MODE === "live" ? "shareNow" : "addToQueue" };
  if (MODE === "draft") input.saveToDraft = true;
  const r = await fetch("https://api.buffer.com", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + process.env.BUFFER_API_KEY }, body: JSON.stringify({ query: q, variables: { i: input } }) }).then((r) => r.json());
  countReq(state, Date.now());
  const res = r?.data?.createPost;
  if (!res || res.message) { console.log("bigtx createPost failed:", JSON.stringify(r).slice(0, 300)); fs.writeFileSync(STATE, JSON.stringify(state, null, 1)); process.exit(1); }
  console.log("buffer id", res.post.id, res.post.status);
  if (MODE === "live") recordPost(state, Date.now(), dc.kind);
  posted.push(x.id); if (MODE === "live") posted.push("d:" + new Date().toISOString().slice(0, 10)); fs.writeFileSync(POSTED, JSON.stringify(posted.slice(-200))); fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
}
