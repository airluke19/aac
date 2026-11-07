# AAC — AI Adaptive Coach

**An adaptive running coach that takes you to your goal — 5 km, 10 km, half marathon or marathon — with a plan that adjusts every day and every week to your real data.**

Try it for free at **[aac.run](https://aac.run)** (cloud version, free for now — request an invite), or explore the read‑only demo at [aac.run/demo](https://aac.run/demo).

---

## Why AAC

A fixed training plan ignores how you feel: if you slept badly, you're tired, or you're ahead of schedule, the plan doesn't change. AAC runs an **adaptive loop** — *Assess → Train → Listen → Adapt* — using your workouts, heart rate, HRV and sleep from [Intervals.icu](https://intervals.icu).

It works with any watch that uploads to Intervals.icu: Apple Watch (via a companion app), Garmin, Coros, Polar, Suunto and more.

### Five levels of adaptation

1. **Starting point** — on first login AAC reads your Intervals.icu history (your longest continuous run) and suggests the week to start from.
2. **Every day, the session** — resting HR, HRV and sleep are compared with your personal 28‑day baseline. One warning sign (resting HR ≥ +5 bpm, HRV ≤ −15%, sleep < 5h30′) and today's session drops to ~60%; quality sessions become 25′ easy. The reason is always shown.
3. **Every week, the plan** — it moves forward (at least 2 of 3 runs done, no alarms; walks never count — AAC is about running — except for the plan's recovery walks), repeats (0–1 sessions, or average HR in Z4–Z5, i.e. ≥ 80% of max) or steps back (overload or poor recovery).
4. **Every 3 weeks, the intensity** — calm / balanced / ambitious, automatically fine‑tuned by ±10% when weeks are consistently too easy or too hard.
5. **Personal zones, pace and predictions** — the standard 5‑zone model as % of max HR (Z1 50–60%, Z2 60–70%, Z3 70–80%, Z4 80–90%, Z5 90–100%, below 50% shown as “below zones”, like Garmin, Polar and Suunto); max HR measured by you or estimated as 208 − 0.7 × age (Tanaka), also used as the safety HR not to exceed; time in zones from second‑by‑second heart rate, recalculated for past runs whenever max HR changes; running efficiency, race time prediction (Riegel) and the date your goal becomes reachable.

**Principles:** clear rules, the same for everyone — not a black box. Health comes before intensity. Every change comes with a written reason.

### Features

- **Today** — next session, readiness, last run, weekly summary
- **Health** — resting HR, HRV, sleep, steps, BMI (latest weight from your scale or profile; height and weight are asked once in a pop‑up if missing) and more
- **Plan** — calendar with every adaptation explained; copy a completed session as Markdown for any AI assistant
- **Runs** — history, filters, shoe tracking; run detail with GPS map, HR, pace, cadence, power, elevation, running dynamics, run/walk laps, RPE, weather and shoes
- **Progress** — goal, predictions, training load
- Multi‑user with Google login, invite‑based sign‑up with admin approval; admin panel with per‑user usage stats (active days, minutes per day, usual time of day, plan adherence) — only days and minutes with the app open in the foreground are stored, aggregated per day, for 6 months
- Light/dark theme, Italian/English, 9 accent colours, mobile‑first

---

## Self‑hosting

### Requirements

- Docker with Docker Compose
- A free [Intervals.icu](https://intervals.icu) account per user, with your watch syncing to it
- For multi‑user mode: a Google OAuth client and a public HTTPS URL (reverse proxy, Cloudflare Tunnel, etc.)

### Architecture

Two services, each with its own image:

| Service | Image | What it does |
|---|---|---|
| `backup` | `ghcr.io/airluke19/aac-backup` | Nightly verified backups of the databases with rotation, and restore. No network. |
| `frontend` | `ghcr.io/airluke19/aac-frontend` | nginx (unprivileged, port 8080): serves the app (`frontend/public`) and proxies `/api`, `/auth` and `/demo` to the backend. The app page is served only after the backend confirms the sign‑in (`auth_request` → `/auth/verifica`). It is the only service published on the host. |
| `backend` | `ghcr.io/airluke19/aac-backend` | Node.js 22, Express, SQLite (better‑sqlite3), node‑cron: API, Google sign‑in, Intervals.icu sync, plan engine. Reachable only from the frontend on the internal Compose network. |

Frontend: plain HTML/CSS/JS (`index.html`, `css/`, `js/`) with Chart.js, MapLibre (OpenFreeMap tiles) and the Inter font, all served by the frontend itself (`/vendor`, downloaded at build time with pinned checksums); CSS/JS links carry a content hash so browsers cache them until they change. Weather from Open‑Meteo.

Both containers run as non‑root users with a read‑only root filesystem.

### 1. Clone and configure

```bash
git clone https://github.com/airluke19/aac.git
cd aac
cp .env.example .env
chmod 600 .env
```

Edit `.env`:

| Variable | Description |
|---|---|
| `PUBLIC_URL` | Public HTTPS URL of your instance, no trailing slash |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client (type *Web application*). Authorized redirect URI: `<PUBLIC_URL>/auth/google/callback` |
| `ADMIN_EMAIL` | Google account of the administrator, who approves new users |
| `APP_SECRET` | Random secret used to encrypt Intervals.icu API keys — generate with `openssl rand -base64 32` and never change it |
| `ATHLETE_AGE` | Optional, initial age of the admin user, used to estimate max HR (default `33`); every user can change it later in **Account** |
| `SYNC_CRON` | Optional, sync schedule (default `*/30 * * * *`) |
| `BIND_ADDR` / `HOST_PORT` | Optional, host listen address and port of the frontend (default `127.0.0.1:3000`) |
| `AAC_TAG` | Optional, image tag for all services (default `latest`; `staging`, or `sha-<commit>` to roll back) |
| `LOGIN_GOOGLE` | Optional, `off` turns Google sign‑in off even when configured: single‑user mode, and the backend rejects every request coming from the internet (Cloudflare headers), so the instance is usable only locally |
| `AAC_AMBIENTE` | Optional, `staging` shows a **BETA** badge next to the logo (app and sign‑in page) and prefixes the tab title, so a test instance is never mistaken for production (default `production`) |
| `COMPOSE_PROFILES` | `backup` (already in `.env.example`) runs the nightly backup service; leave it out only on a test instance (e.g. staging): the service and its volume are then not created at all |
| `COMPOSE_PROJECT_NAME` / `AAC_PREFIX` | Optional, run several instances on one host (e.g. production `ai-adaptive-coach`/`aac`, staging `aac-staging`/`aac-staging`; default prefix `aac`): containers and volumes are named `<AAC_PREFIX>-backend`, `<AAC_PREFIX>-db`… |

Google login is enabled only when `PUBLIC_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `ADMIN_EMAIL` are all set. Without them AAC runs in **single‑user mode with no login**: in that case keep it bound to `127.0.0.1` and never expose it to the internet.

### 2. Start

```bash
docker compose up -d --build
docker compose ps        # wait until the container is (healthy)
docker logs aac-backend
```

The app (frontend) listens on host port 3000 by default (`HOST_PORT`). Put it behind an HTTPS reverse proxy (Caddy, Nginx, Traefik) or a Cloudflare Tunnel pointing to `http://<host>:3000`; if the proxy runs on another machine, set `BIND_ADDR=0.0.0.0`.

### 3. First login

1. Open `PUBLIC_URL` and sign in with the `ADMIN_EMAIL` Google account.
2. In **Account**, paste your Intervals.icu API key and athlete ID (Intervals.icu → Settings → Developer Settings). Keys are stored encrypted.
3. Choose your goal: AAC reads your history and proposes where to start.

New users sign up with Google and appear as pending requests for the admin to approve.

### Data and backups

All data lives in the Docker volume `aac-db` (mounted at `/data`):

- `sistema.db` — users and sessions
- `corse.db` — admin's data; `utenti/u<id>-<hex>.db` — one database per user
- `.chiave-app` — key that encrypts the Intervals.icu API keys when `APP_SECRET` is not set

The **`backup`** service (`aac-backup`, no network, non‑root) backs up every night at 03:30 (`BACKUP_CRON`) into the `aac-backup` volume, and once at start‑up if the last backup is older than 24 hours:

- hot, consistent copy of each SQLite database (SQLite backup API), `integrity_check` on the copy, gzip and SHA‑256 in a `manifest.json` with row counts; the encryption key file is included;
- one folder per backup (`AAAA-MM-GG_HHMM`), written to a temporary folder and published only when complete;
- retention (`BACKUP_KEEP_DAILY/WEEKLY/MONTHLY`, defaults 7/4/6): the newest backup of each of the last N days, plus the **first** backup of each of the previous W weeks and M months (and of the current week and month, which become the “previous” copy when the period ends) — so with 7/1/1 you always have 7 daily copies, one 7–13 days old and one 30–60 days old;
- the container is healthy only if the last successful backup is less than 26 hours old.

Restore (verifies every checksum and the integrity of every database before touching anything; current databases are moved to `/data/pre-restore-<date>/`, never deleted; refuses to run while the backend is using the databases):

```bash
docker compose stop backend
docker compose run --rm backup node restore.js                  # list backups
docker compose run --rm backup node restore.js 2026-11-08_0330  # restore one
docker compose start backend
```

Backups stay on the same machine: copy the `aac-backup` volume elsewhere if you need protection from disk failure. Keep `.env` safe too, it is not part of the backup.

### Updating

```bash
git pull
docker compose up -d --build
```

### Prebuilt images (GHCR)

GitHub Actions builds both images on every push that touches `backend/` or `frontend/` and publishes it to GitHub Container Registry:

| Branch | Image |
|---|---|
| `staging` | `ghcr.io/airluke19/aac-backend:staging`, `ghcr.io/airluke19/aac-frontend:staging` |
| `main` | `ghcr.io/airluke19/aac-backend:latest`, `ghcr.io/airluke19/aac-frontend:latest` |

Every build is also tagged `sha-<commit>`. Images are public, so no login is needed. `docker-compose.yml` uses `${AAC_TAG:-latest}` for both images (they are always built together); set `AAC_TAG` in `.env` (e.g. `staging` or `sha-abc1234` to roll back) to pick another tag:

```bash
docker compose pull
docker compose up -d
docker compose ps        # wait until the container is (healthy)
```

`docker compose up -d --build` still builds the images locally instead.

For frontend development without nginx, the backend can serve the static files itself: `PUBLIC_DIR=../frontend/public node server.js` (from `backend/`).

### Branches

Work happens on `staging`; `main` only receives merges of tested changes.

### Security

AAC is designed to be exposed on the internet. Controls, mapped to the OWASP Top 10 (2025):

| Area | What AAC does |
|---|---|
| **Access control** (A01) | Every API call is bound to the signed‑in user's own database; admin endpoints check the role; the app page is served only after the backend confirms the session (`auth_request`); the demo is read‑only. |
| **Configuration** (A02) | Strict Content‑Security‑Policy (scripts only from the app itself, no inline code, no `eval`), HSTS, `X-Frame-Options`/`frame-ancestors`, COOP/CORP, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; no directory listing, only known files are served, no server version; generic error messages (no stack traces). |
| **Supply chain** (A03, A08) | `package-lock.json` + `npm ci`; third‑party JS and fonts (Chart.js, MapLibre, Inter) are downloaded at build time with pinned versions and SHA‑256 checksums and served by the frontend, so no CDN or Google Fonts at runtime; all GitHub Actions pinned to commit SHAs; images published with SLSA provenance and SBOM attestations; Dependabot for npm, Docker and Actions. |
| **Cryptography** (A04) | Intervals.icu API keys encrypted at rest with AES‑256‑GCM; session tokens are 256‑bit random values stored only as SHA‑256 hashes; HTTPS only. |
| **Injection** (A05) | Parameterised SQL everywhere; all dynamic HTML escaped; input validated against allow‑lists; JSON bodies limited to a few KB. |
| **Authentication** (A07) | Google OpenID Connect with PKCE and `state`; invite/approval for new accounts; session cookie `__Host-aac_sess` (`Secure`, `HttpOnly`, `SameSite=Lax`, host‑only), 30‑day expiry, server‑side logout; CSRF protection via a custom request header on every state‑changing call; rate limits on sign‑in, sync and API per client IP. |
| **Logging** (A09) | Sign‑ins, blocked attempts, admin actions and impersonation are logged; nginx access logs with the real client IP; Docker logs rotated (3 × 10 MB). |
| **Exceptional conditions** (A10) | Central error handler, request timeouts, body size limits, memory and process limits on both containers. |

CI scans the repository and both images with [Trivy](https://trivy.dev): fixable HIGH/CRITICAL vulnerabilities, secrets or misconfigurations block the release. Images are rebuilt and rescanned every Monday.

Both containers run as non‑root users with a read‑only root filesystem, no capabilities and `no-new-privileges`. Only the frontend is published on the host, by default on `127.0.0.1`.

Never commit `.env`, databases or certificates (`.gitignore` excludes them), and do not expose the app publicly without Google login configured. To report a vulnerability, see [SECURITY.md](SECURITY.md).

---

## Cloud version

Don't want to host it yourself? Use the free cloud version at **[aac.run](https://aac.run)** — sign in with Google and request access.

## License

AAC is free software, released under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).
You can use, modify and self-host it; if you run a modified version as a network service, you must make your source code available to its users under the same license.
