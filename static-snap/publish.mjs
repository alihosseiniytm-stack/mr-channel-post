// Fetches the public read-only endpoints from the main API and writes them as static JSON files.
// Run: node publish.mjs   (then: npx wrangler deploy --config wrangler.jsonc)
// File naming MUST match snapName() in tradeApp.js: path without leading slash, then ~ before the query, & -> ~, = -> -
import fs from "node:fs";
import path from "node:path";
const API = process.env.MR_API || "https://marketradarwhale.com";
const OUT = path.join(process.cwd(), "public", "snap");
const FIXED = ["whale-feed", "whale-sentiment", "whale-consensus", "whale-live-positions", "whale-netflow", "whale-clusters",
  "sol-whales", "sol-whale-clusters", "sol-smart-agree", "heat-coins", "aster-movers", "pump-trending", "pump-graduating", "toman-rate", "whale-cards", "signal-track-record", "snipe-signals", "pump-smart-all"];
const VARIANTS = [];
for (const w of ["day", "week", "month", "all"]) VARIANTS.push("whale-leaderboard?window=" + w + "&limit=500");
for (const w of ["1h", "4h", "24h"]) VARIANTS.push("top-movers?window=" + w);
for (const c of ["eth", "bsc", "base", "arbitrum", "sol", "ton"]) VARIANTS.push("spot-whales?chain=" + c + "&window=24h");
for (const l of ["en", "fa", "ar", "hi", "id", "ru", "vi"]) VARIANTS.push("app-i18n?lang=" + l);
for (const d of [7, 30]) VARIANTS.push("whale-top?days=" + d);
const snapName = (p) => p.replace("?", "~").split("&").join("~").split("=").join("-");
fs.mkdirSync(OUT, { recursive: true });
let ok = 0, bad = [], kept = [];
const ROWS = [];
const STATIC_HOST = process.env.MR_STATIC || "https://mr-static.alihosseini-ytm.workers.dev";
const EVN = process.env.GITHUB_EVENT_NAME, MIN = new Date().getUTCMinutes();
function dueNow(p) {
  if (EVN !== "schedule") return true; // manual / local runs refresh everything
  if (p.indexOf("app-i18n") === 0) return MIN < 5; // language packs: hourly
  // rankings that change slowly are the heaviest D1 readers: hourly (data that makes the product feel live - prices, feed, positions, clusters, heat - stays on the 5-minute cycle)
  if (p.indexOf("whale-top") === 0) return MIN < 5; // hourly (weekly ranking)
  if (p === "pump-smart-all") return MIN < 5; // hourly: tracked-wallet counts per mint change slowly
  if (p.indexOf("whale-leaderboard") === 0 && p.indexOf("window=month") < 0) return MIN < 5; // hourly
  if (p.indexOf("spot-whales") === 0) return MIN % 30 < 5; // every 30 min
  return true;
}
await Promise.all(FIXED.concat(VARIANTS).map(async (p) => {
  try {
    let r;
    if (!dueNow(p)) { try { r = await fetch(STATIC_HOST + "/snap/" + snapName(p) + ".json"); if (!r.ok) r = null; } catch (e) { r = null; } }
    if (!r) r = await fetch(API + "/" + p, { headers: { "user-agent": "mr-static-publisher" } });
    const t = await r.text();
    if (!r.ok || t.length < 2) throw new Error("status " + r.status);
    JSON.parse(t);
    if (/"error"\s*:\s*"(unavailable|temporarily unavailable)"/.test(t.slice(0, 400))) throw new Error("unavailable");
    fs.writeFileSync(path.join(OUT, snapName(p) + ".json"), t);
    ROWS.push({ name: snapName(p), text: t });
    ok++;
  } catch (e) {
    // KEEP_PREVIOUS: a failed refresh must not delete the last good copy
    try {
      const pr = await fetch(STATIC_HOST + "/snap/" + snapName(p) + ".json");
      const pt = pr.ok ? await pr.text() : "";
      if (pt.length > 1) { JSON.parse(pt); if (!/"error"\s*:\s*"(unavailable|temporarily unavailable)"/.test(pt.slice(0, 400))) { fs.writeFileSync(path.join(OUT, snapName(p) + ".json"), pt); ROWS.push({ name: snapName(p), text: pt }); ok++; kept.push(p); return; } }
    } catch (e2) {}
    bad.push(p + " (" + e.message + ", no previous copy)");
  }
}));

// EXTRA_JSON / STATS_DUE: per-whale stats for the top leaderboard wallets. Slow-changing: fresh from the API hourly (first 5 minutes of the hour) or on manual runs; on every other run the previous copy is taken from the static host (free) so the files are never dropped from a deploy.
{
  const STATS_DUE = EVN !== "schedule" || MIN < 5;
  try {
    const lb = JSON.parse(fs.readFileSync(path.join(OUT, snapName("whale-leaderboard?window=month&limit=500") + ".json"), "utf8"));
    const addrs = (Array.isArray(lb) ? lb : []).map(x => x && (x.wallet || x.address)).filter(Boolean).slice(0, 40);
    await Promise.all(addrs.map(async (a) => {
      const p = "whale-stats?addr=" + encodeURIComponent(a), name = snapName(p);
      const grab = async (url) => { const r = await fetch(url, { headers: { "user-agent": "mr-static-publisher" } }); const t = await r.text(); if (!r.ok) throw new Error("status " + r.status); JSON.parse(t); return t; };
      let t = null;
      try { t = await grab(STATS_DUE ? API + "/" + p : STATIC_HOST + "/snap/" + name + ".json"); } catch (e) {}
      if (!t) { try { t = await grab(STATS_DUE ? STATIC_HOST + "/snap/" + name + ".json" : API + "/" + p); } catch (e) {} }
      if (!t) return;
      fs.writeFileSync(path.join(OUT, name + ".json"), t); ROWS.push({ name, text: t }); ok++;
    }));
  } catch (e) { bad.push("whale-stats set (" + e.message + ")"); }
}

// SINKS: the same snapshots are also written to independent databases (read fail-over + backups). A sink failing never fails the run.
const NOW = Date.now();
async function sinkSupabase() {
  const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE; if (!U || !K) return "skipped";
  const r = await fetch(U + "/rest/v1/snaps?on_conflict=name", { method: "POST", headers: { apikey: K, authorization: "Bearer " + K, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(ROWS.map(x => ({ name: x.name, body: JSON.parse(x.text), at: NOW }))) });
  return r.ok ? "ok" : "http " + r.status;
}
async function sinkTurso() {
  const U = process.env.TURSO_URL, K = process.env.TURSO_TOKEN; if (!U || !K) return "skipped";
  const reqs = [{ type: "execute", stmt: { sql: "CREATE TABLE IF NOT EXISTS mr_snaps (name TEXT PRIMARY KEY, body TEXT, at INTEGER)" } }];
  for (const x of ROWS) reqs.push({ type: "execute", stmt: { sql: "INSERT OR REPLACE INTO mr_snaps VALUES (?,?,?)", args: [{ type: "text", value: x.name }, { type: "text", value: x.text }, { type: "integer", value: String(NOW) }] } });
  reqs.push({ type: "close" });
  const r = await fetch(U.replace("libsql://", "https://") + "/v2/pipeline", { method: "POST", headers: { authorization: "Bearer " + K, "content-type": "application/json" }, body: JSON.stringify({ requests: reqs }) });
  return r.ok ? "ok" : "http " + r.status;
}
async function sinkNeon() {
  const C = process.env.NEON_URL; if (!C) return "skipped";
  const host = C.split("@")[1].split("/")[0];
  const queries = [{ query: "create table if not exists mr_snaps (name text primary key, body text, at bigint)", params: [] }];
  for (const x of ROWS) queries.push({ query: "insert into mr_snaps values ($1,$2,$3) on conflict (name) do update set body=excluded.body, at=excluded.at", params: [x.name, x.text, String(NOW)] });
  const r = await fetch("https://" + host + "/sql", { method: "POST", headers: { "neon-connection-string": C, "content-type": "application/json" }, body: JSON.stringify({ queries }) });
  return r.ok ? "ok" : "http " + r.status;
}
async function sinkUpstash() {
  const U = process.env.UPSTASH_URL, K = process.env.UPSTASH_TOKEN; if (!U || !K) return "skipped";
  const ev = process.env.GITHUB_EVENT_NAME;
  if (ev === "schedule" && new Date().getUTCMinutes() % 15 >= 5) return "skipped (every 15 min)";
  const all = {}; for (const x of ROWS) { if (x.name.indexOf("app-i18n") === 0 || x.name.indexOf("whale-stats") === 0) continue; all[x.name] = x.text; }
  const r = await fetch(U + "/pipeline", { method: "POST", headers: { authorization: "Bearer " + K }, body: JSON.stringify([["SET", "mr_snaps", JSON.stringify({ at: NOW, snaps: all }), "EX", "172800"]]) });
  return r.ok ? "ok" : "http " + r.status;
}
async function sinkMongo() {
  const U = process.env.MONGO_URI; if (!U) return "skipped";
  let MongoClient; try { ({ MongoClient } = await import("mongodb")); } catch (e) { return "driver missing"; }
  const c = new MongoClient(U, { serverSelectionTimeoutMS: 15000 });
  try {
    await c.db("mr").collection("snaps").bulkWrite(ROWS.map(x => ({ updateOne: { filter: { _id: x.name }, update: { $set: { body: x.text, at: NOW } }, upsert: true } })));
    return "ok";
  } finally { try { await c.close(); } catch (e) {} }
}
const res = await Promise.allSettled([sinkSupabase(), sinkTurso(), sinkNeon(), sinkUpstash(), sinkMongo()]);
console.log("sinks: supabase=" + (res[0].value || res[0].reason) + " turso=" + (res[1].value || res[1].reason) + " neon=" + (res[2].value || res[2].reason) + " upstash=" + (res[3].value || res[3].reason) + " mongo=" + (res[4].value || res[4].reason));

const now = NOW;
fs.writeFileSync(path.join(process.cwd(), "public", "_headers"),
  "/icons/*\n  Cache-Control: public, max-age=86400\n/vendor/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=86400\n/snap/*\n  Access-Control-Allow-Origin: *\n  Access-Control-Expose-Headers: X-Snap-At\n  X-Snap-At: " + now + "\n  Cache-Control: public, max-age=60\n  Content-Type: application/json; charset=utf-8\n");
fs.writeFileSync(path.join(process.cwd(), "public", "index.html"), "mr-static " + new Date(now).toISOString());
console.log("published " + ok + " files, failed " + bad.length + (bad.length ? ": " + bad.join("; ") : "") + (kept.length ? " | kept previous copy for " + kept.length + ": " + kept.join(", ") : ""));
if (ok < 10) process.exit(1);
