// TEST static-snap/copy_age.mjs (T30-20, 2026-10-28). No network. Run: node tests/30_whales/test_copy_age.mjs  (exit 1 = RED)
// Simulates the static-snap publisher for 24 h of 1-minute runs: tier clock read from mr-static (newest), "not due" files copied from
// GitHub Pages, Pages updated only by 15-min slot runs and visible ~10 min later, some slot runs cancelled.
// It proves (a) the OLD rule lets a 5-min-tier file go > 90 min stale (the 2026-10-28 whale-consensus / big-transfers incident) and
// (b) the NEW rule (needFresh) keeps it under the copy limit + one tier, without polling the bot every minute.
import { copyTooOld, needFresh, COPY_MAX_MS, isPagesSlot, pickCopySource } from "../../static-snap/copy_age.mjs";
let fail = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
const MIN = 60e3, TIER = 5 * MIN;

ok(copyTooOld(undefined, "five", 1e12) === true, "unknown fetch time = too old (fetch fresh)");
ok(copyTooOld(1e12 - 10 * MIN, "five", 1e12) === false, "10 min old copy is fine for the 5-min tier");
ok(copyTooOld(1e12 - 40 * MIN, "five", 1e12) === true, "40 min old copy is too old for the 5-min tier");
ok(copyTooOld(1e12 - 999 * MIN, null, 1e12) === false, "live layer (no tier) never uses copies");
ok(isPagesSlot(0) && isPagesSlot(14) && isPagesSlot(46) && !isPagesSlot(5), "Pages slot minutes = 14, 0, 1 (mod 15)");
ok(needFresh({ auto: false, tier: "five", tierDue: false, copyFetchedAt: 1e12, now: 1e12 }) === true, "manual run = always fresh");
ok(COPY_MAX_MS.five + TIER < 90 * MIN, "5-min tier limit + tier < 90 min (tools/freshness_config.json whale-consensus / big-transfers)");

// fix-deploy-2 (2026-10-30): hourly not-due copies come from the host with the NEWER pf (stale i18n pack incident)
{ const P = pickCopySource;
ok(P({ tier: "hourly", pagesPf: 1000, staticPf: 2000 }).src === "static" && P({ tier: "hourly", pagesPf: 1000, staticPf: 2000 }).pf === 2000, "hourly: mr-static newer -> copy from mr-static, pf = its stamp");
ok(P({ tier: "hourly", pagesPf: 3000, staticPf: 2000 }).src === "pages" && P({ tier: "hourly", pagesPf: 3000, staticPf: 2000 }).pf === 3000, "hourly: Pages newer -> copy from Pages");
ok(P({ tier: "hourly", pagesPf: 2000, staticPf: 2000 }).src === "pages", "hourly: tie -> Pages (old behaviour)");
ok(P({ tier: "hourly", pagesPf: undefined, staticPf: 2000 }).src === "static", "hourly: Pages stamp unknown, mr-static known -> mr-static");
ok(P({ tier: "hourly", pagesPf: undefined, staticPf: undefined }).src === "pages" && P({ tier: "hourly" }).pf === undefined, "hourly: both unknown -> Pages, pf unknown (needFresh then fetches fresh)");
ok(P({ tier: "five", pagesPf: 1000, staticPf: 9000 }).src === "pages", "other tiers keep copying from Pages (no extra mr-static requests)");
ok(P({ tier: "hourly", pagesPf: "x", staticPf: "1500" }).src === "static" && P({ tier: "hourly", pagesPf: "x", staticPf: "1500" }).pf === 1500, "bad / string stamps are parsed or ignored");
// the incident: fresh at 10:12 (not a Pages slot) -> mr-static pf 10:12, Pages pf 09:15; the 10:20 not-due run must keep the 10:12 copy and not refetch
{ const t0 = Date.UTC(2026, 9, 30, 9, 15), t1 = Date.UTC(2026, 9, 30, 10, 12), now = Date.UTC(2026, 9, 30, 10, 20); const c = P({ tier: "hourly", pagesPf: t0, staticPf: t1 });
  ok(c.src === "static" && c.pf === t1 && needFresh({ auto: true, tier: "hourly", tierDue: false, copyFetchedAt: c.pf, now, pagesSlot: false }) === false, "incident replay: 10:20 run copies the 10:12 mr-static file, no extra bot fetch"); } }
function simulate(useNew, phase, lagMin, cancelEvery) {
  let staticState = phase ? 0 : 0, lastDue = -phase * MIN; // phase shifts when the tier falls due relative to the 15-min slots
  let staticContent = 0, pagesQueue = [], pagesView = { contentAt: 0, pf: undefined, state: 0 };
  let maxAge = 0, fetches = 0, slotNo = 0;
  staticState = lastDue;
  for (let m = 30; m < 30 + 24 * 60; m++) {
    const now = m * MIN;
    while (pagesQueue.length && pagesQueue[0].visibleAt <= now) pagesView = pagesQueue.shift().v;
    const STATE = Math.max(staticState, pagesView.state);
    const tierDue = now - STATE >= TIER * 0.9;
    const fresh = useNew ? needFresh({ auto: true, tier: "five", tierDue, copyFetchedAt: pagesView.pf, now, pagesSlot: isPagesSlot(m % 60) }) : tierDue;
    let contentAt, pf;
    if (fresh) { contentAt = now; pf = now; fetches++; } else { contentAt = pagesView.contentAt; pf = pagesView.pf; }
    if (tierDue) staticState = now;
    staticContent = contentAt;
    maxAge = Math.max(maxAge, now + MIN - staticContent); // served until the next run replaces it
    if (m % 15 < 2) { slotNo++; if (!(cancelEvery && slotNo % cancelEvery === 0)) pagesQueue.push({ visibleAt: now + lagMin * MIN, v: { contentAt, pf, state: staticState } }); }
  }
  return { maxAgeMin: maxAge / MIN, fetches };
}
let oldWorst = 0, newWorst = 0, newFetchMax = 0;
for (const phase of [0, 1, 2, 3, 4]) for (const lag of [2, 10, 14]) for (const cancel of [0, 3, 5]) {
  const o = simulate(false, phase, lag, cancel), n = simulate(true, phase, lag, cancel);
  oldWorst = Math.max(oldWorst, o.maxAgeMin); newWorst = Math.max(newWorst, n.maxAgeMin); newFetchMax = Math.max(newFetchMax, n.fetches);
}
console.log("old rule worst age " + oldWorst.toFixed(0) + " min | new rule worst age " + newWorst.toFixed(0) + " min, bot fetches/day max " + newFetchMax);
ok(oldWorst > 90, "simulation reproduces the incident: old rule goes > 90 min stale");
ok(newWorst <= COPY_MAX_MS.five / MIN + 15, "new rule worst age <= copy limit + 15 min (got " + newWorst.toFixed(0) + ")");
ok(newFetchMax <= 600, "new rule does not poll the bot every minute (worst fetches/day per file " + newFetchMax + " <= 600; tier alone = 288)");
console.log(fail ? "TEST copy_age RED " + fail : "TEST copy_age GREEN");
process.exit(fail ? 1 : 0);
