# Moving the minute-level work from GitHub Actions to our own server (VPS)

Why: GitHub's terms say Actions must not be used as a server / CDN ("serverless computing"). Our 1-minute loop (Google Apps Script
-> workflow_dispatch -> static-snap) is exactly that. It works today, but it is the one piece that GitHub could restrict. When a
real server exists, move it and delete the workflow trigger. A restriction only costs freshness (pages fall back to live API),
never availability.

## What to buy (owner decides)
- Cloudzy 2 GB (about 8 USD/month, pays with crypto, no card, no KYC) - already the owner's choice - OR
- Oracle Cloud "Always Free" ARM VM (0 USD, but a bank card is needed for identity check; some regions/cards are refused).

## Steps (about 30 minutes, Ubuntu 22.04/24.04)
1. `adduser mr` ; install: `apt install -y git nodejs npm` (node >= 20: use NodeSource) ; `npm i -g wrangler@4`.
2. As user mr: `git clone https://github.com/alihosseiniytm-stack/mr-channel-post.git` (public repo).
3. Create `/etc/mr/publisher.env` (chmod 600, owner root) with these names (same values as the GitHub secrets):
   SUPABASE_URL SUPABASE_SERVICE TURSO_URL TURSO_TOKEN NEON_URL UPSTASH_URL UPSTASH_TOKEN MONGO_URI
   CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID FIREBASE_SA (the whole JSON on one line) GH_PAGES_TOKEN (fine-grained token, Contents rw on mr-channel-post)
4. `cp vps/mr-publisher.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now mr-publisher`
5. Check: `journalctl -u mr-publisher -f` ; `curl -sI https://mr-static.alihosseini-ytm.workers.dev/snap/whale-feed.json | grep -i x-snap-at` must stay < 90 s old.
6. Only then switch the old path off: delete the Google Apps Script trigger (script.google.com project "Untitled project" -> Triggers)
   and disable the workflow (`gh workflow disable static-snap.yml`). Keep the workflow file for emergencies.

## What the same machine should take over next (this is what closes the gap to GMGN / Hyperdash)
- Hyperliquid WebSocket listener (trades with buyer+seller addresses, userFills for the top wallets) -> instant whale alerts.
- Helius webhook receiver (Solana whale swaps) and an exchange-flow watcher (Whale Alert style) - small Node scripts under systemd.
- All of them write to Turso (read replica already live) and POST alerts to the bot Worker. Nothing critical (keys, login, trading) moves.
