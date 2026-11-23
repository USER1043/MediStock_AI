# Setup, Testing and Deployment

> **TL;DR** — Either run the whole stack with Docker Compose (`docker compose --profile db up --build`, see [Docker](#docker)), or run MongoDB (Docker Compose or Atlas), create `server/.env` from `.env.example` (including **`FRONTEND_URL`**), start the API with `npm run dev` in `server/` and the SPA with `npm run dev` at the root. Create the first owner account by hand, then seed demo data. Tests use Jest (`cd server && npm test`). The SPA deploys to Vercel as a static site; the API runs on any Node 18+ host. Releases are automated with release-please.

---

## 1. Deployment view

```mermaid
flowchart LR
    dev(["Developer"]) -- "push to main" --> gh["GitHub"]
    gh --> rp["GitHub Action:<br/>release-please"]
    rp -- "release PR, tags,<br/>CHANGELOG.md" --> gh

    subgraph prod["Runtime"]
        vercel["Vercel<br/>static SPA + rewrites → index.html"]
        node["Node 18+ host<br/>server.js (Express)"]
        atlas[("MongoDB Atlas")]
        node --> atlas
    end

    gh -. "build: vite build" .-> vercel
    gh -. "deploy: npm start" .-> node
    browser(["Browser"]) --> vercel
    browser -- "VITE_API_BASE_URL" --> node
    node --> ext["Gemini · Twilio · Gmail SMTP"]

    subgraph local["Local development"]
        vite["vite dev server :5173"] --> api["nodemon server.js :5000"]
        api --> mongo[("docker compose --profile db<br/>mongo:7.0 on 127.0.0.1:27017")]
    end
```

The API host isn't pinned in the repo: nothing in it configures the backend's hosting. Any platform that runs `npm start` with the environment variables below will work (Render, Railway, a VM, a container).

---

## 2. Environment variables

### Backend — `server/.env`

| Variable | Required | Default | Purpose |
|----------|:--------:|---------|---------|
| `MONGODB_URI` | ✅ | — | Connection string. The process exits if the connection fails. |
| `JWT_SECRET` | ✅ | — | JWT signing key. Use a long random value. |
| `FRONTEND_URL` | ✅ | — | Comma-separated CORS allow-list. **The server crashes at start-up if unset** (`.split` on `undefined`). |
| `PORT` | | `5000` | API port |
| `NODE_ENV` | | — | `development` adds stack traces to errors; `test` skips `app.listen` |
| `JWT_EXPIRE` | | `7d` | Token lifetime |
| `GEMINI_API_KEY` | | — | Without it the chatbot always answers offline from the inventory (see [chatbot.md](chatbot.md#4-fallbacks-in-layers)) |
| `GEMINI_MODELS` | | `gemini-3.5-flash-lite,gemini-flash-lite-latest` | Comma-separated models to try in order; a busy, rate-limited or slow model moves to the next one |
| `GEMINI_API_URL` | | — | Older setting: replaces the endpoint of the first model. Prefer `GEMINI_MODELS` |
| `EMAIL_SERVICE` | | — | Nodemailer service name, e.g. `gmail` |
| `EMAIL_USER`, `EMAIL_PASSWORD` | | — | SMTP credentials (for Gmail, an **app password**) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER` | | — | WhatsApp notifications; skipped if missing |
| `OWNER_WHATSAPP_NUMBER` | | — | Receives GPay payment alerts |
| `MAX_UPLOAD_SIZE` | | `5242880` | Excel upload limit in bytes |

`server/.env.example` has all of these with setup notes for Gmail and the Twilio sandbox. It also lists `OWNER_EMAIL` and `UPLOAD_DIR`, which the code doesn't read.

### Frontend and Docker — root `.env`

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | API base, e.g. `http://localhost:5000/api`. **Set it**: the two axios clients have different fallbacks (5000 and 5002). |
| `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD` | Root credentials for the Docker Compose MongoDB (`db` profile). Default user `medistock`. The password goes into a connection string unescaped, so use letters, digits and `- _ . ~` only. |
| `JWT_SECRET`, `MONGODB_URI`, `FRONTEND_URL` | Used by the Docker backend container; see [Docker](#docker). `.env.example` at the root lists them. |

---

## 3. Local development

```bash
# 1. Install
npm install
cd server && npm install && cd ..

# 2. Database (or use an Atlas URI instead)
docker compose --profile db up -d mongodb   # only the database: mongo:7.0 on 127.0.0.1:27017

# 3. Configure
cp server/.env.example server/.env    # then edit: MONGODB_URI, JWT_SECRET, FRONTEND_URL
echo 'VITE_API_BASE_URL="http://localhost:5000/api"' >> .env

# 4. Run (two terminals)
cd server && npm run dev    # nodemon → http://localhost:5000  (health: /api/health)
npm run dev                 # vite    → http://localhost:5173
```

With the Docker database, `MONGODB_URI` needs the root credentials and `authSource`, e.g.
`mongodb://medistock:<password>@localhost:27017/medistock?authSource=admin`.

### Docker

`docker-compose.yml` builds and runs the whole stack:

| Service | Image | Port | Notes |
|---------|-------|------|-------|
| `frontend` | `Dockerfile` (root): Vite build served by nginx (`docker/nginx.conf`, SPA fallback to `index.html`) | `5173` | `VITE_API_BASE_URL` is a **build** argument (default `http://localhost:5000/api`); change it, then rebuild |
| `backend` | `server/Dockerfile`: `node:22-alpine`, production dependencies, runs as `node` | `5000` | Health check on `/api/health`. Reads the root `.env` (add `GEMINI_API_KEY`, `EMAIL_*`, `TWILIO_*` there if needed) |
| `mongodb` | `mongo:7.0`, data in the `mongodb_data` volume | `127.0.0.1:27017` | **Only with `--profile db`** |

```bash
cp .env.example .env    # set JWT_SECRET, and MONGO_ROOT_PASSWORD or MONGODB_URI

# Option 1: with a local MongoDB container
docker compose --profile db up --build -d

# Option 2: with your own MongoDB (e.g. Atlas): set MONGODB_URI in .env, then
docker compose up --build -d
```

The web app is on http://localhost:5173 and the API on http://localhost:5000/api. Without `MONGODB_URI`, the backend connects to the `db` profile's container. Started without that profile, it can't find a database and restarts until you set `MONGODB_URI` or add `--profile db`. A variable set in your shell overrides the one in `.env`.

Create the first owner and seed demo data inside the backend container:

```bash
docker compose exec backend node --input-type=module -e "
import mongoose from 'mongoose';
import { User } from './models/userModel.js';
await mongoose.connect(process.env.MONGODB_URI);
await User.create({ username: 'owner', email: 'owner@example.com', password: 'Change-me#1', role: 'owner' });
console.log('owner created'); process.exit(0);
"
docker compose exec backend node seedFiles/seedAll.js
```

Other commands: `docker compose logs -f backend`, `docker compose down` (stop; keeps the database volume), `docker compose --profile db down -v` (stop and **delete** the local database). The start-up banner prints the database URI with its username and password replaced by `***`.

### Create the first owner

`POST /api/auth/register` needs an existing owner, and the seed scripts expect users to exist already, so the first account has to be created directly. Run this from `server/` so the model's bcrypt hook hashes the password. The password must meet the [password policy](security.md#passwords) (8+ characters and at most 72 bytes, with a lowercase letter, an uppercase letter, a number and a symbol), or `User.create` throws a `ValidationError`:

```bash
node --input-type=module -e "
import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from './models/userModel.js';
await mongoose.connect(process.env.MONGODB_URI);
await User.create({ username: 'owner', email: 'owner@example.com', password: 'Change-me#1', role: 'owner' });
console.log('owner created'); process.exit(0);
"
```

Then log in and create staff users from **User Management**.

### Seed demo data

| Script | Command | What it does |
|--------|---------|--------------|
| `seedFiles/seedAll.js` | `npm run seed` | **Deletes** medicines, customers, bills, suppliers, history, audit logs, POs, alerts and reports, then generates a full demo dataset (30 days of billing volume, forecast history). Users are kept. |
| `seedFiles/seedTemporal.js` | `npm run seed:temporal` | Refreshes time-relative data (bills, sales history, audit logs, alerts, POs) so dashboards look current |

Never point the seed scripts at production: `seedAll` wipes collections.

### Maintenance scripts (`server/misc/`)

| Script | Purpose |
|--------|---------|
| `check-db.js` | Print collections and counts (hard-coded to `mongodb://localhost:27017/medistock`) |
| `migrate_categories.js` | One-off category migration |
| `diagnose_cast_error.js` | Debug helper for Mongoose cast errors |

---

## 4. Testing

```bash
cd server
npm test        # node --experimental-vm-modules jest (ESM); the whole suite, about 20 s
```

All backend tests live in `server/__tests__/` (`jest.config.js` matches only that folder). None of them uses `MONGODB_URI`: integration tests start their own MongoDB with `mongodb-memory-server` (a standalone server or a single-node replica set), so running them can never touch a real database. The first run downloads a `mongod` binary from `fastdl.mongodb.org` (or set `MONGOMS_SYSTEM_BINARY` to a local one). `__tests__/helpers/` holds a script one test runs in a child process; it is not a test.

| Area | Suites |
|------|--------|
| Auth and users | `auth.security`, `user.auth`, `passwordPolicy` |
| Billing and stock | `billing.integration`, `billing.concurrency` (load), `billing.rollback`, `orderNumbers`, `stockLevel`, `stockLevel.integration`, `returnDocument.integration` |
| Alerts and expiry | `alerts.expiry`, `alerts.integration`, `alerts.lifecycle` |
| Activity log | `audit.coverage`, `audit.integration`, `audit.redaction` |
| Forecasting and reorders | `forecast.drafts.integration`, `forecast.permissions`, `forecast.recommendations.permissions`, `forecast.recommendation.update`, `reorder.suggestions`, `accuracy` (LSTM on synthetic data) |
| Excel import, suppliers, customers | `upload.integration`, `excelImportSupplier.integration`, `medicineSupplier.integration`, `supplierRef`, `customers.api` |
| Seeds | `seed.timestamps` |

Files that keep a copy of a server file in the frontend (`stockLevel.js`, `passwordPolicy.js`) are checked against it in the matching suite.

**CI.** `.github/workflows/ci.yml` runs on every pull request and on pushes to `main`: `npm test` in `server/` (no secrets needed; `npm ci` downloads the `mongod` binary) and `npm run build` at the root.

**Load test.** `billing.concurrency.test.js` sends `CONCURRENCY_LOAD` concurrent requests per scenario (default 40) and logs how many got `201`, `409` and so on:

```bash
cd server
CONCURRENCY_LOAD=200 node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/billing.concurrency.test.js
```

**Gaps worth knowing:**

- There's no frontend test setup. Frontend behaviour is checked by hand or with a headless browser.
- `computeForecast` is covered through the forecast-run tests (cold-start path) and the LSTM accuracy test, not on its own.

---

## 5. Deployment

**Frontend (Vercel)**

- Build: `npm run build` → `dist/`.
- `vercel.json` rewrites every path to `/index.html` (SPA routing); `public/_redirects` does the same on Netlify.
- Set `VITE_API_BASE_URL` in the Vercel project settings. Vite inlines it at **build time**.

**Backend**

- `npm start` (`node server.js`) on Node 18+.
- Set every required variable from section 2. Add the deployed frontend origin to `FRONTEND_URL`.
- The process needs **write access** to `server/uploads/` (temp Excel files, invoice PDFs) and `server/logs/`. On platforms with ephemeral disks those files don't survive restarts.
- Health check path for the platform: `/api/health`.

**Database:** MongoDB Atlas. Allow the API host's egress IPs in the Atlas network access list.

---

## 6. Releases

- **release-please** (`.github/workflows/release-please.yml`) runs on every push to `main`.
- It's configured as a monorepo with two packages: `.` → `medistock-frontend` and `server` → `medistock-backend`, each with its own version (see `.release-please-manifest.json`) and `CHANGELOG.md`.
- Write **Conventional Commits** (`feat:`, `fix:`, `refactor(scope):`, `docs:`). release-please opens a release PR that bumps versions and updates changelogs; merging it creates the tags and GitHub releases.

---

## Known limitations

- The first-owner bootstrap is manual.
- CI runs tests and the frontend build, but there is no lint step.
- Local-disk state (`uploads/`, `logs/`) doesn't suit horizontally scaled or ephemeral hosts.
- The root `README.md` clone URL points to `kanishmanickam/Fullstack_Pharma_project`, and its env section omits `FRONTEND_URL`.

## Future improvements

- A `seed:admin` script (or an env-driven bootstrap) that creates the first owner.
- A lint step (ESLint) in CI.
- Object storage (S3/GCS) for generated PDFs; stdout-only logging, collected by the platform.

---

## Related files

`server/.env.example` · `.env.example` · `docker-compose.yml` · `Dockerfile` · `server/Dockerfile` · `docker/nginx.conf` · `vercel.json` · `public/_redirects` · `server/package.json` · `server/jest.config.js` · `server/seedFiles/` · `.github/workflows/ci.yml` · `.github/workflows/release-please.yml` · `release-please-config.json`
