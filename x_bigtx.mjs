// X posts for BIG TRANSFERS (T30-25 + T50-09, 2026-11-06). Source = OUR reader on mr-hub (public copy, 15 min late):
// https://wh.marketradarwhale.com/btf/free.json. Rule + text = mirror of whale-alert-worker/vps/mr-hub/bigtx/bigtx_core.mjs
// xPick/xText (tested in tests/30_whales/test_bigtx.mjs): >= $20M, <= 2 h old, never posted before, biggest first; text names
// no exchange (R53). Shares x_state.json with x_post.mjs, so the SAME ramp cap/day, 2 h spacing and Buffer request stop apply.
// usage: node x_bigtx.mjs [--mode dry|draft|live] [--min 20000000]    live refuses unless X_POST_LIVE=true
import fs from "node:fs";
import { canPost, countReq, recordPost, emptyState } from "./x_lib.mjs";
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const MODE = arg("mode", "dry"), MIN = Number(arg("min", 20e6)), SRC = "https://wh.marketradarwhale.com/btf/free.json";
const STATE = "x_state.json", POSTED = "x_bigtx_posted.json";
const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);

export function xPick(items, posted, now, min = MIN) {
  const done = new Set(posted || []);
  return items.filter((x) => x.usd >= min && now - x.t <= 2 * 3600e3 && !done.has(x.id)).sort((a, b) => b.usd - a.usd)[0] || null;
}
const fmtUsd = (n) => "$" + (n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + "M");
const SIDE = { exchange_in: ["an unknown wallet", "an exchange wallet"], exchange_out: ["an exchange wallet", "an unknown wallet"], exchange_move: ["an exchange wallet", "another exchange wallet"], treasury: ["the issuer treasury", "a wallet"], wallet: ["an unknown wallet", "an unknown wallet"] };
export function xText(x, base = "https://marketradarwhale.com") {
  const em = x.usd >= 1e8 ? "🚨🚨🚨" : x.usd >= 5e7 ? "🚨🚨" : "🚨";
  const amt = Math.round(x.amount).toLocaleString("en-US") + " #" + x.coin + " (" + fmtUsd(x.usd) + ")", net = x.chain === "eth" ? "Ethereum" : "Tron";
  const line = x.kind === "mint" ? `${amt} newly minted on ${net}` : x.kind === "burn" ? `${amt} burned on ${net}` : `${amt} moved from ${(SIDE[x.kind] || SIDE.wallet)[0]} to ${(SIDE[x.kind] || SIDE.wallet)[1]} on ${net}`;
  return `${em} ${line}\n\nTx: ${x.url}\nLive big transfers: ${base}/en/big-transactions/`;
}

if (process.argv[1].endsWith("x_bigtx.mjs")) {
  if (MODE === "live" && process.env.X_POST_LIVE !== "true") { console.log("bigtx: X_POST_LIVE is not true: live refused"); process.exit(0); }
  const now = Date.now(), state = load(STATE, emptyState()), posted = load(POSTED, []);
  let j; try { j = await fetch(SRC, { signal: AbortSignal.timeout(20000) }).then((r) => r.json()); } catch (e) { console.log("bigtx: source down", e.message); process.exit(0); }
  const x = xPick(j.items || [], posted, now);
  if (!x) { console.log(`bigtx: no new transfer >= ${fmtUsd(MIN)} in the last 2 h (free list ${j.items?.length || 0} items)`); process.exit(0); }
  const text = xText(x); console.log("BIGTX POST\n" + text);
  if (MODE === "dry") process.exit(0);
  if (MODE === "live") { const c = canPost(state, now); if (!c.ok) { console.log("bigtx SKIP:", c.why); process.exit(0); } }
  const q = `mutation($i:CreatePostInput!){createPost(input:$i){... on PostActionSuccess{post{id status}} ... on MutationError{message}}}`;
  const input = { text, channelId: process.env.BUFFER_CHANNEL_ID, schedulingType: "automatic", mode: MODE === "live" ? "shareNow" : "addToQueue" };
  if (MODE === "draft") input.saveToDraft = true;
  const r = await fetch("https://api.buffer.com", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + process.env.BUFFER_API_KEY }, body: JSON.stringify({ query: q, variables: { i: input } }) }).then((r) => r.json());
  countReq(state, Date.now());
  const res = r?.data?.createPost;
  if (!res || res.message) { console.log("bigtx createPost failed:", JSON.stringify(r).slice(0, 300)); fs.writeFileSync(STATE, JSON.stringify(state, null, 1)); process.exit(1); }
  console.log("buffer id", res.post.id, res.post.status);
  if (MODE === "live") recordPost(state, Date.now());
  posted.push(x.id); fs.writeFileSync(POSTED, JSON.stringify(posted.slice(-200))); fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
}
