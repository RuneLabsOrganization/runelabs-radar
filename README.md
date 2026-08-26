# Runelabs Radar

Self-hosted AI intelligence hub: automated news ingestion → LLM curation per domain (coding, copy, image gen, video gen, ads, agentic) → web hub with team votes, a "Best Right Now" cost-benefit board, stack playbooks, opportunity dossiers and a daily brief. In the AI gold rush, we sell maps and picks: digested, decision-ready intelligence for builders shipping ideas. **Source-available (BSL 1.1, converts to Apache 2.0 on 2030-08-11) — self-host it for your own team, point it at your own operation. Hosted service offered by Runelabs.**

Design: [docs/superpowers/specs/2026-07-10-runelabs-radar-design.md](docs/superpowers/specs/2026-07-10-runelabs-radar-design.md)

## Make it yours

`cp radar.config.example.json radar.config.json` and describe **your** operation — every LLM prompt (curation, brief, opportunity scout, stack advisor) and the UI branding read from it. Sources are DB rows editable in Admin → Sources (adding a feed is a form, not a deploy).

## How it works

- **worker** (node-cron): ingests ~19 sources every 30 min (RSS, Hacker News, Reddit, arXiv, Hugging Face, GitHub trending), clusters + scores stories hourly with MiniMax, drafts weekly board proposals (Artificial Analysis API + benchmark snapshots), writes a daily brief at 07:00.
- **web** (Next.js): the hub — Today feed with "since your last visit", per-domain tabs, board with editable Runelabs verdicts, brief archive, admin (sources health, job runs, proposal review). Public surfaces: `/changelog.xml` + `/brief.xml` RSS feeds, `/embed/board` iframe widget, `/story/[id]` + `/entity/[name]` SEO pages. It is also the OAuth 2.1 authorization server for MCP clients.
- **mcp** (`npm run mcp`, port 3122): the agent-facing product — compact job tools (`ask_radar`, `whats_relevant`, `decide`) plus specialists, `radar://` resources, and `generate_plan`. Radar researches so the coding agent does not; every structured reply includes an `economy` savings receipt.
- **SQLite** (WAL) shared by both, one file under `data/`.

Stories are never blackholed: if MiniMax is down or the daily call cap is hit, items still appear in the raw feed.

## Connect your agent (MCP)

The MCP server is research-as-a-service for agents: compact lookups (~300 tokens in, ~8k DIY tokens kept out of context vs local research), `ask_radar` synthesis, and `generate_plan` (markdown or JSON, not both). Every structured reply carries an `economy` receipt.

Point any MCP client at the endpoint (streamable HTTP) — or open **`/connect`** on the hub for guided, per-client instructions:

```
https://<your-host>/mcp          # behind your reverse proxy, or http://127.0.0.1:3122/mcp locally
```

- **Claude Code**: `claude mcp add --transport http radar https://<your-host>/mcp`
- **Claude Desktop / Cursor / ChatGPT**: add the URL as a remote/HTTP MCP server in the client's settings.

**Auth.** Default (self-host) is anonymous + IP rate-limited — nothing to do. For a shared/hosted deployment set `MCP_AUTH_REQUIRED=true`: clients then run the OAuth 2.1 flow automatically (PKCE + dynamic client registration, no keys to copy) — the hub shows a consent screen at `/oauth/authorize` and issues tokens. Scopes: `read` (all intelligence) and `plans` (plan generation, which spends LLM budget).

**Finding something to build.** Three rungs, cheapest first:

1. `get_opportunities` — the curated public radar: reviewed, scored, the same for everyone. Free. Prompt: `find_and_plan`.
2. `get_leads` — unlimited openings composed *for you alone* by crossing live signal against a business-wedge taxonomy. Deliberately unvalidated (heuristic score, no verdict), free, and pageable with `next_cursor` until the combination space runs out. Two callers never see the same leads. The page is ordered pain-first, then heuristic. Prompt: `explore_unlimited`.
3. `refine_lead` (`{ lead }`) → `forge_opportunity` (`{ opportunity }`) → `generate_plan` (`format=markdown`) — one LLM call scores a lead into your private opportunity; the forge runs a four-role adversarial debate over it (Builder+); the plan makes it executable.

`dismiss_opportunity` (`{ target, reason, avoid_sector? }`) teaches your pool what not to show you again. Call `get_my_usage` for quota and tokens saved.

Other prompts: `whats_new_today`, `what_should_i_use`, `validate_idea`, `builder_weekly_review`, `which_agent_stack`. Call `get_server_guide` from any agent for the live tour.

**What to actually run.** Persona kits — one pick per job, a monthly total, honest gaps. `list_kits` (the roster), `get_kit` (costed kit for a persona; usage-priced picks are excluded from the total and flagged separately), `explain_pick` (evidence receipts behind one cell), `set_my_kit` / `get_my_kit` (save and read the caller's committed stack), `whats_changed` (kit pick history: which tool replaced which, filterable by persona). Every cell currently reports "not yet covered" until the feeder plans land.

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
| `MINIMAX_MODEL` | default `MiniMax-M3` |
| `MINIMAX_DAILY_CALL_CAP` | default 500 calls/day |
| `AA_API_KEY` | optional; enables Artificial Analysis data (board sync + market scatter) |
| `PUBLIC_MODE` | `true` = anonymous read-only access; votes/verdicts/admin still require login |
| `MCP_AUTH_REQUIRED` | `true` = MCP endpoint requires OAuth 2.1 bearer tokens (hub is the authorization server); default anonymous |
| `MCP_RATE_LIMIT` | requests/hour per token (authed) or per IP (anonymous); default 300 |
| `MCP_PLAN_DAILY_CAP` | plan generations/day per token or IP (each costs 6-7 LLM calls); default 10 |
| `MCP_SCOUT_DAILY_CAP` | anonymous scout runs/day per IP; default 10 (signed-in callers use tier quotas) |
| `OAUTH_ISSUER` / `MCP_PUBLIC_URL` | public URLs for the OAuth metadata endpoints; default derived from `SITE_URL` |

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

- **Hosted mode — flip MCP auth (one deliberate ops step)**: set `MCP_AUTH_REQUIRED=true` in the box `.env`, then `docker compose up -d mcp`. Anonymous MCP access stops; OAuth 2.1 + `/connect` handle onboarding (no keys to copy), and the tiers shown at `/pricing` apply. Authed users default to the free tier (3 plans/mo) until granted a row in `plan_entitlements` — manual SQL until Stripe checkout lands (Phase 8c):

  ```sql
  INSERT INTO plan_entitlements (user_id, tier, plans_per_month) VALUES (<uid>, 'builder', 30)
  ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, plans_per_month = excluded.plans_per_month;
  ```
- **Admin → Sources**: feed health (consecutive failures, last status), enable/disable, add/edit — no deploy needed.
- **Admin → Proposals**: weekly board sync drafts changes; approve/reject. Approved changes land on the board and in "Changed recently".
- **Staleness banner**: the hub warns when ingest (>2h) or curate (>3h) hasn't succeeded.
- **LLM spend**: capped by `MINIMAX_DAILY_CALL_CAP`; usage tracked per day in the `llm_usage` table.
