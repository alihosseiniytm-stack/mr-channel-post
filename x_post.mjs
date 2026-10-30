// X posts via Buffer GraphQL API (free plan). One REAL whale position per post + image + link.
// usage: node x_post.mjs [--n 3] [--mode dry|draft|queue]   env: BUFFER_API_KEY, BUFFER_CHANNEL_ID (optional)
// dry = write posts+images only; draft = save as Buffer drafts (not live); queue = add to Buffer queue (live at its slot).
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg("n", 3)), MODE = arg("mode", "dry");
const BASE = "https://marketradarwhale.com";
const RAW = "https://raw.githubusercontent.com/alihosseiniytm-stack/mr-channel-post/main/";
const HIST = "x_history.json";
const hist = fs.existsSync(HIST) ? JSON.parse(fs.readFileSync(HIST, "utf8")) : [];

const usd = (n) => { const a = Math.abs(n); return "$" + (a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + "M" : (a / 1e3).toFixed(0) + "K"); };
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const px = (n) => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toPrecision(3));
const norm = (t) => t.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
export const sim = (a, b) => { const A = new Set(norm(a)), B = new Set(norm(b)); let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i || 1); };
export const isDup = (text, key, h) => h.some((p) => p.key === key || sim(p.text, text) >= 0.8);

const HOOKS = [
  "A whale just stands behind this call:", "Smart money is positioned long:", "Big wallet, big conviction:", "Whale radar spotted this long:",
  "Someone is betting big on the upside:", "Large long on the board:", "Not retail size. A whale long:", "Following the money:",
];
const TAGS = (c) => `#${c} #crypto #whales`;

export function makePost(p, i) {
  const hook = HOOKS[(new Date().getUTCDate() * 3 + i) % HOOKS.length];
  const when = new Date(p.time).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const url = `${BASE}/en/whale/${p.address}/`;
  const text = `${hook} ${usd(p.value)} LONG ${p.coin} at ${p.leverage}x, entry $${px(Number(p.entryPx))}.\nWallet ${short(p.address)} · seen ${when}\nLive whale tracker: ${url}\n${TAGS(p.coin)}`;
  return { text, url, key: p.address + ":" + p.coin };
}

async function pick() {
  const r = await fetch(BASE + "/whale-feed", { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("whale-feed " + r.status);
  const feed = await r.json();
  const fresh = Date.now() - 36 * 3600e3;
  const c = feed.filter((p) => Number(p.szi) > 0 && p.value >= 1e6 && p.time >= fresh).sort((a, b) => b.value - a.value);
  const out = [], seenCoin = new Set();
  for (const p of c) { // one per coin per batch for variety
    if (seenCoin.has(p.coin)) continue;
    const post = makePost(p, out.length);
    if (isDup(post.text, post.key, hist)) { console.log("SKIP duplicate:", post.key); continue; }
    seenCoin.add(p.coin); out.push({ p, post });
    if (out.length >= N) break;
  }
  return out;
}

function render(p, file) {
  const d = { title: "Whale long · " + p.coin, date: new Date(p.time).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }), dir: "ltr", footer: "Wallet " + short(p.address),
    cards: [{ title: "Whale position", rows: [
      { name: "LONG " + p.coin, value: usd(p.value), change: p.leverage + "x", side: "up" },
      { name: "Entry price", value: "$" + px(Number(p.entryPx)), change: "", side: "up" },
      { name: "Liquidation", value: "$" + px(Number(p.liqPx)), change: "", side: "dn" },
    ] }] };
  fs.writeFileSync("x_data.json", JSON.stringify(d));
  execFileSync("node", ["render.mjs", "x_data.json", file], { stdio: "inherit" });
}

async function gql(query, variables) {
  const r = await fetch("https://api.buffer.com", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + process.env.BUFFER_API_KEY }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error("buffer " + r.status + " " + JSON.stringify(j.errors || j).slice(0, 400));
  return j.data;
}

async function channelId() {
  if (process.env.BUFFER_CHANNEL_ID) return process.env.BUFFER_CHANNEL_ID;
  const o = await gql(`query{account{organizations{id}}}`);
  const org = o.account.organizations[0].id;
  const c = await gql(`query($o:OrganizationId!){channels(input:{organizationId:$o}){id service name}}`, { o: org });
  const x = c.channels.find((k) => /twitter|^x$/i.test(k.service));
  if (!x) throw new Error("no X channel connected in Buffer: " + JSON.stringify(c.channels));
  return x.id;
}

if (process.argv[1].endsWith("x_post.mjs")) {
  const picks = await pick();
  if (!picks.length) { console.log("no fresh non-duplicate whale position"); process.exit(MODE === "dry" ? 0 : 1); }
  fs.mkdirSync("x-img", { recursive: true });
  const stamp = new Date().toISOString().slice(0, 13).replace(/\D/g, "");
  const cid = MODE === "dry" ? null : await channelId();
  const files = picks.map(({ p }, i) => { const f = `x-img/${stamp}-${i}-${p.coin}.png`; render(p, f); return f; });
  if (MODE !== "dry" && (process.env.GITHUB_ACTIONS || process.argv.includes("--push"))) { // image URLs must be public before Buffer fetches them
    execFileSync("git", ["add", "x-img"]); try { execFileSync("git", ["commit", "-m", "x images " + stamp]); execFileSync("git", ["push"]); } catch (e) { console.log("git:", e.message.slice(0, 200)); }
  }
  for (const [i, { p, post }] of picks.entries()) {
    const file = files[i];
    console.log("POST", i, "\n" + post.text + "\nimage:", file);
    if (MODE !== "dry") {
      // image must be public: push before posting (workflow commits x-img first; locally use --mode dry then commit)
      const m = `mutation($i:CreatePostInput!){createPost(input:$i){... on PostActionSuccess{post{id status}} ... on MutationError{message}}}`;
      const input = { text: post.text, channelId: cid, schedulingType: "automatic", mode: "addToQueue", assets: [{ image: { url: RAW + file } }] };
      if (MODE === "draft") input.saveToDraft = true;
      const res = await gql(m, { i: input });
      if (res.createPost.message) throw new Error("createPost: " + res.createPost.message);
      console.log("buffer id", res.createPost.post.id, res.createPost.post.status);
    }
    hist.push({ key: post.key, text: post.text, at: new Date().toISOString(), file });
  }
  if (MODE !== "dry" || process.argv.includes("--save")) fs.writeFileSync(HIST, JSON.stringify(hist.slice(-14), null, 1));
}
