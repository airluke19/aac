# AAC — AI Adaptive Coach

**A running coach that gets you to your goal (5 km, 10 km, half marathon or marathon) with a plan that changes every day and every week based on how you are actually doing.**

👉 Free cloud version at **[aac.run](https://aac.run)** (sign in with Google and request an invite) · read‑only demo at **[aac.run/demo](https://aac.run/demo)** · or host it yourself in about 10 minutes ([jump to setup](#self-hosting-in-6-steps)).

---

## What it is

AAC is a web app (mobile‑first, works on any phone or computer) that acts as your personal running coach:

- you choose a **goal** and an **intensity**;
- AAC builds a **training plan**, from your very first run up to race day;
- every time your watch syncs, AAC **reads your real data** (runs, heart rate, HRV, sleep) and **adjusts the plan**, always telling you why.

It reads your data from [Intervals.icu](https://intervals.icu), a free service that collects data from almost any watch: Apple Watch (via a companion app), Garmin, Coros, Polar, Suunto and more. AAC never asks for your watch password.

## Why AAC (the added value)

A training table from a magazine or a PDF is the same for everyone and never changes. Real life does:

| Situation | Fixed plan | AAC |
|---|---|---|
| You slept 4 hours | Same hard session | Today's session drops to ~60%, quality work becomes an easy run |
| You missed a session | It stays missed | It moves to the remaining days of the week |
| You are progressing faster | You keep waiting | The plan moves on, and later adds a session |
| The weeks feel too hard | You push or give up | The plan repeats the week or eases off by 10% |
| Weekend is busy | Long run on Sunday anyway | The coach respects your preferred days whenever it can |

**Principles:** clear rules, the same for everyone, no black box. Health comes before intensity. **Every change comes with a written reason** you can read in the app.

---

## How it works

AAC repeats a simple loop: **Assess → Train → Listen → Adapt**.

### The algorithm in plain words

**1. Where you start.** When you first connect, AAC looks at your past runs (the longest one you ran without stopping) and suggests the right week to start from, so you don't begin from scratch if you already run, or too high if you don't.

**2. Every day: today's session.** AAC compares your resting heart rate, HRV and sleep with *your own* average of the last 28 days. If one signal looks off:

- resting HR at least 5 bpm higher than usual,
- HRV at least 15% lower than usual,
- or less than 5h30′ of sleep,

then today's session is cut to about 60%, and a hard session becomes 25 easy minutes. You always see which signal triggered it.

**3. Every week: forward, repeat or back.** At the end of each week:

- **forward** if you ran at least 2 sessions and there were no warning signs;
- **repeat** the week if you ran 0–1 sessions, if your average heart rate was too high (80% of max or more) for runs that should be easy, or if you had poor recovery on 3 or more days;
- **back** one week if your training load shows overload, or after two weeks in a row without running.

Only runs count (and sessions you mark as done by hand). Runs on days without a session count too.

**4. How many sessions, and on which days.**

- Everyone starts with **3 sessions a week**.
- A **4th** (and a **5th** for half marathon and marathon) has to be **earned**: 3 weeks in a row with every session done, no fatigue, and training load growing safely (acute/chronic load ratio ≤ 1.3, Gabbett 2016). How many you can reach depends on your goal, phase and intensity, as in the classic plans by Daniels, Pfitzinger and Higdon.
- The extra sessions are always **easy runs**: more volume, not more intensity (the 80/20 rule, Seiler).
- They go away again with signs of fatigue, or if for 2 weeks they don't fit in your life. Recovery weeks, race week and the run‑walk phase stay at 3.
- **Fixed days:** in the plan guide you choose whether your days are only **suggested** or **fixed**. With fixed days the coach only uses those: with 2 days it keeps the key sessions (long run, quality) and skips an easy run, and if they are back to back the second one is always easy; with just 1 day you do one session at a time and each plan week lasts two weeks, so the goal moves later. It tells you honestly when a choice is not ideal ("not the best, but let's try") and gives tips.
- **Days:** for every week the coach tries every possible combination of days and picks the best one. The rules: never two hard sessions (long run, pace work, race) on consecutive days; long run and race preferably at the weekend; your **preferred days** whenever possible; a missed session moves to the days left in the week. When a session lands outside your preferred days, the calendar tells you why.

**5. Every 3 weeks: intensity.** You choose *easy‑going*, *balanced* or *ambitious*. If 3 weeks in a row are too easy, or 2 out of 3 are too hard, the coach adjusts it by ±10% on its own.

**6. Your zones, pace and predictions.** Heart‑rate zones are personal, computed from your max HR (measured by you, or estimated as 208 − 0.7 × age): easy runs below 70%, quality work at 80–90%. From your runs AAC estimates your efficiency, your race time (Riegel formula) and the date your goal becomes realistic.

### Plans

| Goal | Weeks | Phases |
|---|---|---|
| 5 km | 16 | Restart (run‑walk) → aerobic base → speed → race |
| 10 km | 22 | Restart → aerobic base → build → taper and race |
| Half marathon | 26 | Restart → aerobic base → build → peak, taper and race |
| Marathon | 36 | Restart → aerobic base → build → marathon block → taper and race |

Goal, intensity and days are set with a **step-by-step guide that opens inside the Plan tab** (the profile only has a shortcut to it) (goal → intensity → days → the coach's proposal): at every step the coach explains the choice, warns you honestly when it is not ideal and, before you confirm, shows a **preview of the new plan** (plan week, sessions S1, S2, S3…, estimated race date and tips). After that the plan adapts by itself. A new goal continues from the same phase of the new plan, starting from the current week: your history and the runs you already did stay.

### What you see in the app

- **Today:** next session, how you are today, last run, this week
- **Health:** resting HR, HRV, sleep, steps, BMI and more
- **Plan:** calendar with every change explained; copy a finished session as Markdown to discuss it with any AI assistant; download the calendar (.ics)
- **Runs:** history, filters, shoes; run detail with GPS map, heart rate, pace, cadence, power, elevation, running dynamics, laps, effort (RPE) and weather
- **Progress:** goal, predictions, training load
- **Info:** every rule explained in plain language

Light and dark theme, Italian and English, 26 sporty accent colours. Multi‑user with Google sign‑in, invitations and admin approval.

---

## Self‑hosting in 6 steps

### What you need

- A Linux machine (or Mac/Windows) with **Docker** and **Docker Compose** (`docker compose version` must work)
- A **domain** with HTTPS in front of it (Caddy, Nginx, Traefik or a Cloudflare Tunnel)
- A **Google account** to create the sign‑in client (free)
- Each user needs a free **Intervals.icu** account with their watch syncing to it

### 1. Download

```bash
git clone https://github.com/airluke19/aac.git
cd aac
cp .env.example .env
chmod 600 .env
```

### 2. Create the Google sign‑in client

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) (create a project if asked).
2. **Create credentials → OAuth client ID → Web application.**
3. Under **Authorized redirect URIs** add `https://YOUR-DOMAIN/auth/google/callback`.
4. Copy the **Client ID** and **Client secret**.

### 3. Fill in `.env`

Open `.env` with any editor and set these 5 values:

```bash
PUBLIC_URL=https://YOUR-DOMAIN           # no trailing slash
GOOGLE_CLIENT_ID=...                     # from step 2
GOOGLE_CLIENT_SECRET=...                 # from step 2
ADMIN_EMAIL=you@gmail.com                # your Google account: you approve new users
APP_SECRET=...                           # run: openssl rand -base64 32   (never change it afterwards)
```

Leave `COMPOSE_PROFILES=backup` as it is: it turns on the nightly backups.

### 4. Start

```bash
docker compose pull      # download the ready-made images
docker compose up -d     # start
docker compose ps        # wait until every service says (healthy), about 30 seconds
```

The app now answers on `http://127.0.0.1:3000` on that machine.

### 5. Put HTTPS in front of it

Point your domain to the app. Two common ways:

- **Caddy** (gets the certificate on its own): `caddy reverse-proxy --from YOUR-DOMAIN --to 127.0.0.1:3000`
- **Cloudflare Tunnel**: create a tunnel for `YOUR-DOMAIN` with service `http://127.0.0.1:3000`

If the proxy runs on *another* machine, set `BIND_ADDR=0.0.0.0` in `.env` and run `docker compose up -d` again.

### 6. First sign‑in

1. Open `https://YOUR-DOMAIN` and sign in with the `ADMIN_EMAIL` account.
2. In **Account**, paste your Intervals.icu **Athlete ID** and **API key** (Intervals.icu → Settings → Developer Settings). The key is stored encrypted.
3. Choose your goal: AAC reads your history and proposes where to start.

New users sign in with Google and wait for your approval (gear icon next to your avatar).

> **Just trying it on your computer?** Leave the Google variables empty: AAC starts in single‑user mode **without sign‑in**, on `http://127.0.0.1:3000` only. Never expose that mode to the internet.

### Everyday commands

| What | Command |
|---|---|
| Update to the latest version | `git pull && docker compose pull && docker compose up -d` |
| Roll back to a known build | set `AAC_TAG=sha-<commit>` in `.env`, then `docker compose pull && docker compose up -d` |
| See the logs | `docker logs aac-backend` |
| Status | `docker compose ps` |
| Build the images yourself instead of downloading | `docker compose up -d --build` |

### Backups and restore

Every night at 03:30 the `backup` service saves a verified copy of all databases (integrity check, SHA‑256 checksums, row counts) into the `aac-backup` volume. It keeps 7 daily, 4 weekly and 6 monthly copies by default, and is marked unhealthy if the last backup is older than 26 hours.

Restore:

```bash
docker compose stop backend
docker compose run --rm backup node restore.js                  # list backups
docker compose run --rm backup node restore.js 2026-11-08_0330  # restore one
docker compose start backend
```

The restore checks everything before touching anything, moves the current data to `/data/pre-restore-<date>/` (never deletes it) and rolls back if something fails. Backups stay on the same machine: copy the `aac-backup` volume elsewhere to survive a disk failure, and keep `.env` safe (it is not in the backup).

<details>
<summary><b>All configuration options</b></summary>

| Variable | Description |
|---|---|
| `PUBLIC_URL` | Public HTTPS URL, no trailing slash |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client (Web application), redirect URI `<PUBLIC_URL>/auth/google/callback` |
| `ADMIN_EMAIL` | Google account of the administrator |
| `APP_SECRET` | Secret that encrypts the Intervals.icu keys (`openssl rand -base64 32`); never change it. If empty, a key file is generated in the data volume and included in backups |
| `ATHLETE_AGE` | Initial age of the admin user for the max‑HR estimate (default `33`); editable later in **Account** |
| `SYNC_CRON` | Sync schedule (default `*/30 * * * *`); the app also syncs when opened and with the Sync button |
| `BIND_ADDR` / `HOST_PORT` | Host address and port of the app (default `127.0.0.1:3000`) |
| `AAC_TAG` | Image tag: `latest` (default, branch `main`), `staging`, or `sha-<commit>` |
| `COMPOSE_PROFILES` | `backup` runs the nightly backups; remove it only on a test instance |
| `BACKUP_CRON` / `BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY` / `BACKUP_KEEP_MONTHLY` | Backup time and retention (defaults `30 3 * * *`, 7 / 4 / 6) |
| `LOGIN_GOOGLE` | `off` forces single‑user mode; the backend then refuses requests coming from the internet |
| `AAC_AMBIENTE` | `staging` shows a **BETA** badge, so a test instance is never mistaken for production |
| `COMPOSE_PROJECT_NAME` / `AAC_PREFIX` | Run several instances on one host (containers and volumes are named `<AAC_PREFIX>-backend`, `<AAC_PREFIX>-db`…) |
| `INTERVALS_API_KEY` / `INTERVALS_ATHLETE_ID` | Single‑user mode only: Intervals.icu credentials (they can also be entered in **Account**) |

</details>

---

## Under the hood

| Service | Image | Role |
|---|---|---|
| `frontend` | `ghcr.io/airluke19/aac-frontend` | nginx (unprivileged): serves the app and forwards `/api`, `/auth`, `/demo` to the backend. The app page is served only after the backend confirms the sign‑in. The only service published on the host. |
| `backend` | `ghcr.io/airluke19/aac-backend` | Node.js 22, Express, SQLite (better‑sqlite3), node‑cron: API, Google sign‑in, Intervals.icu sync, plan engine. Internal network only. |
| `backup` | `ghcr.io/airluke19/aac-backup` | Nightly verified backups and restore. No network at all. |

- **Data:** Docker volume `aac-db` (`/data`): `sistema.db` (users and sessions) and one SQLite database per user.
- **Frontend:** plain HTML/CSS/JS with Chart.js and MapLibre (OpenFreeMap tiles), all served locally (`/vendor`, pinned versions and checksums). Weather from Open‑Meteo.
- **Images:** GitHub Actions builds all three on every push (`:staging` from `staging`, `:latest` from `main`, plus `sha-<commit>`), scans them with Trivy and publishes them on GHCR (public, no login needed). They are rebuilt and rescanned every Monday.
- **Branches:** development on `staging`, `main` only receives tested changes.
- **Frontend development without nginx:** `PUBLIC_DIR=../frontend/public node server.js` from `backend/`.

### Security

AAC is designed to be exposed on the internet and follows the OWASP Top 10:

- **Access control:** every request is bound to the signed‑in user's own database; admin endpoints check the role; the demo is read‑only.
- **Sign‑in:** Google OpenID Connect with PKCE; invitations and admin approval; `__Host-` session cookie (`Secure`, `HttpOnly`, `SameSite=Lax`), 30 days, server‑side logout; CSRF header on every change; rate limits.
- **Data:** Intervals.icu keys encrypted with AES‑256‑GCM; session tokens stored only as SHA‑256 hashes; parameterised SQL; all dynamic HTML escaped; input checked against allow‑lists.
- **Browser:** strict Content‑Security‑Policy (no inline scripts, no `eval`, no CDN), HSTS, anti‑framing and the other security headers.
- **Containers:** non‑root, read‑only filesystem, no capabilities, `no-new-privileges`, memory and process limits; only the frontend is published, on `127.0.0.1` by default.
- **Supply chain:** `npm ci` with lockfiles, Actions pinned to commit SHAs, SBOM and provenance on images, Dependabot; Trivy blocks releases with fixable HIGH/CRITICAL vulnerabilities, leaked secrets or misconfigurations.
- **Logging:** sign‑ins, blocked attempts and admin actions are logged; Docker logs are rotated.

Never commit `.env` or databases (`.gitignore` excludes them) and never expose the app without Google sign‑in. To report a vulnerability see [SECURITY.md](SECURITY.md).

---

## License

AAC is free software under the [GNU Affero General Public License v3.0](LICENSE) (AGPL‑3.0‑only). You can use, modify and self‑host it; if you offer a modified version as a network service, you must share its source code with its users under the same license.
