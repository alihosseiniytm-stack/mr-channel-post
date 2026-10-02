// Uptime / freshness checks for every plan layer. Prints a JSON report and exits 1 when something REAL is down (2 tries, 20 s apart).
const T = 15000;
const get = async (url, init) => { const t0 = Date.now(); const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(T) }, init || {})); return { r, ms: Date.now() - t0 }; };
const checks = [
  ["site /trade (marketradarwhale.com)", async () => { const { r } = await get("https://marketradarwhale.com/trade"); return r.status === 200; }],
  ["API /whale-feed (domain)", async () => { const { r } = await get("https://marketradarwhale.com/whale-feed"); if (r.status !== 200) return false; const j = await r.json(); return Array.isArray(j) && j.length > 0; }],
  ["bot Worker address (workers.dev)", async () => { const { r } = await get("https://whale-alert-bot.alihosseini-ytm.workers.dev/whale-feed"); return r.status === 200; }],
  ["login challenge", async () => { const { r } = await get("https://marketradarwhale.com/web-auth-challenge", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); return r.status === 200 || r.status === 403 || r.status === 429; }],
  ["static host snapshot fresh (<30 min)", async () => { const { r } = await get("https://mr-static.alihosseini-ytm.workers.dev/snap/whale-feed.json"); const at = Number(r.headers.get("x-snap-at") || 0); return r.status === 200 && at > 0 && Date.now() - at < 30 * 60000; }],
  ["GitHub Pages snapshot fresh (<90 min)", async () => { const { r } = await get("https://alihosseiniytm-stack.github.io/mr-channel-post/snap/whale-feed.json"); const lm = Date.parse(r.headers.get("last-modified") || ""); return r.status === 200 && lm > 0 && Date.now() - lm < 90 * 60000; }],
  ["GitHub Pages /trade mirror", async () => { const { r } = await get("https://alihosseiniytm-stack.github.io/mr-channel-post/trade/"); return r.status === 200; }],
  ["GitHub Pages user mirror /trade", async () => { const { r } = await get("https://alihosseiniytm-stack.github.io/trade/"); return r.status === 200; }],
  ["wallet bundle on static host", async () => { const { r } = await get("https://mr-static.alihosseini-ytm.workers.dev/vendor/webpush.js"); return r.status === 200; }],
];
const SB = process.env.SUPABASE_URL, SBK = process.env.SUPABASE_ANON;
if (SB && SBK) checks.push(["Supabase snapshot table", async () => { const { r } = await get(SB + "/rest/v1/snaps?name=eq.whale-feed&select=at", { headers: { apikey: SBK } }); if (r.status !== 200) return false; const j = await r.json(); return j.length > 0 && Date.now() - Number(j[0].at) < 30 * 60000; }]);
// FREE-LIMIT WARNING (owner 2026-10-02): the Cloudflare free daily limits are the real way this site "goes to sleep". routing.json (published every minute) carries the REAL usage; this check fails (GitHub issue + e-mail, like an outage) when the day is heading past a limit: D1 reads projected > 4.5M of 5M, D1 writes projected > 90k of 100k, Worker requests > 70k of 100k. Ignored in the first 3 UTC hours (too early to project).
checks.push(["LIMIT WARNING: Cloudflare free daily limits (D1 reads/writes, Worker requests)", async () => {
  const { r } = await get("https://mr-static.alihosseini-ytm.workers.dev/snap/routing.json");
  const j = await r.json(); const p = j && j.pace; if (!p || Date.now() - Number(p.at) > 1800000) return true; // unknown = not a limit problem
  const now = new Date(), h = now.getUTCHours() + now.getUTCMinutes() / 60; if (h < 3) return true;
  const left = 24 - h;
  const readsEnd = p.d1_reads + (Number(p.d1_reads_last_hour) || 0) * left, writesEnd = p.d1_writes / h * 24;
  if (readsEnd > 4500000) throw new Error("D1 reads heading to " + Math.round(readsEnd / 1e5) / 10 + "M of 5M (used " + p.d1_reads + ", last hour " + p.d1_reads_last_hour + ")");
  if (writesEnd > 90000) throw new Error("D1 writes heading to " + Math.round(writesEnd) + " of 100k (used " + p.d1_writes + ")");
  if (p.cf_requests > 70000) throw new Error("Worker requests " + p.cf_requests + " of 100k");
  return true;
}]);
async function run() { const out = []; for (const [name, fn] of checks) { let ok = false, err = ""; const t0 = Date.now(); try { ok = !!(await fn()); } catch (e) { err = String(e.message || e).slice(0, 80); } out.push({ name, ok, ms: Date.now() - t0, err }); } return out; }
let res = await run();
if (res.some((x) => !x.ok)) { await new Promise((r) => setTimeout(r, 20000)); const again = await run(); res = res.map((x, i) => (x.ok ? x : again[i])); }
const bad = res.filter((x) => !x.ok);
console.log(JSON.stringify({ at: new Date().toISOString(), ok: bad.length === 0, failed: bad.map((x) => x.name + (x.err ? " (" + x.err + ")" : "")), checks: res }));
process.exit(bad.length ? 1 : 0);
