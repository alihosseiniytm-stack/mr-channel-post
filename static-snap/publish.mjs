// Fetches the public read-only endpoints from the main API and writes them as static JSON files.
// Run: node publish.mjs   (then: npx wrangler deploy --config wrangler.jsonc)
// File naming MUST match snapName() in tradeApp.js: path without leading slash, then ~ before the query, & -> ~, = -> -
import fs from "node:fs";
import path from "node:path";
const API = process.env.MR_API || "https://marketradarwhale.com";
const OUT = path.join(process.cwd(), "public", "snap");
const FIXED = ["whale-feed", "whale-sentiment", "whale-consensus", "whale-live-positions", "whale-netflow", "whale-clusters",
  "sol-whales", "sol-whale-clusters", "sol-smart-agree", "heat-coins", "aster-movers", "pump-trending", "pump-graduating", "toman-rate", "whale-cards", "signal-track-record", "snipe-signals", "pump-smart-all", "cg?p=markets", "big-transfers"];
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
// The Google Apps Script trigger starts this every minute as workflow_dispatch, so dispatch runs follow the same hourly/30-min gates as schedule runs (MIN < 2: at most two slow refreshes per hour). Set FORCE=1 for a full manual refresh.
const AUTO = (EVN === "schedule" || EVN === "workflow_dispatch") && !process.env.FORCE;
// Tier timing comes from a small state file (last refresh per tier), NOT from the minute of the hour: a run takes ~70 s and overlaps the 1-minute trigger, so "minute < 2" fired once or twice per hour at random (it doubled the hourly D1 cost: 80k reads at :00 and 74k at :30).
let STATE = {};
try { const sr = await fetch(STATIC_HOST + "/snap/_state.json?t=" + Date.now()); if (sr.ok) STATE = await sr.json(); } catch (e) {}
const NOW0 = Date.now();
const TIER_MS = { hourly: 3600e3, spot: 1800e3, ten: 600e3, five: 300e3 };
const LIVE = ["whale-feed", "whale-live-positions", "whale-clusters", "pump-trending", "pump-graduating", "heat-coins", "aster-movers", "toman-rate", "snipe-signals", "top-movers?window=1h"];
function tierOf(p) {
  if (p.indexOf("app-i18n") === 0 || p.indexOf("whale-top") === 0 || p === "pump-smart-all") return "hourly";
  if (p.indexOf("whale-leaderboard") === 0 && p.indexOf("window=month") < 0) return "hourly";
  if (p.indexOf("spot-whales") === 0) return "spot";
  if (p === "sol-smart-agree") return "ten"; // its Worker memo is 10 min anyway
  if (LIVE.indexOf(p) >= 0) return null; // live layer: every run
  return "five"; // everything computed from big D1 tables
}
const tierDue = {}; for (const t of Object.keys(TIER_MS)) tierDue[t] = !AUTO || !STATE[t] || NOW0 - STATE[t] >= TIER_MS[t] * 0.9;
function dueNow(p) { if (!AUTO) return true; const t = tierOf(p); return t ? tierDue[t] : true; }
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
  const STATS_DUE = !AUTO || tierDue.hourly;
  try {
    const lb = JSON.parse(fs.readFileSync(path.join(OUT, snapName("whale-leaderboard?window=month&limit=500") + ".json"), "utf8"));
    // top 40 of the month board + every wallet the page shows elsewhere (consensus, cards, top 7/30 days, other boards), capped at 100 so opening one of them never reaches the Worker
    const addrs = (Array.isArray(lb) ? lb : []).map(x => x && (x.wallet || x.address)).filter(Boolean).slice(0, 40);
    const seen = new Set(addrs.map(a => String(a).toLowerCase()));
    for (const sn of ["whale-consensus", "whale-cards", "whale-top?days=7", "whale-top?days=30", "whale-leaderboard?window=week&limit=500", "whale-leaderboard?window=day&limit=500", "whale-leaderboard?window=month&limit=500"]) {
      try {
        const txt = fs.readFileSync(path.join(OUT, snapName(sn) + ".json"), "utf8");
        const lim = sn.indexOf("leaderboard") >= 0 ? 15 : 40; let n = 0;
        for (const m of txt.match(/0x[a-fA-F0-9]{40}/g) || []) { const k = m.toLowerCase(); if (seen.has(k)) continue; seen.add(k); addrs.push(m); if (++n >= lim || addrs.length >= 100) break; }
      } catch (e) {}
      if (addrs.length >= 100) break;
    }
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

{
  const ns = Object.assign({}, STATE); for (const t of Object.keys(TIER_MS)) if (tierDue[t]) ns[t] = NOW0;
  fs.writeFileSync(path.join(OUT, "_state.json"), JSON.stringify(ns));
}
// ROUTING (owner 2026-10-02: use the reserve hosts live, not only after a failure): routing.json tells browsers which reserve hosts may take a SMALL share of SLOW-data reads (tradeApp mrCanaryPick). A host is listed only when it answers and its copy is < 40 min old, so a dead or stale host gets 0. Shares are small on purpose: Firebase caps at 10 GB/month per project and a disabled Hosting site would cost us the reserve. CANARY_SCALE env scales all shares (0 = off).
{
  const C = [{ u: "https://alihosseiniytm-stack.github.io/mr-channel-post", p: 0.02 }].concat(["mr-mirror-61fd2", "mr-radar-mirror", "mr-whale-mirror", "mr-two-main", "mr-two-radar", "mr-two-whale"].map((h) => ({ u: "https://" + h + ".web.app", p: 0.0015 })));
  const scale = process.env.CANARY_SCALE === undefined ? 1 : Number(process.env.CANARY_SCALE);
  const live = [];
  await Promise.all(C.map(async (c) => { try { const r = await fetch(c.u + "/snap/app-i18n~lang-en.json", { method: "HEAD", signal: AbortSignal.timeout(5000) }); const lm = Date.parse(r.headers.get("last-modified") || ""); if (r.ok && lm && Date.now() - lm < 2400000) live.push({ u: c.u, p: Math.round(c.p * scale * 100000) / 100000 }); } catch (e) {} }));
  // REAL account usage from Cloudflare analytics (the Worker's own usage_daily counter undercounts D1 reads by ~35%): the Worker reads this file for its budget brake. Fails quietly (no pace = old counter logic).
  let pace = null;
  try {
    const tok = process.env.CLOUDFLARE_API_TOKEN, acc = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (tok && acc) {
      const now = new Date(), day = now.toISOString().slice(0, 10), S = day + "T00:00:00Z", E = now.toISOString().slice(0, 19) + "Z", H = new Date(now.getTime() - 3600e3).toISOString().slice(0, 19) + "Z";
      const q = "query { viewer { accounts(filter:{accountTag:\"" + acc + "\"}) { day: d1AnalyticsAdaptiveGroups(limit:50, filter:{datetimeHour_geq:\"" + S + "\", datetimeHour_leq:\"" + E + "\"}) { sum { rowsRead rowsWritten } } hour: d1AnalyticsAdaptiveGroups(limit:50, filter:{datetimeFiveMinutes_geq:\"" + H + "\", datetimeFiveMinutes_leq:\"" + E + "\"}) { sum { rowsRead } } wk: workersInvocationsAdaptive(limit:50, filter:{datetime_geq:\"" + S + "\", datetime_leq:\"" + E + "\"}) { sum { requests } } } } }";
      const r = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { Authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(15000) });
      const a = (await r.json()).data.viewer.accounts[0];
      const sum = (arr, k) => (arr || []).reduce((t, x) => t + (Number(x.sum[k]) || 0), 0);
      pace = { day, at: Date.now(), d1_reads: sum(a.day, "rowsRead"), d1_writes: sum(a.day, "rowsWritten"), d1_reads_last_hour: sum(a.hour, "rowsRead"), /* real reads in the last 60 minutes: a 20-min window x3 exaggerated the :00 / :30 job spikes */ cf_requests: sum(a.wk, "requests") };
    }
  } catch (e) { pace = null; }
  // API share: independent API hosts for pass-through market data. q grows when Cloudflare Worker requests run ahead of the day (limit 100k/day), never above 0.6; hosts must answer /health.
  const APIH = ["https://chrcsqsarudhkphujmfx.supabase.co/functions/v1/api", "https://marketradarwhale--a503587abde211f1b3041607ee4eb77e.web.val.run"];
  const apiLive = [];
  await Promise.all(APIH.map(async (h) => { try { const r = await fetch(h + "/health", { signal: AbortSignal.timeout(6000) }); if (r.ok) apiLive.push(h); } catch (e) {} }));
  let q = 0.15;
  if (pace && pace.cf_requests >= 0) { const hrs = Math.max(2.4, new Date().getUTCHours() + new Date().getUTCMinutes() / 60); const ratio = (pace.cf_requests / 100000) / (hrs / 24); q = Math.min(0.6, Math.max(0.15, 0.15 + 0.5 * Math.max(0, ratio - 0.5))); }
  fs.writeFileSync(path.join(OUT, "routing.json"), JSON.stringify({ v: 1, at: Date.now(), canary: scale > 0 ? live : [], pace, api: { q: Math.round(q * 1000) / 1000, hosts: apiLive } }));
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
