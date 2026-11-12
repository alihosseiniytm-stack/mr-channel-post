// T50-09 LEFT (3) 0-POSTS ALARM, plan B (2026-11-12). Plan A = whale-alert-worker tools/deadman.mjs (GitHub cron 07:50/19:50Z -> Telegram monitor
// bot + issue). Plan B = this step inside x-post.yml, which the static-snap kick starts every ~20 min: no X post for X_ZERO_POST_H hours (x_state.json
// .last, whale + big transfer posts) -> ONE open GitHub issue assigned to the owner (= e-mail; dedup: no second issue while one is open).
// Skipped when the poster is OFF on purpose (X_POST_LIVE != true). Forced test: X_ZERO_TEST=1. Never fails the run.
import fs from "node:fs";
import { zeroPosts, TIMING } from "./x_lib.mjs";
const E = process.env, now = Date.now(), REPO = E.GITHUB_REPOSITORY || "alihosseiniytm-stack/mr-channel-post", OWNER = REPO.split("/")[0];
const TITLE = "X 0-POSTS alarm (no X post in " + TIMING.ZERO_POST_H + " h)";
const state = fs.existsSync("x_state.json") ? JSON.parse(fs.readFileSync("x_state.json", "utf8")) : null;
const z = zeroPosts(state, now), test = E.X_ZERO_TEST === "1";
console.log(`zero-posts check: last post ${state?.last} (${z.hoursSince} h ago), limit ${TIMING.ZERO_POST_H} h -> ${z.alarm ? "ALARM" : "ok"}${test ? " [FORCED TEST]" : ""}`);
if (!z.alarm && !test) process.exit(0);
if (E.X_POST_LIVE !== "true" && !test) { console.log("poster is OFF on purpose (X_POST_LIVE != true): no alarm"); process.exit(0); }
const text = (test ? "[TEST, ignore] " : "") + `🚨 X poster: NO post went out for ${z.hoursSince ?? "?"} h (limit ${TIMING.ZERO_POST_H} h; last ${state?.last}). Runs may be green but nothing reaches X: check x-post run logs (SKIP reasons), Buffer key/limit, X_POST_LIVE. Plan B poster = Publer; plan D = Buffer manual queue.`;
try {
  if (!E.GITHUB_TOKEN) throw new Error("no GITHUB_TOKEN");
  const gh = async (p, o = {}) => { const r = await fetch("https://api.github.com/repos/" + REPO + p, { ...o, headers: { authorization: "Bearer " + E.GITHUB_TOKEN, accept: "application/vnd.github+json", "content-type": "application/json" }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error("github " + r.status); return r.json(); };
  const open = (await gh("/issues?state=open&per_page=50")).find((i) => i.title.startsWith("X 0-POSTS alarm"));
  if (open) { console.log("issue already open #" + open.number + " (dedup, no new e-mail)"); }
  else { const x = await gh("/issues", { method: "POST", body: JSON.stringify({ title: (test ? "[TEST] " : "") + TITLE, body: text + "\n\n@" + OWNER, assignees: [OWNER] }) }); console.log("issue #" + x.number + " opened (owner e-mailed)"); }
} catch (e) { console.log("issue failed: " + String(e.message).slice(0, 80)); }
try { if (E.MONITOR_BOT_TOKEN && E.MONITOR_CHAT_ID) { const r = await fetch("https://api.telegram.org/bot" + E.MONITOR_BOT_TOKEN + "/sendMessage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: E.MONITOR_CHAT_ID, text }) }); const j = await r.json(); console.log("telegram " + r.status + (j.ok ? " message_id " + j.result.message_id : "")); } else console.log("telegram: no monitor secrets in this repo (plan A deadman sends Telegram)"); } catch (e) { console.log("telegram failed " + e.message); }
