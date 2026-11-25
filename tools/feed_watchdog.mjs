// T30-40 (2026-11-25) FEED WATCHDOG OUTSIDE mr-hub (GitHub Actions, every 30 min; .github/workflows/feed-watchdog.yml).
// WHY: the whale feed went 12.7 h stale (2026-11-24) while every inside alarm was green. This job looks at what USERS get:
//   1) public https://marketradarwhale.com/whale-feed header x-feed-newest-age-s  (> FEED_STALE_MIN, default 40 min = problem)
//   2) bot API https://api.marketradarwhale.com/health                          (not HTTP 200 in 20 s = problem)
// ONE owner Telegram alarm per incident (dedupe = an open GitHub Issue labelled `feed-watchdog`), ONE "recovered" message when it
// clears (issue closed). Once a day (DAILY_HOUR UTC, default 06) ONE health line: feed age now, X posts last 24 h (x_state.json in
// this repo), incidents opened in the last 24 h.
// Secrets come only from env (GitHub secrets), never printed. Read-only on public endpoints.
// Test: node tests/30_whales/test_feed_watchdog.mjs (stubs every URL via env).
import fs from "node:fs";

const E = process.env;
const FEED_URL = E.FEED_URL || "https://marketradarwhale.com/whale-feed";
const HEALTH_URL = E.HEALTH_URL || "https://api.marketradarwhale.com/health";
const GH_API = (E.GH_API || "https://api.github.com").replace(/\/+$/, "");
const TG_API = (E.TG_API || "https://api.telegram.org").replace(/\/+$/, "");
const STALE_MIN = Number(E.FEED_STALE_MIN || 40);
const LABEL = "feed-watchdog";

export async function probe() {
  const out = { feed_age_s: null, feed_status: null, health_status: null };
  try {
    const r = await fetch(FEED_URL, { headers: { "user-agent": "mr-feed-watchdog" }, signal: AbortSignal.timeout(20000) });
    out.feed_status = r.status; const h = r.headers.get("x-feed-newest-age-s");
    if (r.ok && h != null && h !== "" && Number.isFinite(Number(h))) out.feed_age_s = Number(h);
    try { await r.arrayBuffer(); } catch (e) {}
  } catch (e) { out.feed_status = "error"; }
  try {
    const r = await fetch(HEALTH_URL, { headers: { "user-agent": "mr-feed-watchdog" }, signal: AbortSignal.timeout(20000) });
    out.health_status = r.status; try { await r.arrayBuffer(); } catch (e) {}
  } catch (e) { out.health_status = "error"; }
  if (E.FORCE_STALE_S) out.feed_age_s = Number(E.FORCE_STALE_S); // workflow_dispatch test input: plant a stale header
  return out;
}

// pure: problems list from a probe ("unknown" is never "safe", R43)
export function problemsOf(p, staleMin = STALE_MIN) {
  const pr = [];
  if (p.feed_age_s == null) pr.push("/whale-feed age unreadable (HTTP " + p.feed_status + ")");
  else if (p.feed_age_s > staleMin * 60) pr.push("/whale-feed newest " + Math.round(p.feed_age_s / 60) + " min old > " + staleMin);
  if (p.health_status !== 200) pr.push("api /health HTTP " + p.health_status);
  return pr;
}

// pure: what to do. openIssue = number of the open incident issue or null
export function decide(problems, openIssue) {
  if (problems.length && !openIssue) return { alarm: true, open: true };
  if (problems.length && openIssue) return { comment: true };
  if (!problems.length && openIssue) return { recovered: true, close: true };
  return {};
}

export function xPosts24h(state, now = Date.now()) { // x_state.json days{YYYY-MM-DD:{posts}}: today + yesterday share by hour
  if (!state || !state.days) return null;
  const d = new Date(now), today = d.toISOString().slice(0, 10), y = new Date(now - 864e5).toISOString().slice(0, 10);
  const frac = 1 - (d.getUTCHours() * 60 + d.getUTCMinutes()) / 1440;
  return Math.round(((state.days[today] && state.days[today].posts) || 0) + frac * ((state.days[y] && state.days[y].posts) || 0));
}

async function gh(path, opt = {}) {
  const r = await fetch(GH_API + path, { ...opt, headers: { authorization: "Bearer " + E.GH_TOKEN, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "mr-feed-watchdog" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("github " + r.status + " " + path.split("?")[0]);
  return r.json();
}
async function tg(text) {
  if (!E.MONITOR_BOT_TOKEN || !E.MONITOR_CHAT_ID) { console.log("telegram: secrets missing, not sent"); return false; }
  try {
    const r = await fetch(TG_API + "/bot" + E.MONITOR_BOT_TOKEN + "/sendMessage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: E.MONITOR_CHAT_ID, text }), signal: AbortSignal.timeout(15000) });
    console.log("telegram sent: " + r.status); return r.ok;
  } catch (e) { console.log("telegram error"); return false; }
}

export async function main() {
  const repo = E.GITHUB_REPOSITORY; const now = Date.now();
  const p = await probe(); const problems = problemsOf(p);
  const tag = E.FORCE_STALE_S ? " [TEST run: planted stale header]" : "";
  const open = await gh("/repos/" + repo + "/issues?state=open&labels=" + LABEL + "&per_page=5");
  const openIssue = open.length ? open[0].number : null;
  const act = decide(problems, openIssue);
  let telegrams = 0;
  if (act.alarm) {
    if (await tg("🚨 MarketRadar WHALE FEED (outside watchdog, GitHub): " + problems.join(" | ") + tag)) telegrams++;
    await gh("/repos/" + repo + "/issues", { method: "POST", body: JSON.stringify({ title: "FEED WATCHDOG: " + problems[0].replace(/\d+ min old/, "stale"), labels: [LABEL], body: "First seen " + new Date(now).toISOString() + ": " + problems.join(" | ") + tag }) });
  } else if (act.comment) {
    await gh("/repos/" + repo + "/issues/" + openIssue + "/comments", { method: "POST", body: JSON.stringify({ body: "Still: " + problems.join(" | ") + " at " + new Date(now).toISOString() }) });
  } else if (act.recovered) {
    if (await tg("✅ MarketRadar WHALE FEED fresh again (newest " + Math.round(p.feed_age_s / 60) + " min, api /health 200)")) telegrams++;
    await gh("/repos/" + repo + "/issues/" + openIssue + "/comments", { method: "POST", body: JSON.stringify({ body: "Recovered at " + new Date(now).toISOString() }) });
    await gh("/repos/" + repo + "/issues/" + openIssue, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
  }
  // daily health line (vizier idea: one quiet line instead of many alarms)
  const hour = Number(E.DAILY_HOUR || 6), d = new Date(now);
  let daily = null;
  if (E.FORCE_DAILY === "1" || (d.getUTCHours() === hour && d.getUTCMinutes() < 30 && !E.FORCE_STALE_S)) {
    let st = null; try { st = JSON.parse(fs.readFileSync(E.X_STATE || "x_state.json", "utf8")); } catch (e) {}
    const xs = xPosts24h(st, now);
    const since = new Date(now - 864e5).toISOString();
    let inc = null; try { inc = (await gh("/repos/" + repo + "/issues?state=all&labels=" + LABEL + "&since=" + since + "&per_page=50")).filter((i) => i.created_at >= since).length; } catch (e) {}
    daily = "📋 MarketRadar daily health: whale feed newest " + (p.feed_age_s == null ? "unknown" : Math.round(p.feed_age_s / 60) + " min") + ", api " + p.health_status + ", X posts ~24 h " + (xs == null ? "unknown" : xs) + (xs != null && xs < 5 ? " (below 5!)" : "") + ", feed incidents 24 h " + (inc == null ? "unknown" : inc);
    if (await tg(daily)) telegrams++;
  }
  const summary = { at: new Date(now).toISOString(), ...p, problems, open_issue: openIssue, action: Object.keys(act).filter((k) => act[k]).join(",") || "none", telegrams, daily: daily || false };
  console.log(JSON.stringify(summary));
  return summary;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("tools/feed_watchdog.mjs")) {
  main().then((s) => { process.exitCode = s.problems.length ? 1 : 0; }).catch((e) => { console.log("watchdog error " + String(e.message || e).slice(0, 160)); process.exitCode = 1; });
}
