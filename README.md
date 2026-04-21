# The Resource Room

CAPS-aligned teaching-resource generator for South African Grades 4–7.
Teachers pick a grade, term, subject and resource type; the app returns a
downloadable DOCX (question paper + memorandum) and an optional Teacha
marketplace listing.

Powered by Claude Sonnet 4.6, built on Node/Express, deployed on Railway.

---

## Quick start (local)

Requirements: Node 20–22.

```bash
git clone <this-repo>
cd resource-room-agent
cp .env.example .env          # then edit .env and set ANTHROPIC_API_KEY
npm install
npm start
```

Open <http://localhost:3000>.

---

## Environment variables

See `.env.example` for the canonical list.

| Variable | Required | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Anthropic API key used by every generation call. |
| `PORT` | no | HTTP port (Railway sets this; default `3000` locally). |
| `ALLOWED_ORIGINS` | no | Comma-separated allowlist of cross-origin domains. Leave empty for same-origin only. |
| `TEST_SECRET` | no | If set, `/api/test?secret=<value>` returns an Anthropic health check; otherwise the endpoint 404s. |

---

## Project layout

```
server.js            Express boot, CORS, rate limits, SPA fallback
api/generate.js      Main generation pipeline (plan → write → verify → DOCX)
api/refine.js        Single-shot edit on an already-generated resource
api/cover.js         Teacha marketplace product-listing generator
api/test.js          Anthropic health check (secret-gated)
public/index.html    Single-file vanilla-JS frontend
data/ (future)       ATP topic database (currently inline in generate.js)
```

---

## API surface

All endpoints return JSON. Rate-limited per IP: 5/minute, 20/hour, 100/day.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/generate` | Generate a CAPS-aligned resource pack (DOCX + preview). |
| POST | `/api/refine` | Apply one refinement instruction to an existing resource. |
| POST | `/api/cover` | Generate a Teacha product listing. |
| GET  | `/api/test`  | Secret-gated Anthropic connectivity check. |
| GET  | `/health`    | Unauthenticated 200 for Railway health checks. |

---

## Deployment (Railway)

1. New project → deploy from this repo.
2. Add the variables from `.env.example` in Railway → Variables.
3. `ANTHROPIC_API_KEY` is the only one that must be set; the rest are optional.
4. The health check path is `/health` (already configured in `railway.json`).

---

## Development notes

- Node 20–22 required (`engines` field).
- No build step — the frontend is static HTML.
- `package-lock.json` is committed; reproducible builds via `npm ci`.
- No test suite yet (planned for Phase 1).
- The ATP topic database currently lives inline in `api/generate.js` and is
  duplicated in `public/index.html`; consolidating to a single JSON file is
  a Phase 1 task.

---

## License

Proprietary. © The Resource Room.
