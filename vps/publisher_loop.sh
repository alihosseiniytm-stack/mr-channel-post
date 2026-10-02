#!/bin/bash
# Runs the snapshot publisher on a normal always-on server (VPS) instead of GitHub Actions (owner 2026-10-02: GitHub's terms do not like
# Actions used as a server/CDN, so the minute-level loop moves to our own machine as soon as one exists).
# Needs: node 20+, git, npm, and the env file /etc/mr/publisher.env (same names as the GitHub secrets, see README_MIGRATION.md).
set -u
cd "$(dirname "$0")/.."            # repo root (mr-channel-post)
set -a; . /etc/mr/publisher.env; set +a
export GITHUB_EVENT_NAME=workflow_dispatch   # publish.mjs tiers its work by state file, not by trigger type
cd static-snap
npm install --no-save --silent mongodb >/dev/null 2>&1 || true
while true; do
  START=$(date +%s)
  ( cd .. && git pull -q --rebase 2>/dev/null || true )
  node publish.mjs || echo "publish failed $(date -u +%T)"
  mkdir -p public/vendor public/icons public/status && cp ../vendor/*.js public/vendor/ && cp icons/*.png public/icons/ && cp status/index.html public/status/index.html
  npx --yes wrangler@4 deploy --config wrangler.jsonc 2>&1 | tail -2
  M=$(date -u +%M)
  if [ $((10#$M % 15)) -lt 2 ]; then
    # 2nd/3rd hosts, every 15 min: GitHub Pages (git push of public/ to gh-pages) and Firebase (2 projects) + Firestore sink
    ( cd public && rm -f _headers && touch .nojekyll && cp -rn ../../docs/. . 2>/dev/null; rm -rf .git; git init -q -b gh-pages && git config user.name mr-snapshot && git config user.email mr-snapshot@users.noreply.github.com && git add -A && git commit -q -m "snapshots $(date -u +%FT%TZ)" && git push -q -f "https://x-access-token:${GH_PAGES_TOKEN}@github.com/alihosseiniytm-stack/mr-channel-post.git" gh-pages ) || echo "pages push failed"
    if [ -n "${FIREBASE_SA:-}" ]; then
      rm -rf ../../fb && mkdir -p ../../fb/public/trade && cp firebase/firebase.json firebase/.firebaserc ../../fb/ && cp -r public/. ../../fb/public/ && rm -f ../../fb/public/_headers && cp -r ../docs/trade/. ../../fb/public/trade/
      printf %s "$FIREBASE_SA" > ../../fb/sa.json
      ( cd ../../fb && export GOOGLE_APPLICATION_CREDENTIALS=$PWD/sa.json && npx --yes firebase-tools@14 deploy --only hosting --project mr-mirror-61fd2 --non-interactive 2>&1 | tail -3; npx --yes firebase-tools@14 deploy --only hosting --project mr-mirror-two --non-interactive 2>&1 | tail -3 )
      node firestore_sink.mjs ../../fb/sa.json public/snap || true
      rm -f ../../fb/sa.json
    fi
  fi
  ELAPSED=$(( $(date +%s) - START ))
  [ $ELAPSED -lt 60 ] && sleep $((60 - ELAPSED))
done
