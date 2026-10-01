// Fetches the public read-only endpoints from the main API and writes them as static JSON files.
// Run: node publish.mjs   (then: npx wrangler deploy --config wrangler.jsonc)
// File naming MUST match snapName() in tradeApp.js: path without leading slash, then ~ before the query, & -> ~, = -> -
import fs from "node:fs";
import path from "node:path";
const API = process.env.MR_API || "https://marketradarwhale.com";
const OUT = path.join(process.cwd(), "public", "snap");
const FIXED = ["whale-feed", "whale-sentiment", "whale-consensus", "whale-live-positions", "whale-netflow", "whale-clusters",
  "sol-whales", "sol-whale-clusters", "sol-smart-agree", "heat-coins", "aster-movers", "pump-trending", "pump-graduating", "toman-rate", "sol-follow-list"];
const VARIANTS = [];
for (const w of ["day", "week", "month", "all"]) VARIANTS.push("whale-leaderboard?window=" + w + "&limit=500");
for (const w of ["1h", "4h", "24h"]) VARIANTS.push("top-movers?window=" + w);
for (const c of ["eth", "bsc", "base", "arbitrum", "sol", "ton"]) VARIANTS.push("spot-whales?chain=" + c + "&window=24h");
const snapName = (p) => p.replace("?", "~").split("&").join("~").split("=").join("-");
fs.mkdirSync(OUT, { recursive: true });
let ok = 0, bad = [];
await Promise.all(FIXED.concat(VARIANTS).map(async (p) => {
  try {
    const r = await fetch(API + "/" + p, { headers: { "user-agent": "mr-static-publisher" } });
    const t = await r.text();
    if (!r.ok || t.length < 2) throw new Error("status " + r.status);
    JSON.parse(t);
    if (/"error"\s*:\s*"(unavailable|temporarily unavailable)"/.test(t.slice(0, 400))) throw new Error("unavailable");
    fs.writeFileSync(path.join(OUT, snapName(p) + ".json"), t);
    ok++;
  } catch (e) { bad.push(p + " (" + e.message + ")"); }
}));
const now = Date.now();
fs.writeFileSync(path.join(process.cwd(), "public", "_headers"),
  "/snap/*\n  Access-Control-Allow-Origin: *\n  Access-Control-Expose-Headers: X-Snap-At\n  X-Snap-At: " + now + "\n  Cache-Control: public, max-age=60\n  Content-Type: application/json; charset=utf-8\n");
fs.writeFileSync(path.join(process.cwd(), "public", "index.html"), "mr-static " + new Date(now).toISOString());
console.log("published " + ok + " files, failed " + bad.length + (bad.length ? ": " + bad.join("; ") : ""));
if (ok < 10) process.exit(1);
