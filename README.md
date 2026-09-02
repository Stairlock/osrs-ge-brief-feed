# osrs-ge-brief-feed

Public data feed for a daily OSRS Grand Exchange investment brief.

A scheduled GitHub Action (`.github/workflows/feed.yml`) runs `fetch_feed.mjs`,
which pulls **only public endpoints** — our GE-tracker model's `daily_opportunities`
RPC, the official OSRS news RSS, and the r/2007scape / r/osrs / r/OSRSflipping
feeds — and commits the result to `feed/latest.json`.

A Claude Code cloud routine (which has no direct internet) clones this repo,
reads `feed/latest.json`, reasons over it, and emails the top-5 brief. No secrets
live here: the Action commits with the built-in `GITHUB_TOKEN`, and the Supabase
key embedded in the fetcher is the public anon key that already ships in the web
client.
