# Runelabs Radar

Self-hosted AI intelligence hub: automated news ingestion → LLM curation per domain (coding, copy, image gen, video gen, ads, agentic) → web hub with team votes, a "Best Right Now" cost-benefit board, stack playbooks, opportunity dossiers and a daily brief. **MIT licensed — self-host it, point it at your own operation.**

Design: [docs/superpowers/specs/2026-07-10-runelabs-radar-design.md](docs/superpowers/specs/2026-07-10-runelabs-radar-design.md)

## Make it yours

`cp radar.config.example.json radar.config.json` and describe **your** operation — every LLM prompt (curation, brief, opportunity scout, stack advisor) and the UI branding read from it. Sources are DB rows editable in Admin → Sources (adding a feed is a form, not a deploy).

## How it works

- **worker** (node-cron): ingests ~19 sources every 30 min (RSS, Hacker News, Reddit, arXiv, Hugging Face, GitHub trending), clusters + scores stories hourly with MiniMax, drafts weekly board proposals (Artificial Analysis API + benchmark snapshots), writes a daily brief at 07:00.
- **web** (Next.js): the hub — Today feed with "since your last visit", per-domain tabs, board with editable Runelabs verdicts, brief archive, admin (sources health, job runs, proposal review).
- **SQLite** (WAL) shared by both, one file under `data/`.

Stories are never blackholed: if MiniMax is down or the daily call cap is hit, items still appear in the raw feed.

## Local development

```bash
npm install
cp .env.example .env          # fill in SESSION_SECRET + MINIMAX_API_KEY
npm run seed -- --admin <name> <password>
npm run job -- ingest         # pull sources once
npm run job -- curate         # needs MINIMAX_API_KEY
npm run dev                   # http://localhost:3000
```

Other commands: `npm test` (vitest), `npm run build`, `npm run worker` (cron loop), `npm run job -- board|brief`.

## Environment

| Var | Notes |
|---|---|
| `DATABASE_PATH` | default `./data/radar.db` (`/data/radar.db` in Docker) |
| `SESSION_SECRET` | long random string; required in production |
| `MINIMAX_API_KEY` | same key helix-claw uses — copy from its env on the server |
| `MINIMAX_BASE_URL` | default `https://api.minimax.io/v1` |
| `MINIMAX_MODEL` | default `MiniMax-M2` |
| `MINIMAX_DAILY_CALL_CAP` | default 500 calls/day |
| `AA_API_KEY` | optional; enables Artificial Analysis data (board sync + market scatter) |
| `PUBLIC_MODE` | `true` = anonymous read-only access; votes/verdicts/admin still require login |

## Deploy on the Hetzner box

```bash
git clone <this repo> /opt/runelabs-radar && cd /opt/runelabs-radar
cp .env.example .env && $EDITOR .env     # SESSION_SECRET, MINIMAX_API_KEY (from helix-claw), AA_API_KEY
docker compose build
docker compose run --rm worker npx tsx scripts/seed.ts --admin specter <password>
docker compose up -d
```

Web listens on `127.0.0.1:3121`. Reverse proxy it next to helix-claw / neural-trade:

**Caddy**

```
radar.example.com {
    reverse_proxy 127.0.0.1:3121
}
```

**nginx**

```nginx
server {
    server_name radar.example.com;
    listen 443 ssl;
    location / { proxy_pass http://127.0.0.1:3121; proxy_set_header Host $host; }
}
```

Add team members: `docker compose run --rm worker npx tsx scripts/seed.ts --admin <name> <password>` creates admins; for members, create the row with a one-off script or ask an admin to (v1 keeps user management out of the UI).

Backup: copy `data/radar.db` (plus `-wal`/`-shm` or run `sqlite3 data/radar.db ".backup backup.db"`).

## Operations

- **Admin → Sources**: feed health (consecutive failures, last status), enable/disable, add/edit — no deploy needed.
- **Admin → Proposals**: weekly board sync drafts changes; approve/reject. Approved changes land on the board and in "Changed recently".
- **Staleness banner**: the hub warns when ingest (>2h) or curate (>3h) hasn't succeeded.
- **LLM spend**: capped by `MINIMAX_DAILY_CALL_CAP`; usage tracked per day in the `llm_usage` table.
