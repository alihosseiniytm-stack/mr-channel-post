// T30-40 (2026-11-25) PLANT TEST for tools/feed_watchdog.mjs: runs the REAL script 4x against local stubs (public /whale-feed with a
// FAKE stale header, api /health, GitHub issues API with state, Telegram) and checks the dedupe:
//  run 1 stale 45,808 s -> exactly 1 Telegram alarm + 1 issue opened; run 2 still stale -> 0 Telegram (comment only);
//  run 3 fresh -> 1 "fresh again" + issue closed; run 4 fresh -> 0 Telegram. Plus pure checks (unknown header = problem, health down).
// Run: node tests/30_whales/test_feed_watchdog.mjs   (exit 1 = RED)
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { problemsOf, decide, xPosts24h } from "../../tools/feed_watchdog.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, "../../tools/feed_watchdog.mjs");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS " + m); } else { fail++; console.log("FAIL " + m); } };

// pure
ok(problemsOf({ feed_age_s: 300, health_status: 200 }).length === 0, "fresh 5 min + health 200 = ok");
ok(problemsOf({ feed_age_s: 2401, health_status: 200 }).length === 1, "41 min old = problem (limit 40)");
ok(problemsOf({ feed_age_s: null, feed_status: 200, health_status: 200 }).length === 1, "missing header = problem (unknown is never safe)");
ok(problemsOf({ feed_age_s: 10, health_status: "error" }).length === 1, "api /health down = problem");
ok(decide(["x"], null).alarm && !decide(["x"], 7).alarm && decide([], 7).recovered && !Object.keys(decide([], null)).length, "decide: alarm once, then quiet, recover once");
ok(xPosts24h({ days: { "2026-11-25": { posts: 4 }, "2026-11-24": { posts: 3 } } }, Date.parse("2026-11-25T12:00:00Z")) === 6, "x posts 24 h = today + half of yesterday at noon");

// plant
const st = { age: 45808, issues: [], tg: [] };
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const send = (o, code = 200, h = {}) => { res.writeHead(code, { "content-type": "application/json", ...h }); res.end(JSON.stringify(o)); };
    const u = req.url;
    if (u === "/whale-feed") return send({ items: [] }, 200, { "x-feed-newest-age-s": String(st.age) });
    if (u === "/health") return send("ok");
    if (u.startsWith("/bot")) { st.tg.push(JSON.parse(b).text); return send({ ok: true }); }
    if (u.startsWith("/repos/o/r/issues?")) return send(st.issues.filter((i) => (u.includes("state=open") ? i.state === "open" : true)));
    if (u === "/repos/o/r/issues" && req.method === "POST") { const i = { number: st.issues.length + 1, state: "open", created_at: new Date().toISOString(), ...JSON.parse(b) }; st.issues.push(i); return send(i, 201); }
    const m = u.match(/^\/repos\/o\/r\/issues\/(\d+)(\/comments)?$/);
    if (m) { const i = st.issues[Number(m[1]) - 1]; if (!m[2] && req.method === "PATCH") Object.assign(i, JSON.parse(b)); return send(i); }
    send({}, 404);
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + srv.address().port;
const run = () => new Promise((resolve) => {
  const p = spawn(process.execPath, [SCRIPT], { env: { ...process.env, FEED_URL: base + "/whale-feed", HEALTH_URL: base + "/health", GH_API: base, TG_API: base, GH_TOKEN: "t", GITHUB_REPOSITORY: "o/r", MONITOR_BOT_TOKEN: "x", MONITOR_CHAT_ID: "1", DAILY_HOUR: "99", FORCE_STALE_S: "", FORCE_DAILY: "" } });
  let o = ""; p.stdout.on("data", (c) => (o += c)); p.stderr.on("data", (c) => (o += c)); p.on("close", (code) => resolve({ code, o }));
});
let r = await run();
ok(r.code === 1 && st.tg.length === 1 && /45,?808|763 min/.test(st.tg[0]) && st.issues.length === 1, "run 1 stale: exactly 1 alarm + 1 issue, exit 1 (" + st.tg.length + ")");
r = await run();
ok(r.code === 1 && st.tg.length === 1 && st.issues.length === 1, "run 2 still stale: no 2nd alarm (dedupe)");
st.age = 120; r = await run();
ok(r.code === 0 && st.tg.length === 2 && /fresh again/.test(st.tg[1]) && st.issues[0].state === "closed", "run 3 fresh: 1 recovered message + issue closed");
r = await run();
ok(r.code === 0 && st.tg.length === 2, "run 4 fresh: quiet");
srv.close();
if (!r.o.includes('"telegrams"')) console.log(r.o);
console.log((fail ? "RED" : "GREEN") + " " + pass + "/" + (pass + fail));
process.exit(fail ? 1 : 0);
