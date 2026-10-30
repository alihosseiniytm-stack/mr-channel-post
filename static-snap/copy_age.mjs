// MODULE static-snap/copy_age.mjs | static-snap publisher | SECTION 30_whales
// WHAT: decides if a "not due" snapshot may reuse the GitHub Pages copy, by the time that copy was REALLY fetched from the bot (T30-20).
// WHY: the tier clock comes from mr-static (updated every run) but copies come from Pages (updated every 15 min, lags ~10 min). Without this
//      check a Pages copy was copied onto itself run after run, so whale-consensus / big-transfers sat 2 h old while the bot had fresh data.
// TALKS TO: nothing (pure). WRITES: none. TEST: tests/30_whales/test_copy_age.mjs
// Max age of a reused copy per tier. Must stay well inside tools/freshness_config.json (tightest tiered limit: whale-consensus / big-transfers 90 min).
export const COPY_MAX_MS = { five: 35 * 60e3, ten: 35 * 60e3, spot: 60 * 60e3, hourly: 100 * 60e3 };

// true = the Pages copy is too old (or its fetch time is unknown) -> fetch fresh from the bot this run
export function copyTooOld(fetchedAt, tier, now) {
  const max = COPY_MAX_MS[tier];
  if (!max) return false;
  const t = Number(fetchedAt);
  return !(t > 0) || now - t > max;
}

// Minutes (UTC minute % 15) of runs whose output GitHub Pages publishes (workflow step: minute % 15 < 2; 14 covers a run that starts
// at :x4 and reaches the Pages step a minute later). These runs fetch fresh, so the copies later runs reuse are young.
export const PAGES_SLOT_MIN = [14, 0, 1];
export const isPagesSlot = (utcMinute) => PAGES_SLOT_MIN.indexOf(utcMinute % 15) >= 0;

// one decision for a tiered path: fetch fresh when the tier is due, OR this run feeds Pages, OR the copy we would reuse is too old
export function needFresh({ auto, tier, tierDue, copyFetchedAt, now, pagesSlot }) {
  if (!auto || !tier) return true;
  if (tierDue || (pagesSlot && tier !== "hourly")) return true;
  return copyTooOld(copyFetchedAt, tier, now);
}

// fix-deploy-2 (T60-08, 2026-10-30): an hourly file fetched fresh on a run that is NOT a Pages slot lands on mr-static only; Pages keeps
// the older copy. Copying from Pages on the next not-due runs then put that OLD file back on mr-static (new i18n keys lagged ~2 h).
// So for the hourly tier a not-due copy comes from whichever host holds the NEWER pf stamp. Ties / unknown -> Pages (old behaviour).
// Returns { src: "static" | "pages", pf } where pf = the fetch time of the copy we take (undefined = unknown).
export function pickCopySource({ tier, pagesPf, staticPf }) {
  const p = Number(pagesPf) > 0 ? Number(pagesPf) : undefined, s = Number(staticPf) > 0 ? Number(staticPf) : undefined;
  if (tier === "hourly" && s !== undefined && (p === undefined || s > p)) return { src: "static", pf: s };
  return { src: "pages", pf: p };
}
