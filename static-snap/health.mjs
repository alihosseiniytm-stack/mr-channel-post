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
async function run() { const out = []; for (const [name, fn] of checks) { let ok = false, err = ""; const t0 = Date.now(); try { ok = !!(await fn()); } catch (e) { err = String(e.message || e).slice(0, 80); } out.push({ name, ok, ms: Date.now() - t0, err }); } return out; }
let res = await run();
if (res.some((x) => !x.ok)) { await new Promise((r) => setTimeout(r, 20000)); const again = await run(); res = res.map((x, i) => (x.ok ? x : again[i])); }
const bad = res.filter((x) => !x.ok);
console.log(JSON.stringify({ at: new Date().toISOString(), ok: bad.length === 0, failed: bad.map((x) => x.name + (x.err ? " (" + x.err + ")" : "")), checks: res }));
process.exit(bad.length ? 1 : 0);
