// Daily whale-section gate (T30-01, phase 3). Read-only; plain Node 20, no packages, no secrets.
// Run: node tests/30_whales/whales_daily.mjs        exit 0 = all green, 1 = something failed (failures listed).
// A byte-identical copy runs daily on GitHub Actions: mr-channel-post/tests/30_whales/whales_daily.mjs (workflow whales-daily.yml).
// Edit BOTH copies together; the script prints its own sha so drift is visible in both logs.
// Checks:
//  (a) SNAPSHOTS: every file the static-snap publisher writes answers 200 + valid JSON on mr-static; the run stamp
//      (X-Snap-At, hlb/meta.at) is fresh; every refresh tier in snap/_state.json is within 2x its period (+5 min).
//      Bot snapshot endpoints (whale-leaderboard x4, whale-cards, whale-stats) answer 200 with x-mrw-snap: 1.
//  (b) PROFILES: 7 languages x 20 addresses (from the live sitemap-whales-top.xml) = 140 pages, all 200.
// Cost: ~45 mr-static asset reads (free), 6 bot requests, 141 site requests per run.
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const STATIC = process.env.MR_STATIC || "https://mr-static.alihosseini-ytm.workers.dev";
const BOT = process.env.MR_API || "https://whale-alert-bot.alihosseini-ytm.workers.dev";
const SITE = process.env.MR_SITE || "https://marketradarwhale.com";
const LANGS = ["en", "fa", "ar", "hi", "id", "ru", "vi"];
const NOW = Date.now(), MIN = 60e3;

// Mirror of FIXED + VARIANTS + snapName in mr-channel-post/static-snap/publish.mjs (keep in sync).
const FIXED = ["whale-feed", "whale-sentiment", "whale-consensus", "whale-live-positions", "whale-netflow", "whale-clusters",
  "sol-whales", "sol-whale-clusters", "sol-smart-agree", "heat-coins", "aster-movers", "pump-trending", "pump-graduating", "toman-rate", "whale-cards",
  "signal-track-record", "snipe-signals", "pump-smart-all", "cg?p=markets", "big-transfers"];
const VARIANTS = [];
for (const w of ["day", "week", "month", "all"]) VARIANTS.push("whale-leaderboard?window=" + w + "&limit=500");
for (const w of ["1h", "4h", "24h"]) VARIANTS.push("top-movers?window=" + w);
for (const c of ["eth", "bsc", "base", "arbitrum", "sol", "ton"]) VARIANTS.push("spot-whales?chain=" + c + "&window=24h");
for (const l of LANGS) VARIANTS.push("app-i18n?lang=" + l);
for (const d of [7, 30]) VARIANTS.push("whale-top?days=" + d);
const snapName = (p) => p.replace("?", "~").split("&").join("~").split("=").join("-");
const TIER_MS = { hourly: 3600e3, spot: 1800e3, ten: 600e3, five: 300e3 };

const fails = [], notes = [];
const fail = (s) => fails.push(s);
async function get(url, opt = {}) {
  for (let i = 0; i < 2; i++) { // one retry for a network blip; a real outage fails both
    try { return await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "manual", ...opt }); }
    catch (e) { if (i) throw e; await new Promise((r) => setTimeout(r, 3000)); }
  }
}
async function pool(items, n, fn) { const q = items.slice(); await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }
const age = (ms) => Math.round((NOW - ms) / MIN) + " min";

// ---- (a) snapshots on mr-static
let snapOk = 0, snapAt = 0;
const files = FIXED.concat(VARIANTS).map((p) => "snap/" + snapName(p) + ".json").concat(["snap/hlb/month.json", "snap/hlb/cards.json"]);
await pool(files, 6, async (f) => {
  try {
    const r = await get(STATIC + "/" + f + "?t=" + NOW);
    const t = await r.text();
    if (r.status !== 200) return fail(`snap ${f}: HTTP ${r.status}`);
    JSON.parse(t);
    if (t.length < 3) return fail(`snap ${f}: empty`);
    snapAt = Math.max(snapAt, Number(r.headers.get("x-snap-at")) || 0);
    snapOk++;
  } catch (e) { fail(`snap ${f}: ${e.message}`); }
});
if (!snapAt || NOW - snapAt > 15 * MIN) fail(`snap run stamp X-Snap-At stale: ${snapAt ? age(snapAt) : "missing"} (limit 15 min)`);
try {
  const st = await (await get(STATIC + "/snap/_state.json?t=" + NOW)).json();
  for (const [k, ms] of Object.entries(TIER_MS)) { const v = Number(st[k]) || 0; if (!v || NOW - v > 2 * ms + 5 * MIN) fail(`tier ${k} stale: ${v ? age(v) : "missing"} (limit ${(2 * ms + 5 * MIN) / MIN} min)`); }
} catch (e) { fail("snap/_state.json: " + e.message); }
try {
  const m = await (await get(STATIC + "/snap/hlb/meta.json?t=" + NOW)).json();
  if (!m.at || NOW - m.at > 15 * MIN) fail(`hlb/meta.at stale: ${m.at ? age(m.at) : "missing"}`);
  if (!m.counts || !(m.counts.month > 0)) fail("hlb/meta.counts.month is 0");
} catch (e) { fail("snap/hlb/meta.json: " + e.message); }

// ---- addresses for (b) + whale-stats probe: from the live whales sitemap (the pages Google is told about)
let addrs = [];
try {
  const sm = await (await get(SITE + "/sitemap-whales-top.xml?t=" + NOW)).text();
  addrs = [...new Set([...sm.matchAll(/\/en\/whale\/(0x[0-9a-f]{40})\//g)].map((m) => m[1]))].slice(0, 20);
  if (addrs.length < 20) fail(`sitemap-whales-top.xml: only ${addrs.length} en profile addresses (need 20)`);
  const noLm = [...sm.matchAll(/<url>(?:(?!<\/url>).)*<\/url>/gs)].filter((m) => !m[0].includes("<lastmod>")).length;
  if (noLm) fail(`sitemap-whales-top.xml: ${noLm} urls without <lastmod>`);
} catch (e) { fail("sitemap-whales-top.xml: " + e.message); }

// bot endpoints that must be served from the snapshot (x-mrw-snap: 1), not the heavy live path
const botPaths = ["day", "week", "month", "all"].map((w) => "whale-leaderboard?window=" + w + "&limit=5").concat(["whale-cards"]);
if (addrs[0]) botPaths.push("whale-stats?addr=" + addrs[0]);
let botOk = 0;
for (const p of botPaths) {
  try {
    const r = await get(BOT + "/" + p, { headers: { "user-agent": "mr-daily-gate" } }); await r.arrayBuffer();
    if (r.status !== 200) fail(`bot /${p}: HTTP ${r.status}`); else if (r.headers.get("x-mrw-snap") !== "1") fail(`bot /${p}: no x-mrw-snap (served by the live fallback)`); else botOk++;
  } catch (e) { fail(`bot /${p}: ${e.message}`); }
}

// ---- (b) profiles 7 x 20
let profOk = 0; const profTotal = LANGS.length * addrs.length;
const jobs = []; for (const l of LANGS) for (const a of addrs) jobs.push(`/${l}/whale/${a}/`);
await pool(jobs, 4, async (u) => {
  try { const r = await get(SITE + u, { headers: { "user-agent": "mr-daily-gate" } }); await r.arrayBuffer(); if (r.status === 200) profOk++; else fail(`profile ${u}: HTTP ${r.status}`); }
  catch (e) { fail(`profile ${u}: ${e.message}`); }
});

const sha = crypto.createHash("sha256").update(fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex").slice(0, 12);
const out = { at: new Date(NOW).toISOString(), script_sha: sha, snapshots: `${snapOk}/${files.length}`, snap_run_age_min: snapAt ? Math.round((NOW - snapAt) / MIN) : null,
  bot_snap: `${botOk}/${botPaths.length}`, profiles: `${profOk}/${profTotal}`, ok: fails.length === 0 && profTotal === 140, failed: fails.slice(0, 40), notes };
console.log(`whales_daily ${out.ok ? "PASS" : "FAIL"} | snapshots ${out.snapshots} | bot x-mrw-snap ${out.bot_snap} | profiles ${out.profiles} | sha ${sha}`);
for (const f of fails.slice(0, 40)) console.log("  FAIL " + f);
console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 1);
