# AAC — Always Adaptive Coach

**A running coach that gets you to your goal (5 km, 10 km, half marathon or marathon) with a plan that changes every day and every week based on how you are actually doing.**

👉 Free cloud version at **[aac.run](https://aac.run)** (sign in with Google and request an invite) · read‑only demo at **[aac.run/demo](https://aac.run/demo)** · or host it yourself in about 10 minutes ([jump to setup](#self-hosting-in-6-steps)).

---

> 📖 **Documentation: [docs.aac.run](https://docs.aac.run)** — what AAC is, how the coach works, what to expect, screenshots and the full self-hosting guide, in Italian and English.
> 🏃 **Live demo:** [aac.run/demo](https://aac.run/demo) · ☁️ **Cloud:** [aac.run](https://aac.run), free for all of 2026 · 🏠 **Self-hosted:** open source and free on your own server.

## What it is

AAC is a web app (mobile‑first, works on any phone or computer) that acts as your personal running coach:

- you choose a **goal** and an **intensity**;
- AAC builds a **training plan**, from your very first run up to race day;
- every time your watch syncs, AAC **reads your real data** (runs, heart rate, HRV, sleep) and **adjusts the plan**, always telling you why.

It reads your data from [Intervals.icu](https://intervals.icu), a free service that collects data from almost any watch: Apple Watch (via a companion app), Garmin, Coros, Polar, Suunto and more. AAC never asks for your watch password. Strava users keep Strava and connect the same watch to Intervals.icu too. AAC can also read runs straight from **Strava** with one tap (OAuth), but only on instances that configure a Strava API app: since 2026 that requires a paid Strava subscription, so it is off on aac.run.

## Why AAC (the added value)

A training table from a magazine or a PDF is the same for everyone and never changes. Real life does:

| Situation | Fixed plan | AAC |
|---|---|---|
| You slept 4 hours | Same hard session | Today's session drops to ~60%, quality work becomes an easy run |
| You missed a session | It stays missed | It moves to the remaining days of the week |
| You are progressing faster | You keep waiting | The plan moves on, and later adds a session |
| The weeks feel too hard | You push or give up | The plan repeats the week or eases off by 10% |
| Weekend is busy | Long run on Sunday anyway | The coach respects your preferred days whenever it can |

**Principles:** a plan tailored to your data, no black box. Health comes before intensity. **Every change comes with a written reason** you can read in the app.

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

**6. Your zones, pace and predictions.** Heart‑rate zones are personal: with enough resting‑HR data they use your **heart‑rate reserve** (Karvonen: resting HR + % × (max HR − resting HR)), otherwise a % of max HR (measured by you, or estimated as 208 − 0.7 × age). Easy runs up to 70% (never above 80% of max HR), run‑walk a little lower, quality work at 80–90%. From your runs AAC estimates your efficiency, your race time (Riegel formula) and the date your goal becomes realistic.

### Plans

| Goal | Weeks | Phases |
|---|---|---|
| 5 km | 16 | Restart (run‑walk) → aerobic base → speed → race |
| 10 km | 22 | Restart → aerobic base → build → taper and race |
| Half marathon | 26 | Restart → aerobic base → build → peak, taper and race |
| Marathon | 36 | Restart → aerobic base → build → marathon block → taper and race |

Quality sessions are fartlek, steady or race-pace reps and the **Norwegian 4×4** (four 4′ blocks at 85–95% of max HR with 3′ jogging, the classic VO₂max workout), only from phase 2 and never two hard days in a row.

Goal, intensity and days are set with a **step-by-step guide that opens inside the Plan tab** (the profile only has a shortcut to it) (goal → intensity → days → the coach's proposal): at every step the coach explains the choice, warns you honestly when it is not ideal and, before you confirm, shows a **preview of the new plan** (plan week, sessions S1, S2, S3…, estimated race date and tips). After that the plan adapts by itself. A new goal continues from the same phase of the new plan, starting from the current week: your history and the runs you already did stay.

### What you see in the app

- **Today:** next session, how you are today, last run, this week
- **Health:** resting HR, HRV, sleep, steps, BMI and more, plus the days with incomplete recovery in the last 30 days; each metric has a detail page with collapsible deep dives
- **Load and injuries:** three declared signals (recent vs usual load ACWR, weekly km jump, single-run jump over the month's longest); a warning on Today, a section in Progress, the next session lightened when ACWR goes above 1.5 and a cap for the next long run (+10%)
- **Data sources:** the profile shows where your data comes from — **Intervals.icu** (runs plus resting HR, HRV and sleep) and, when the instance has Strava keys, **Strava** (one tap, runs only) — with status, sync now and a step-by-step guide for each. Runs arriving from both, or uploaded twice to Intervals by two apps (e.g. Companion and Health Sync), are kept once (the one with more data), and activities deleted on Intervals disappear from AAC at the next sync; for Strava-only users AAC estimates load from heart rate so form and injury checks keep working. If runs reach Intervals only through Strava, the app warns you and offers both fixes
- **Install and notifications:** add AAC to your Home Screen (on iPhone: Safari → Share → Add to Home Screen) and turn on notifications in your profile: your session every morning at the time you choose (including when the coach lightens it) and a weekly recap on Sunday at 7 pm; an alert every time the coach changes something (the same entries as the coach's history); the administrator is also notified of every new access request. All notifications are on by default; the phone's permission is given with one tap. Standard Web Push, no app store; the VAPID keys are generated on first start and stored encrypted in `sistema.db` (nothing to add to `.env`)
- **Coach's take after every run:** as soon as a run is synced the coach sends a notification and adds a card to the run detail: planned vs done, heart-rate limit respected, efficiency vs recent runs, records, cardiac drift and one concrete improvement tip (cadence, opening pace, refuelling, sleep), based on stated principles (80/20, Heiderscheit 2011 on cadence, +10% rule). Rule-based, no external service.
- **Ask the coach:** a chat (speech-bubble icon in the header, also in the demo) that answers with your own data and the plan's rules: today's session and why it was lightened, your week, last run, heart-rate limit (Tanaka + Karvonen), pace and progress, goal date and predicted time, sleep and recovery, load and the +10% long-run rule, missed sessions, pain (safety first, never a diagnosis), nutrition, cadence, weather, shoes, and "what's not working". It understands free wording, two topics in one message ("I'm tired but I have intervals on Thursday") and follow-ups ("and tomorrow?"): `backend/capire.js` compares the meaning of the message with example phrases (`backend/chat-esempi.js`) using a small local embedding model ([multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small), MIT, quantized ONNX, ~120 MB, baked into the backend image with pinned checksums, run with `onnxruntime-node`, no network, telemetry off). The model only picks the topic and never writes text: answers are written templates in `backend/chat.js` filled with the signed-in user's data, so there is nothing to hallucinate or jailbreak. Safety topics (chest pain, internals, abuse) are matched by keywords first. The model loads on the first question (~2 s, ~300 MB RAM) and is released after 15 idle minutes; without it (e.g. local runs) the chat falls back to keywords. The message is never stored or logged; questions about internals or other users get a friendly redirect. Rate-limited to 30 messages per 5 minutes per user. `POST /api/coach/chat` (CSRF header required).
- **What the coach did:** a clock icon at the top opens the full history of the coach's interventions (weekly decisions, lightened sessions, intensity and frequency changes, load warnings, updated heart‑rate zones, notifications sent), each with its reason; every session also explains where its heart‑rate limit comes from
- **Plan:** calendar with every change explained; copy a finished session as Markdown to discuss it with any AI assistant; download the calendar (.ics); share a finished session as an image or as a **route video** (the 3D fly-over recorded on your device) for a post (4:5) or a story (9:16), drawn on your device in your accent colour on a background you pick (dark, theme colour, light and a few sporty tints), with the route shape (no map) or without it
- **Runs:** history, filters, shoes; **Play** your run as a full-screen 3D fly-over of the route on satellite imagery (camera follows you, live km/time/pace/HR, pause, drag to seek, Back closes it); run detail with satellite GPS map (Esri World Imagery), heart rate, pace, cadence, power, elevation, running dynamics, laps, effort (RPE) and weather
- **Progress:** goal, predictions, training load
- **Info:** how the coach follows you, starting from your own heart (max HR by Tanaka or measured, resting HR, your easy limit worked out with Karvonen on your numbers), then every rule in plain language

Light and dark theme, Italian and English, 26 sporty accent colours. Multi‑user with Google sign‑in, invitations and admin approval.

---

## Self‑hosting

AAC is open source (AGPL‑3.0) and free to run on your own server with Docker. **The complete guide lives in the documentation:**

- [Installation in six steps](https://docs.aac.run/en/self-hosting/install/) — requirements, Google sign‑in client, `.env`, HTTPS, first sign‑in
- [Configuration](https://docs.aac.run/en/self-hosting/configuration/) — every `.env` option
- [Backups and updates](https://docs.aac.run/en/self-hosting/backup-and-updates/) — everyday commands, verified nightly backups, restore, image verification

Quick start, if you already know Docker:

```bash
git clone https://github.com/airluke19/aac.git && cd aac
cp .env.example .env && chmod 600 .env     # fill in PUBLIC_URL, Google client, ADMIN_EMAIL, APP_SECRET
docker compose pull && docker compose up -d
```

Then put HTTPS in front of `127.0.0.1:3000` and sign in with your `ADMIN_EMAIL` account. Italian guide: [docs.aac.run/self-hosting/install](https://docs.aac.run/self-hosting/install/).

The documentation site itself is in [`docs/`](docs/) (Astro + Starlight): enable it with `COMPOSE_PROFILES=backup,docs` and `DOCS_PORT`.

---

## Under the hood

| Service | Image | Role |
|---|---|---|
| `frontend` | `ghcr.io/airluke19/aac-frontend` | nginx (unprivileged): serves the app and forwards `/api`, `/auth`, `/demo` to the backend. The app page is served only after the backend confirms the sign‑in. The only service published on the host. |
| `backend` | `ghcr.io/airluke19/aac-backend` | Node.js 22, Express, SQLite (better‑sqlite3), node‑cron: API, Google sign‑in, Intervals.icu and Strava sync, plan engine. Internal network only. |
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
- **Data:** Intervals.icu keys and Strava tokens encrypted with AES‑256‑GCM; session tokens stored only as SHA‑256 hashes; parameterised SQL; all dynamic HTML escaped; input checked against allow‑lists.
- **Browser:** strict Content‑Security‑Policy (no inline scripts, no `eval`, no CDN), HSTS, anti‑framing and the other security headers.
- **Containers:** non‑root, read‑only filesystem, no capabilities, `no-new-privileges`, memory and process limits; only the frontend is published, on `127.0.0.1` by default.
- **Supply chain:** `npm ci` with lockfiles, Actions pinned to commit SHAs, Dependabot. Every image carries its **SBOM** in the registry: SPDX from BuildKit plus a **signed** CycloneDX SBOM and signed SLSA provenance (Sigstore, GitHub attestations). Check them with `gh attestation verify oci://ghcr.io/airluke19/aac-backend:latest --owner airluke19` (provenance; add `--predicate-type https://cyclonedx.org/bom` for the SBOM) or read the SPDX with `docker buildx imagetools inspect ghcr.io/airluke19/aac-backend:latest --format '{{ json .SBOM }}'`; each build run also keeps the CycloneDX files as artifacts for 90 days. Trivy blocks releases with fixable HIGH/CRITICAL vulnerabilities, leaked secrets or misconfigurations.
- **Logging:** sign‑ins, blocked attempts and admin actions are logged; Docker logs are rotated.

Never commit `.env` or databases (`.gitignore` excludes them) and never expose the app without Google sign‑in. To report a vulnerability see [SECURITY.md](SECURITY.md).

---

## License

AAC is free software under the [GNU Affero General Public License v3.0](LICENSE) (AGPL‑3.0‑only). You can use, modify and self‑host it; if you offer a modified version as a network service, you must share its source code with its users under the same license.
