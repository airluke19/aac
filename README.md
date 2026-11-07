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
3. **Every week, the plan** — it moves forward (at least 2 of 3 sessions done, no alarms), repeats (0–1 sessions, or average HR above 82% of max) or steps back (overload or poor recovery).
4. **Every 3 weeks, the intensity** — calm / balanced / ambitious, automatically fine‑tuned by ±10% when weeks are consistently too easy or too hard.
5. **Personal zones, pace and predictions** — HR zones based on your max HR, running efficiency, race time prediction (Riegel) and the date your goal becomes reachable.

**Principles:** clear rules, the same for everyone — not a black box. Health comes before intensity. Every change comes with a written reason.

### Features

- **Today** — next session, readiness, last run, weekly summary
- **Runs** — history, filters, shoe tracking; run detail with GPS map, HR, pace, cadence, power, elevation, running dynamics, run/walk laps, RPE, weather and shoes
- **Plan** — calendar with every adaptation explained; copy a completed session as Markdown for any AI assistant
- **Progress** — goal, predictions, training load
- **Health** — resting HR, HRV, sleep, steps and more
- Multi‑user with Google login, invite‑based sign‑up with admin approval
- Light/dark theme, Italian/English, 9 accent colours, mobile‑first

---

## Self‑hosting

### Requirements

- Docker with Docker Compose
- A free [Intervals.icu](https://intervals.icu) account per user, with your watch syncing to it
- For multi‑user mode: a Google OAuth client and a public HTTPS URL (reverse proxy, Cloudflare Tunnel, etc.)

### Stack

Node.js 22, Express, SQLite (better‑sqlite3), node‑cron. Single‑file frontend with Chart.js and MapLibre (OpenFreeMap tiles). Weather from Open‑Meteo.

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
| `BIND_ADDR` / `HOST_PORT` | Optional, host listen address and port (default `127.0.0.1:3000`) |

Google login is enabled only when `PUBLIC_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `ADMIN_EMAIL` are all set. Without them AAC runs in **single‑user mode with no login**: in that case keep it bound to `127.0.0.1` and never expose it to the internet.

### 2. Start

```bash
docker compose up -d --build
docker compose ps        # wait until the container is (healthy)
docker logs coach-backend
```

The app listens on port 3000. Put it behind an HTTPS reverse proxy (Caddy, Nginx, Traefik) or a Cloudflare Tunnel pointing to `http://<host>:3000`; if the proxy runs on another machine, set `BIND_ADDR=0.0.0.0`.

### 3. First login

1. Open `PUBLIC_URL` and sign in with the `ADMIN_EMAIL` Google account.
2. In **Account**, paste your Intervals.icu API key and athlete ID (Intervals.icu → Settings → Developer Settings). Keys are stored encrypted.
3. Choose your goal: AAC reads your history and proposes where to start.

New users sign up with Google and appear as pending requests for the admin to approve.

### Data and backups

All data lives in the Docker volume `coach-db` (mounted at `/data`):

- `sistema.db` — users and sessions
- `corse.db` — admin's data; `utenti/u<id>-<hex>.db` — one database per user

Back up the volume regularly, for example:

```bash
docker run --rm -v coach-db:/data -v "$PWD":/backup alpine tar czf /backup/aac-data.tgz -C /data .
```

### Updating

```bash
git pull
docker compose up -d --build
```

### Security notes

- The container runs as a non‑root user with a read‑only root filesystem, no capabilities and `no-new-privileges`.
- Never commit `.env`, databases or certificates — `.gitignore` already excludes them.
- Do not expose the app publicly without Google login configured.

---

## Cloud version

Don't want to host it yourself? Use the free cloud version at **[aac.run](https://aac.run)** — sign in with Google and request access.

## License

All rights reserved. This is a private repository.
