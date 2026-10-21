// D1 circuit breaker, Part A (2026-10-21). Runs every 15 min on GitHub Actions (independent of Cloudflare).
// Reads the REAL rows-read of ALL D1 databases of the account (Cloudflare analytics) and, when a limit is hit, sets the KV flag
// WHALE_KV d1_pause="1" (auto-expires at the next 00:00Z, when the D1 cap resets). The Worker (Part B, other session) skips/serves last-good
// for non-critical D1 readers while the flag exists. Writes ONLY that key. Alerts: stdout JSON line "RESULT {...}" read by the workflow.
// Usage: node d1-watchdog/d1_watchdog.mjs [--dry]   (--dry: never writes the KV key)
// Env: CLOUDFLARE_API_TOKEN (Analytics:Read, and Workers KV Storage:Edit for the flag), CLOUDFLARE_ACCOUNT_ID
const TOKEN = process.env.CLOUDFLARE_API_TOKEN, ACC = process.env.CLOUDFLARE_ACCOUNT_ID, DRY = process.argv.includes("--dry");
const KV_NS = "4873976699dd4a6480b965127a75ce4a", KEY = "d1_pause"; // WHALE_KV (bot binding)
const HOUR_TRIP = Number(process.env.HOUR_TRIP || 1_000_000), DAY_TRIP = Number(process.env.DAY_TRIP || 3_500_000), DAY_WARN = Number(process.env.DAY_WARN || 2_000_000);
if (!TOKEN || !ACC) { console.log('RESULT {"status":"error","msg":"missing CLOUDFLARE_API_TOKEN/ACCOUNT_ID"}'); process.exit(2); }
const KVTOKEN = process.env.CF_KV_TOKEN || TOKEN; // KV write needs "Workers KV Storage: Edit"; the analytics token alone gets HTTP 401 there
const H = { Authorization: "Bearer " + TOKEN, "content-type": "application/json" }, HKV = { Authorization: "Bearer " + KVTOKEN, "content-type": "application/json" };
const now = new Date(), S = now.toISOString().slice(0, 10) + "T00:00:00Z", E = now.toISOString().slice(0, 19) + "Z";
const q = `query { viewer { accounts(filter:{accountTag:"${ACC}"}) { d1AnalyticsAdaptiveGroups(limit:1000, orderBy:[datetimeHour_ASC], filter:{datetimeHour_geq:"${S}", datetimeHour_leq:"${E}"}) { sum { rowsRead rowsWritten } dimensions { datetimeHour databaseId } } } } }`;
let rows;
try {
  const j = await (await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: H, body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(30000) })).json();
  if (j.errors && j.errors.length) throw new Error(JSON.stringify(j.errors).slice(0, 200));
  rows = j.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups;
} catch (e) { console.log("RESULT " + JSON.stringify({ status: "error", msg: "analytics: " + String(e.message).slice(0, 200) })); process.exit(2); }
let day = 0, wr = 0; const hours = {}, dbs = {};
for (const r of rows) { day += r.sum.rowsRead; wr += r.sum.rowsWritten; const h = r.dimensions.datetimeHour.slice(11, 13); hours[h] = (hours[h] || 0) + r.sum.rowsRead; dbs[r.dimensions.databaseId] = (dbs[r.dimensions.databaseId] || 0) + r.sum.rowsRead; }
const curH = String(now.getUTCHours()).padStart(2, "0"), cur = hours[curH] || 0;
const topDb = Object.entries(dbs).sort((a, b) => b[1] - a[1])[0] || ["-", 0];
let status = "ok", reasons = [];
if (cur > HOUR_TRIP) reasons.push(`this hour ${cur} > ${HOUR_TRIP}`);
if (day > DAY_TRIP) reasons.push(`today ${day} > ${DAY_TRIP}`);
if (reasons.length) status = "trip"; else if (day > DAY_WARN) status = "warn";
// KV flag
const kvUrl = `https://api.cloudflare.com/client/v4/accounts/${ACC}/storage/kv/namespaces/${KV_NS}/values/${KEY}`;
let flag = null, flagSet = false, flagErr = "";
try { const g = await fetch(kvUrl, { headers: HKV, signal: AbortSignal.timeout(20000) }); flag = g.status === 200 ? await g.text() : null; if (g.status !== 200 && g.status !== 404) flagErr = "kv read HTTP " + g.status; } catch (e) { flagErr = "kv read " + e.message; }
if (status === "trip" && !DRY && flag !== "1") {
  const exp = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5, 0) / 1000); // next 00:05Z
  try { const p = await fetch(kvUrl + "?expiration=" + exp, { method: "PUT", headers: { Authorization: "Bearer " + KVTOKEN, "content-type": "text/plain" }, body: "1", signal: AbortSignal.timeout(20000) }); flagSet = p.ok; if (!p.ok) flagErr = "kv write HTTP " + p.status; } catch (e) { flagErr = "kv write " + e.message; }
}
console.log("HOURS " + JSON.stringify(hours));
console.log("RESULT " + JSON.stringify({ status, dry: DRY, dayReads: day, dayWrites: wr, hourReads: cur, topDb, reasons, flagBefore: flag, flagSet, flagErr }));

