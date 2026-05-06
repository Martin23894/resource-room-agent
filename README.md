# The Resource Room

CAPS-aligned teaching-resource generator for South African Grades 4–7.
Teachers pick a grade, term, subject, and resource type; the app returns
downloadable artefacts grounded in the DBE Annual Teaching Plan: question
papers + memos as DOCX, plus full lessons as DOCX + PowerPoint (single
lessons *or* a complete unit's worth of lessons in one click).

Powered by Claude Sonnet 4.6 via the Anthropic tool API. Built on
Node/Express with SQLite for auth + per-user state. Deployed on Railway.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Quick start](#quick-start)
3. [Environment variables](#environment-variables)
4. [Production email setup](#production-email-setup)
5. [Operational status](#operational-status)
6. [Public pages + routing](#public-pages--routing)
7. [Auth + accounts](#auth--accounts)
8. [Frontend UX patterns](#frontend-ux-patterns)
9. [Resource types](#resource-types)
10. [The Lesson generator](#the-lesson-generator) ← deepest section, read this when touching Lessons
    1. [Single lesson + Subtopic picker](#single-lesson--subtopic-picker)
    2. [Lesson series generator](#lesson-series-generator)
    3. [Visual identity (kid-mode)](#visual-identity-kid-mode)
11. [Architecture](#architecture)
12. [Project layout](#project-layout)
13. [API surface](#api-surface)
14. [Schema overview](#schema-overview)
15. [CAPS data files](#caps-data-files)
16. [Frontend cascade](#frontend-cascade)
17. [Testing](#testing)
18. [Deployment](#deployment)
19. [Bugs we've hit + how to debug](#bugs-weve-hit--how-to-debug)
20. [Glossary](#glossary)

---

## What it does

A teacher creates an account at `/`, verifies their email, fills in a
short profile (name, school, grades they teach), then lands on `/app`.
From there they pick `grade × term × subject × resource type × language
× marks × difficulty`, and click Generate. The app:

1. Looks up the relevant ATP topics + rich pacing data (concepts, prerequisites, CAPS strands, formal-assessment splits) from `data/atp.json` + `data/atp-pacing.json`.
2. Asks Claude Sonnet 4.6 (one forced tool call) to fill a strict JSON schema (`schema/resource.schema.js`) covering meta, cover, stimuli, sections, leaf questions, matched memo, and (for Lessons) a teacher-facing `lesson` branch.
3. Validates → rebalances marks → renders DOCX via `lib/render.js`. For Lessons, also renders PowerPoint via `lib/pptx-builder.js`.
4. Returns a payload with base64 DOCX (always), base64 PPTX (Lessons only), text preview, and verification metadata.

The public marketing surface (`/`, `/privacy`, `/terms`, `/help`) and
the authenticated app (`/app`, `/app/*`) are split — see [Public pages
+ routing](#public-pages--routing). Both are vanilla HTML/JS, no build
step.

---

## Quick start

Requirements: **Node 20–22**.

```bash
git clone <this-repo>
cd resource-room-agent
cp .env.example .env          # then edit .env and set ANTHROPIC_API_KEY
npm install
npm start
```

Open <http://localhost:3000>:

- `/` — public landing page with a sign-in / sign-up form.
- `/app` — the resource generator (gated behind sign-in).

Create an account: enter an email + a password (≥10 chars). In dev
(`EMAIL_PROVIDER=console`, the default) the verification email body is
logged to stdout — copy the verify link into your browser to confirm.
The app works while you're unverified; verifying just lets you reset
your password later.

Run the test suite:

```bash
npm test          # 628 tests, ~32s, all node:test — no Anthropic API calls
```

---

## Environment variables

See `.env.example` for the canonical list.

| Variable | Required | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Anthropic API key used by every generation call. |
| `PORT` | no | HTTP port (Railway sets this; default `3000` locally). |
| `ALLOWED_ORIGINS` | no | Comma-separated allowlist of cross-origin domains. Leave empty for same-origin only. |
| `TEST_SECRET` | no | If set, `/api/test?secret=<value>` returns an Anthropic health check; otherwise the endpoint 404s. |
| `CACHE_DB_PATH` | no | SQLite file for the result cache. Default `./data/cache.db`. On Railway, point this at a mounted volume so the cache survives deploys. |
| `CACHE_TTL_SECONDS` | no | How long a cached `/api/generate` response is served. Default `604800` (7 days). `0` means never expire. The cache key is versioned (`gen:v6:`) so a code change that affects response shape can be invalidated by bumping the prefix; otherwise repeat requests for popular cells (Maths Gr 6 T2 Test 50 marks etc.) come back free. |
| `AUTH_SECRET` | **prod only** | HMAC key for signing session cookies. Required when `NODE_ENV=production`. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `APP_URL` | prod recommended | Base URL for magic-link verification (e.g. `https://resource-room.up.railway.app`). Leave blank for local dev — links become relative. |
| `EMAIL_PROVIDER` | no | `console` (logs to stdout — dev default), `resend` (Resend API), or `disabled`. |
| `RESEND_API_KEY` | if `EMAIL_PROVIDER=resend` | API key from <https://resend.com/api-keys>. |
| `EMAIL_FROM` | prod recommended | Sender address (e.g. `The Resource Room <no-reply@yourdomain.com>`). Must be on a domain you've verified in Resend — see [Production email setup](#production-email-setup). Without it, Resend falls back to its rate-limited sandbox sender and the server logs a startup warning. |
| `EMAIL_REPLY_TO` | no | Address teachers reach when they reply to a sign-in / password-reset email. Defaults to `EMAIL_FROM`. |
| `SENTRY_DSN` | prod recommended | Server-side error tracking. Unset → errors log via pino but don't aggregate. See [Operational status](#operational-status). |
| `SENTRY_RELEASE` | no | Release identifier for grouping errors by deploy (e.g. `${RAILWAY_GIT_COMMIT_SHA}`). |
| `PLAUSIBLE_DOMAIN` | no | Domain registered on Plausible (e.g. `theresourceroom.co.za`). When set, every public HTML page loads the Plausible script. POPIA / GDPR safe out of the box, no cookie banner needed. |
| `HEALTH_STATUS_SECRET` | prod recommended | Guards `GET /health/status`. Without this, the operational status endpoint is open. |
| `STRIPE_SECRET_KEY` | for billing | Stripe secret key. Required when checkout/portal endpoints are exercised. |
| `STRIPE_WEBHOOK_SECRET` | for billing | Stripe webhook-signature secret used by `/api/stripe/webhook`. |

---

## Production email setup

Sign-in, password reset and email verification all go through this. If
the sending domain isn't authenticated, Gmail/Outlook will silently
spam-fold or reject — and teachers will think the app is broken without
ever telling you.

The server logs a conspicuous warning at boot if `EMAIL_PROVIDER=resend`
but `EMAIL_FROM` is unset / pointing at the Resend sandbox, so check
your logs after the first deploy.

Setup checklist (one-time, ~30 minutes including DNS propagation):

1. **Add your domain in Resend.** Sign in to <https://resend.com>,
   open Domains → Add Domain, enter your sending domain
   (e.g. `theresourceroom.co.za`).
2. **Add the DNS records.** Resend will give you four records:
   - **SPF** (`TXT @`) — tells receiving servers Resend is allowed to
     send on your behalf.
   - **DKIM** (two `TXT` records, often on a subdomain like
     `resend._domainkey`) — cryptographic signature on every email.
   - **DMARC** (`TXT _dmarc`) — `v=DMARC1; p=quarantine;` is a sensible
     default. Tighten to `p=reject` once you're confident.
   Paste these into your DNS provider (Cloudflare, Route53, Namecheap…).
3. **Wait for verification.** Resend marks the domain "Verified" once
   the records propagate. Usually < 30 min, sometimes a few hours.
4. **Disable click + open tracking** for the domain in Resend
   (Domains → your domain → Tracking). Click-tracking rewrites our
   sign-in URLs through a Resend redirect — Gmail's "Safe Links"
   pre-fetches that wrapped URL and consumes the token before the
   teacher clicks it. Open-tracking adds an invisible image which
   trips spam filters on fresh sending domains.
5. **Set the env vars** in your deploy environment (Railway → Variables):
   ```
   EMAIL_PROVIDER=resend
   RESEND_API_KEY=re_…
   EMAIL_FROM=The Resource Room <[email protected]>
   EMAIL_REPLY_TO=[email protected]
   ```
6. **Send yourself a test sign-in.** Use the forgot-password flow on a
   personal Gmail / Outlook account. If it lands in inbox (not spam), you're
   done. If it lands in spam, check the email's "Show original" → SPF /
   DKIM / DMARC should all say `PASS`.

Common pitfalls:
- **No DKIM** → Gmail will mark it as `dkim=none` and aggressively
  spam-folder. Adding it after the fact takes another 30-min wait.
- **DMARC `p=reject` before SPF/DKIM stabilise** → mails get rejected
  outright. Start with `p=quarantine`, escalate later.
- **EMAIL_FROM doesn't match the verified domain** → Resend rejects the
  send with a 403.

---

## Operational status

Three lightweight pieces of operational kit are wired up for production:

### Server-side error tracking — Sentry

When `SENTRY_DSN` is set, unhandled errors thrown by route handlers and
best-effort `captureException()` calls (in `lib/sentry.js`) are reported
to Sentry. Without the DSN, errors still log via pino — they just don't
aggregate into a dashboard.

Setup:

1. Sign up at <https://sentry.io>, create a Node project, copy the DSN
   from Settings → Projects → <project> → Client Keys.
2. Set `SENTRY_DSN=…` in Railway. Optionally set `SENTRY_RELEASE` to
   `${RAILWAY_GIT_COMMIT_SHA}` so errors are grouped by deploy.
3. Trigger a test error (e.g. visit a known-bad URL with `NODE_ENV=
   production`) and confirm it appears in Sentry.

What we *don't* do: performance / tracing (`tracesSampleRate=0`) and
client-side errors. Both are bigger commitments — revisit when there's
a specific question to answer.

### Privacy-friendly analytics — Plausible

When `PLAUSIBLE_DOMAIN` is set, every public HTML page (`/`, `/app`,
`/help`, `/privacy`, `/terms`, `/404`) loads
`https://plausible.io/js/script.js` with that domain attached. The
loader at `/_/analytics.js` decides at request-time based on the env
var, so there's nothing to rebuild when you flip it on.

Plausible:

- Doesn't use cookies → POPIA / GDPR compliant out of the box, no
  consent banner.
- Doesn't track personally-identifiable info.
- Charges per pageview (~$9/month for 10k views).

Setup: register your domain at <https://plausible.io>, then set
`PLAUSIBLE_DOMAIN=theresourceroom.co.za` in Railway.

### Health / status endpoint — `GET /health/status`

A single URL that runs five quick checks and returns a JSON snapshot:

```json
{
  "status": "ok" | "attention",
  "timestamp": "2026-01-01T00:00:00Z",
  "checks": {
    "database":  { "ok": true,  "info": "SQLite reachable" },
    "auth":      { "ok": true,  "info": "Cookie-signing secret configured" },
    "anthropic": { "ok": true,  "info": "Key configured" },
    "email":     { "ok": false, "info": "EMAIL_PROVIDER=console — emails are only logged" },
    "sentry":    { "ok": true,  "info": "Error tracking enabled" }
  }
}
```

`status: "ok"` only when every check is green — useful for at-a-glance
"is the deploy actually production-ready?" inspection. The endpoint
always returns HTTP 200 so a config issue (e.g. `EMAIL_FROM` unset)
doesn't trip an uptime monitor watching the basic `/health` ping.

In production set `HEALTH_STATUS_SECRET` and call the endpoint with
`?secret=…` — without the secret it 404s, hiding env-var presence
from the open internet.

The plain `/health` endpoint (no per-dependency detail, always returns
`{status:"ok"}`) stays unauthenticated and is what Railway probes.

---

## Public pages + routing

The site has two distinct surfaces. Anonymous traffic lands on the
public marketing pages; the resource generator lives behind sign-in
at `/app`.

| Path | What it is | Source file |
|---|---|---|
| `/` | Landing page — hero, features, sign-in/sign-up form, CTAs | `public/landing.html` |
| `/app` (and `/app/*`) | Authenticated SPA — the resource generator. Auth gate inside the page redirects unsigned-in visitors to a login modal | `public/index.html` |
| `/help` | Help / FAQ — 21 collapsible items covering signup, sign-in, resource types, account, AI quality, privacy, billing | `public/help.html` |
| `/privacy` | POPIA-aware Privacy Policy (placeholder template, review with a SA legal advisor before launch) | `public/privacy.html` |
| `/terms` | Terms of Service (same template-status note) | `public/terms.html` |
| `/api/auth/verify`, `/api/auth/reset` | Email-verification + password-reset confirm pages — server-rendered HTML | `api/auth-verify.js`, `api/auth-reset.js` |
| Anything else | `404` page (`public/404.html`) — replaces the silent SPA fallback so broken inbound links are visible |

**SEO basics**: every page has an explicit `<title>`, `description`,
OpenGraph tags on the landing page, a `favicon.svg` and a `robots.txt`
that disallows `/api/` and `/app`.

---

## Auth + accounts

Email + password is the primary sign-in path, with passwordless magic
links kept only for two narrow flows: **email verification on signup**
(`purpose=verify`) and **password reset** (`purpose=reset`).

### The `users` table

Every signed-up teacher gets a `users` row. Schema is additive — new
columns are added via `ALTER TABLE` in `lib/cache.js` so older deploys
upgrade in place.

| Column | Purpose |
|---|---|
| `id` | UUID — PK |
| `email` | Unique, lower-cased on insert |
| `password_hash` | scrypt-encoded (`scrypt$N$r$p$salt$hash`); `null` for legacy magic-link-only users until they set a password via Forgot password |
| `email_verified_at` | unix-ms; `null` until they click the verify link |
| `created_at`, `last_login_at` | unix-ms timestamps |
| `display_name`, `school`, `role`, `province` | Profile text fields |
| `grades_taught`, `subjects_taught` | JSON arrays |
| `profile_completed_at` | unix-ms; `null` triggers the onboarding modal on next sign-in |
| `trial_ends_at` | unix-ms; set 14 days after signup |
| `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `subscription_tier`, `current_period_end` | Stripe state, populated by webhook |

### The `magic_links` table

| Column | Purpose |
|---|---|
| `token` | 32-byte hex — PK |
| `email` | Lower-cased recipient |
| `purpose` | `'verify'` (post-signup), `'reset'` (forgot-password), `'signin'` (legacy back-compat) |
| `expires_at` | unix-ms; tokens expire 15 min after creation |
| `used_at` | unix-ms; nulled until consumed |

`peekMagicLink` / `consumeMagicLink` accept an `expectedPurpose` so a
stolen reset link can't be confirmed against the verify route.

### Password hashing — `lib/password.js`

Uses Node-built-in `crypto.scrypt` (no native dependency).
`N=16384`, `r=8`, `p=1`, 16-byte salt, 64-byte derived key,
`timingSafeEqual` for compare. Minimum length 10, whitespace-only
rejected. Malformed encoded hashes return `false` rather than throw.

### Sessions — `lib/auth.js`

- 32-byte hex session id, 30-day TTL.
- HMAC-signed cookie (`rr_session`) using `AUTH_SECRET`.
- `parseSession` middleware decodes the cookie on every request and
  sets `req.user`. `requireAuth` 401s anonymous requests.
- Password reset and account deletion both call
  `deleteAllSessionsForUser(userId)` so a stolen device cookie stops
  working immediately.

### Sign-up / sign-in flow

```
Landing page → tabbed form (Sign in / Create account / Forgot password)
   │
   ├─ Sign up:
   │   POST /api/auth/signup { email, password }
   │   → hash password with scrypt
   │   → create users row (email_verified_at = null)
   │   → send TWO emails:
   │       1. Verification link (purpose='verify')
   │       2. Welcome email (getting-started bullets, FAQ link)
   │   → mint session cookie immediately
   │   → 200 { ok:true, requiresVerification:true }
   │   → frontend redirects to /app
   │
   ├─ Sign in:
   │   POST /api/auth/signin { email, password }
   │   → returns the SAME 401 "Incorrect email or password" whether
   │     the email exists or not (no enumeration)
   │   → on success mints session cookie, returns
   │     { ok:true, requiresVerification: !email_verified_at }
   │
   └─ Forgot password:
       POST /api/auth/forgot { email }
       → always 200 (no enumeration); only emails when account exists
       → reset link points at GET /api/auth/reset?token=…
       → POST /api/auth/reset { token, password } applies the new hash,
         marks email verified (the token proves inbox control), drops
         every other session, mints a fresh session, redirects to /app

Anywhere in the app:
   POST /api/auth/resend-verification
   → re-sends the verification email; auth-gated
   → no-op (returns alreadyVerified=true) if email is already verified
```

### Onboarding + profile

After the first successful sign-in, the SPA reads `profile.complete`
from `/api/auth/me` and pops a blocking onboarding modal asking for
display name (required), school, role, province, and grades taught.
The "Account" button in the user chip reopens the same modal for
edits.

`GET/PUT /api/user/profile` is the underlying CRUD. Validation:
display name required, grades restricted to 4–7, province must be
one of the 9 SA provinces or empty, all text capped at 200 chars,
subjects capped at 20.

### Account deletion (POPIA right-to-erasure)

The Account modal's **Danger zone** lets a teacher type their email
to confirm, then `DELETE /api/user/account` runs `deleteUserCascade`
in a SQLite transaction:

- `users` row deleted (cascades to `sessions`, `user_settings`,
  `user_history` via `ON DELETE CASCADE`)
- `magic_links` for that email deleted explicitly (no FK to users)
- Session cookie cleared on the response

A confirmation email is sent **before** the row is removed so the
teacher has an audit trail even if email is flaky. External state
(Stripe customer records, log retention) is out of scope — handle
that in the relevant dashboard.

### Rate limits

- Email-sending endpoints (`/signup`, `/forgot`, `/resend-verification`):
  3/min, 10/hr per IP — slow enough to stop a hostile actor flooding
  someone's inbox without nuking a legit retry.
- Password-checking endpoints (`/signin`, `/reset` POST): 10/min,
  60/hr per IP — generous on legit retries while throttling
  credential-stuffing.
- Claude-backed endpoints (`/generate`, `/refine`, `/cover`,
  `/rebuild-docx`): 10/min, 50/hr, 200/day **per user** (keyed on
  `req.user.id`), so a school sharing one IP doesn't share a bucket.

---

## Frontend UX patterns

A few small conventions worth knowing about before touching
`public/index.html`:

### Toasts replace alert()

`showToast(message, kind, opts?)` with shorthand `showError`,
`showSuccess`, `showInfo`. Slides in from top-right, auto-dismisses
after 5s (6.5s for errors), user can hit × earlier. ARIA roles
(`alert` for errors, `status` for the rest) so screen readers behave.
Toasts stack vertically.

There are **zero `alert()` calls** in `public/index.html` — every
error / success path uses a toast. The blocking semantics aren't
load-bearing because every legacy `alert()` was followed by `return;`
which already short-circuited control flow.

### Banners

| Banner | Purpose | Source of truth |
|---|---|---|
| `#beta-banner` | Light-green "🌱 You're testing" prompt, dismissible × | `localStorage["rr.betaBannerDismissed"]` |
| `#verify-banner` | Amber "Please verify your email" with a Resend button | Shown when `/api/auth/me` returns `emailVerified: false` |

Both sit between the header and the layout.

### Report a problem

The user chip has a "Report a problem" button. `openReportProblem()`
opens a `mailto:` to the support address with a pre-filled body
containing browser, current cascade selection (grade/term/subject/
topic/resourceType/language), window size, URL and ISO timestamp —
so the teacher only has to describe what went wrong.

The beta banner's "Tell us about it" link wires to the same function.

### Auth gate

`public/index.html` itself contains a blocking dialog (`.auth-gate`)
that's visible until `/api/auth/me` returns 200. The gate has tabs:

- **Sign in** (primary) — email + password
- **Create account** — email + password + confirm
- **Forgot password?** — email-only

`fetchAuthed()` wraps every API call: a 401 from any endpoint flips
the gate back on and the user re-authenticates without a reload.

---

## Resource types

The `resourceType` field on a generation request determines what the model produces and how it's rendered. All types share the same `schema/resource.schema.js` core (meta + cover + stimuli + sections + memo); Lessons additionally populate a `lesson` branch.

| `resourceType` | Output | Marks (typical) | Notes |
|---|---|---|---|
| `Worksheet` | DOCX | 10–30 | Single-section practice instrument |
| `Test` | DOCX | 30–75 | Term-scoped, 2–4 sections |
| `Exam` | DOCX | 50–100 | T2/T4 cover prior term per CAPS |
| `Final Exam` | DOCX | 80–150 | Full-year scope |
| `Investigation` | DOCX | 30–50 | Investigative methods |
| `Project` | DOCX | 50–80 | Multi-stage |
| `Practical` | DOCX | 30–50 | Hands-on |
| `Assignment` | DOCX | 30–50 | Take-home |
| **`Lesson`** | **DOCX + PPTX** | 10–30 worksheet marks | Teacher-facing lesson plan + learner worksheet + slide deck |

**Exam scope rule** (CAPS):
- T1 / T3 assessments → that term only
- T2 exam → T1 + T2 content
- T4 exam → T3 + T4 content
- Final Exam → all four terms

---

## The Lesson generator

The Lesson generator is the most complex resource type. It produces three artefacts from one schema-validated Resource:

1. **Lesson plan** (teacher-facing) — DOCX
2. **Slide deck** (learner-facing) — PowerPoint
3. **Worksheet + memo** (learner-facing, embedded inside the lesson DOCX) — DOCX

Because all three come from a single Claude tool call against a single schema, the slides, lesson plan, and worksheet are **structurally guaranteed to teach and test the same concepts** — that's the unfair advantage no template-based competitor can match.

There are **two ways to use it**:

- **Single lesson** (default) — one /api/generate call → one Lesson artefact-pack.
- **Lesson series** (one-click upsell) — N /api/generate calls orchestrated client-side, one per top-level subtopic of the chosen Unit, each aware of which subtopics came before. Same per-call cost as N separate generations; the convenience is the win.

### Data flow

```
Frontend                                Backend
────────                                ───────
 1. Cascade fills Subject, Grade, Term
 2. User selects "Lesson plan + worksheet" resourceType
 3. Topic dropdown swaps to a CAPS Unit picker:
      GET /api/pacing-units?subject=…&grade=…&term=…
      → slim Unit list (id, topic, weeks, hours,
        subtopicHeadings[]) from data/atp-pacing.json
 4. User picks a Unit and lesson length. The Subtopic
    dropdown populates from the chosen Unit's
    subtopicHeadings[] (data-subtopics on each option).
    The Series upsell ("Generate full unit series")
    appears for Units with 2+ subtopics, disabled with
    a hint for single-subtopic Units.
 5a. Single lesson: POST /api/generate, SSE accept,
     body { ..., unitId, lessonMinutes, subtopicHeading? }
 5b. Series:        modal confirms N subtopics → frontend
     orchestrator POSTs N times, JSON accept, body
     { ..., unitId, lessonMinutes, subtopicHeading,
       seriesContext: { position, total, priorSubtopics } }
                                        │
                                        ▼
                            ┌── api/generate.js ──┐
                            │                      │
                            │ 1. parseRequest      │  ← extracts unitId,
                            │                      │     lessonMinutes,
                            │                      │     subtopicHeading,
                            │                      │     seriesContext
                            │ 2. buildContext      │  ← lib/atp.js
                            │    (loads Unit;      │     getPacingUnitById()
                            │     resolves         │     findUnitSubtopic()
                            │     subtopic;        │
                            │     locks topics to  │
                            │     unit.topic)      │
                            │ 3. narrowSchema      │  ← schema/resource.schema.js
                            │    (adds 'lesson'    │     narrowSchemaForRequest()
                            │     to required[])   │
                            │ 4. buildSystemPrompt │  ← lib/atp-prompt.js
                            │    + buildLesson     │     buildLessonContextBlock(
                            │      ContextBlock    │       unit, mins, lang,
                            │                      │       subtopic?, seriesCtx?)
                            │ 5. callAnthropicTool │  → Claude Sonnet 4.6
                            │    (24k maxTokens)   │
                            │ 6. unwrapStringified │  ← see "Bugs we've hit"
                            │      Branches        │
                            │ 7. assertResource    │  ← schema/resource.schema.js
                            │    (lenient on       │
                            │     worksheetRef +   │
                            │     title slide)     │
                            │ 8. renderResource    │  ← lib/render.js
                            │    → DOCX            │
                            │ 9. renderLessonPptx  │  ← lib/pptx-builder.js
                            │    → PPTX (Lesson    │
                            │     only)            │
                            │ 10. Stream SSE       │
                            │     phases + result  │
                            │     (single mode)    │
                            │     OR JSON res      │
                            │     (series mode)    │
                            └──────────────────────┘
```

### Single lesson + Subtopic picker

The default mode produces ONE lesson at the chosen length. Without a subtopic chosen, the model sees the Unit's full concept tree and picks ~45 minutes of it on its own — fine for a Unit with one subtopic but causes overlapping "introduction" lessons across multiple generations of a multi-subtopic Unit.

To narrow that, the **Subtopic picker** lets the teacher pick one of the Unit's top-level subtopic headings. When set, the generator pipeline:

- Loads the matching subtopic via `findUnitSubtopic(unit, heading)` and stashes `lessonSubtopic` on `ctx`.
- `buildLessonContextBlock` emits a `### Subtopic focus` block listing the subtopic's `concepts[]` verbatim and tells the model NOT to cover other subtopics of the Unit.
- The model's `capsAnchor.subStrand` is pinned to the subtopic heading, so the rendered lesson plan header reads *"CAPS Anchor: Number Sentences / Solving by inspection"* — the teacher knows exactly which slice of the Unit this lesson covers.
- Cache key includes `subtopicHeading` so two subtopic-focused variants of the same Unit don't collide.

Single-subtopic Units (e.g. NUMBER SENTENCES Gr 6 T2 in the 2023-24 ATP, captured as one subtopic block in `data/atp-pacing.json`) keep the picker visible but disabled, with helper text *"CAPS doesn't break this Unit into named subtopics — generate it as a single Whole-unit lesson."*

### Lesson series generator

The series generator stitches N single-lesson calls into one coherent flow. This is the **hybrid model**: each lesson in the series is a normal billable /api/generate call (so the existing rate limiter, Stripe credits, and result cache all apply per-lesson), but coordinated so each lesson knows what came before.

**Frontend orchestrator** (`generateSeries`, `callGenerateOnceWithRetry`, `renderSeriesProgress` in `public/index.html`):

- The "Generate full unit series" button shows only when the Unit has 2+ subtopics. For single-subtopic Units it's visible but disabled with a tooltip.
- Confirmation modal lists the planned subtopics, total minutes, and cost ("8 generations · same as separate") — no discount, no surprise.
- The orchestrator iterates `subtopicHeadings[]` in order. Each iteration POSTs to `/api/generate` (JSON mode, not SSE) with:
  ```jsonc
  { ...standard fields,
    subtopicHeading: "<this iteration's heading>",
    seriesContext: {
      position: <1-indexed>,
      total: <N>,
      priorSubtopics: [<all earlier headings>]
    } }
  ```
- Calls are paced **8s** between non-cache hits to stay under the server's 10/min rate limit (~7.5 calls/min, safe headroom). Cache hits skip the pacing.
- A per-lesson **auto-retry layer** (`callGenerateOnceWithRetry`) handles transient failures invisibly:
  - 429 → wait `Retry-After` / `RateLimit-Reset` (capped 90s, default 30s)
  - 5xx → exponential 2s → 4s → 8s with small jitter
  - Network errors (`fetch failed`, `ECONN`, `ETIMEDOUT`) → same exponential
  - 4xx-but-not-429 → terminal, surface immediately
  - 3 attempts max per lesson; the wait is split into 1s chunks so a user-cancelled series doesn't sit waiting 60s.

**UI**:

- Progress strip: *"Generating lesson 3 of 8…"* → flips to *"Lesson 3 of 8 — retrying (attempt 2 of 3) — waiting 12s before next attempt — Too many requests"* during a transient retry.
- Per-lesson rows show Pending / Ready / Failed badges and individual ⬇ Word + ⬇ PowerPoint download buttons as each completes. A `(cached)` tag appears next to lessons served from the result cache.
- Failed rows render the actual error message inline (red, wrapped under the row) plus a per-row **↻ Retry** button.
- Bulk download via JSZip (already a dep): "Download all (ZIP)" packages every completed lesson's DOCX + PPTX with stable `01-subtopic-name.docx` filenames.

**Resume & retry**:

- `resumeSeries()` (toolbar button when the series has stopped mid-way) re-invokes the orchestrator from `failedAt`. Already-completed lessons hit the cache and re-serve free; only the failed one + remaining ones spend new credits.
- `retrySeriesLesson(idx)` (per-row button) retries a single lesson without restarting the whole series. Same cache mechanics.

**Backend additions for series**:

- `parseSeriesContext(input)` validates the optional payload (position/total ints, `priorSubtopics[]` capped at 30 entries × 500 chars). Anything malformed → `null` (graceful fallback to single-lesson behaviour).
- `buildLessonContextBlock(unit, mins, lang, subtopic?, seriesContext?)` adds a `### Series context` block when seriesContext is present:
  - First lesson (`position === 1`): *"This is the FIRST lesson — treat as the Unit's opener; don't assume prior Unit-specific knowledge"*
  - Mid-series: lists prior subtopics verbatim + *"BUILD ON those prior lessons; do NOT re-teach"*
  - Last lesson: *"This is the LAST lesson — its Consolidation phase should also serve as a brief recap of the whole Unit"*
- `buildCacheKey` (now `gen:v6:`) includes `seriesPosition` + `seriesTotal` + `seriesPrior` (joined by `|`) so a mid-series lesson can't collide with a single-lesson cache entry. A 1-of-1 series collapses to the single-lesson key (a freebie cache win). The `v6` bump invalidates `v5` entries so Phase B's new layout variety can take effect cleanly.

### Console diagnostics

While a series runs, the browser console gets one log per step (open DevTools → Console):

```
[series] starting lesson 1/3: "Investigate and extend patterns"
[series] ✓ lesson 1/3 ready · 28401 chars docx, 18234 chars pptx
[series] pacing 8000ms before lesson 2/3
[series] starting lesson 2/3: "Input and output values"
[series] transient error on attempt 1/3: Too many requests... Retrying in 30s.
[series] ✓ lesson 2/3 ready (cached) · 28233 chars docx, 18102 chars pptx
[series] ✗ lesson 3/3 failed (after auto-retry): <message>
```

### What the lesson DOCX contains

In document order:

1. **Lesson plan front matter** (1–2 pages, teacher-facing)
   - Header: "THE RESOURCE ROOM" / "LESSON PLAN" / subject / grade-term
   - **CAPS Anchor** — unit topic, strand/sub-strand, week range, lesson length, source PDF + page citation
   - **Learning Objectives** — 3–5 "By the end of this lesson learners will be able to…"
   - **Prior Knowledge** — verbatim from Unit prerequisites
   - **Key Vocabulary** — term + learner-appropriate definition
   - **Materials** — physical resources the teacher needs
   - **Lesson Phases** — 5 phases in CAPS-conventional order (Introduction / Direct Teaching / Guided Practice / Independent Work / Consolidation), each with minute budget, teacher actions, learner actions, optional questions to ask. The phase that triggers the worksheet shows a green cue.
   - **Differentiation** — adaptations for below/onGrade/above learners
   - **Homework** — short follow-up task with estimated minutes
   - **Teacher Notes** — misconception-correction pairs and management tips
   - "LEARNER WORKSHEET — STARTS ON THE NEXT PAGE" cue
2. **Page break** → Worksheet (cover, instructions, sections, questions) — same renderer as a standalone Worksheet
3. **Page break** → Memorandum (answers + cognitive-level analysis table)

Phase names are localised: `Introduction / Direct Teaching / Guided Practice / Independent Work / Consolidation` (English) or `Inleiding / Direkte Onderrig / Begeleide Oefening / Onafhanklike Werk / Konsolidasie` (Afrikaans).

### Visual identity (kid-mode)

The Lesson worksheet (the learner-facing portion of the lesson DOCX) and the lesson PPTX use a softer, more playful visual language than the formal assessment renderer. This is a **Lesson-only** style — Tests, Exams, and standalone Worksheets keep the formal palette unchanged.

`lib/palette.js` exports `pickLessonStyle({ resourceType, grade })` which returns:

- `null` for non-Lesson resources (assessments stay on the legacy formal path),
- a **junior tier** (`gradeBand: 'junior'`) for Grade 4–5 — brighter accent rotation, rounder corners (radius 0.18), more decoration, mascot enabled,
- a **senior tier** (`gradeBand: 'senior'`) for Grade 6–7 — same warm palette, cleaner geometry (radius 0.10), less decoration, no mascot.

Both bands share a friendly display-font chain `Fredoka, Nunito, Calibri` for headings (body text stays Calibri). Machines without Fredoka degrade gracefully through the fallback chain.

**Worksheet kid-mode** (DOCX, `lib/render.js → buildLessonWorksheetContent`):

- Friendly cover headline — *"Time to practice"* / *"Tyd om te oefen"* — replaces the formal `WORKSHEET` block.
- Single-line `Name: ___ Date: ___` strip; no learner-info table; no instructions block.
- `SECTION A: PRACTICE` headings dropped — Lesson worksheets are usually one section anyway.
- Question numbers render as accent-coloured badges (run-level shading) cycling through the grade-band's accent rotation (`sun → coral → sky → mint` for junior).
- Answer lines are dotted bottom borders (`BorderStyle.DOTTED`) instead of solid underscore strings.
- Mark indicator becomes a soft *"5 pts"* pill (right-aligned shaded cell) instead of `[5]`.
- Self-assessment row at the end — three labelled face cells (Easy / OK / Tricky), accent-coloured, tied to `i18n.lesson.selfAssessFaces`.

**PPTX kid-mode** (`lib/pptx-builder.js`):

- Title slide: tinted background + rounded "hero card" with the lesson topic in big friendly type, accent strip, subtitle, plus a hero illustration on the right (junior: mascot, senior: subject icon).
- `objectives` layout: each objective in its own card row with an accent-coloured ✓ badge — replaces the bullet list.
- `vocabulary` layout: 2-column grid of term cards with accent-coloured top bands and definitions in the body — replaces the term/definition bullet list.
- Top accent bar uses `roundRect` on junior, `rect` on senior.
- Junior gets a thicker accent bar and more rounded chrome; senior is cleaner.

### Illustration library (Phase C)

`lib/illustrations/` is the source of every embedded illustration on a Lesson — hero on the worksheet cover, hero on the PPTX title slide, subject icon on the `yourTurn` slide, "Well done!" stamp on the `celebrate` slide and (junior only) the memo header.

```
lib/illustrations/
  index.js              Picker dispatcher: pickHero, pickIcon, pickStamp, illustrationToPng
  subject-icons.js      Per-subject SVG generators (calculator, book, flask, globe,
                        scroll, heart, compass, coins, gear, pencil) keyed off subject string
  mascot.js             Friendly geometric mascot SVG (waving pose) — junior band only
  stamps.js             "Well done!" / "Mooi gedoen!" celebration stamp SVG
```

**Determinism** — the picker is purely a function of `meta.subject` + `meta.grade` band. Same Lesson always picks the same illustrations; no model decision involved (no schema or prompt churn for Phase C).

**Per-grade-band routing**:

| Slot | Junior (Gr 4–5) | Senior (Gr 6–7) |
|---|---|---|
| Worksheet cover hero | Waving mascot | Subject icon |
| PPTX title slide hero | Waving mascot | Subject icon |
| PPTX `yourTurn` slide icon | Subject icon | Subject icon |
| PPTX `celebrate` slide | Stamp + recap | Text-only headline |
| DOCX memo header | Stamp under subtitle | (none) |

**Subject → icon mapping** (sub-string match against `meta.subject`):

| Subject pattern | Icon |
|---|---|
| `Mathematics` | calculator |
| `Natural Sciences` / `Technology` | flask |
| `History` | scroll |
| `Geography` | globe |
| `Home Language` / `Additional Language` / `English` / `Afrikaans` | book |
| `Life Skills` / `Life Orientation` | heart |
| `Economic` / `Management` | coins |
| (fallback) | pencil |

**Licensing** — every SVG in `lib/illustrations/` is hand-rolled from simple primitives (`<rect>`, `<circle>`, `<path>`) authored in this repo. Nothing is sourced from a third-party icon library, so there is no attribution requirement and no copyleft contamination on the generated DOCX/PPTX. Phase C v2 (a commissioned mascot set, ~$500–1,500 one-time) is the path if teacher feedback says the v1 geometric mascot feels too generic; the picker shape stays the same so swapping art is a one-PR change.

**Raster path** — same `rasterSvgToPng` from `lib/diagrams/raster.js`. Illustrations rasterise to PNG once at render time and embed via `docx ImageRun` / `pptxgen.addImage`. Failures fall back gracefully — text-only cover, placeholder shape on `yourTurn`, text-only `celebrate` — so a missing-fonts environment never breaks generation.

### Decorative photos — tried and rolled back

A Phase D iteration (commits up to `f471c98`) wired a per-subject stock-photo sidebar into the PPTX `concept` / `example` / `warmUp` slides, with a deterministic picker keyed off `meta.subject` + slide ordinal, a curation helper script, a GitHub Actions workflow that fetched candidates from Pexels / Unsplash, and ~46 hand-curated photos across 6 subject categories. **The whole feature was reverted** because the photos didn't pull their weight — they were visible decoration but never matched what a given lesson was actually discussing.

The user-facing requirement was *loose topic match* — e.g. a lesson on rusty nails should have a rusty-nail photo. That's not reliably achievable with stock-photo libraries:

- **Search-quality is content-dependent.** Common nouns ("rusty nail", "abacus", "globe") return decent results. CAPS topics like *"place value"*, *"improper fractions"*, *"compound sentences"*, *"trade winds"* return mediocre / wrong / no matches. Hit rate across the curriculum is ~30–50%.
- **Live API search at render time** would break our generation determinism, blow holes in the cache layer, and add a network-failure surface to PPTX rendering.
- **Per-subject category buckets** (the Phase D approach) gave each subject a generic photo pool — recognisable as "maths" or "geography" but never tied to the actual lesson content.

If this comes up again, the realistic paths are:

1. **Per-slide AI image generation** at PPTX render time (DALL-E / Imagen / similar). Adds ~$0.10–0.30 per lesson on top of Anthropic costs, the IP picture for commercial use is still grey, and it breaks our deterministic-cache contract. Probably the lowest-effort path technically but with real trade-offs.
2. **Commissioned illustration set indexed by CAPS topic** — a designer produces ~100–200 illustrations covering common Foundation/Intermediate/Senior phase topics, vendored into a `topic → illustration` map. Owned IP, perfectly on-brand, expensive (~$5–15K one-time), slow lead time. Phase C v2 is a smaller version of this for the mascot only.
3. **Hybrid** — vendor a small SA-relevant photo library *only for subject hero/title slides* (where decoration makes sense) and skip the per-concept-slide ambition entirely. This is closer to what the Phase C illustration library already does, just with photos.

The session that built and reverted Phase D is preserved in the git history if anyone wants to read the picker/workflow code instead of rebuilding from scratch — last green commit was `20627c5`, revert at `f471c98`.

### What the PowerPoint contains

5–15 slides driven by `lesson.slides[]`. Each slide has an `ordinal`, a `layout`, a `heading`, optional `bullets` (≤ 8), optional `speakerNotes` (rendered into the Notes pane), and an optional `stimulusRef`.

Layouts:

| Layout | Purpose | Renderer behaviour |
|---|---|---|
| `title` | Lesson opener | Tinted background + rounded hero card with the lesson topic in the friendly display font. Auto-applied to slide #1 if no slide declares this layout. |
| `objectives` | Learning goals | Per-objective check-card rows (accent-coloured ✓ badge + tinted text card), accent rotation across rows |
| `vocabulary` | Key terms (definition-rich) | 2-column grid of term cards with accent-coloured top bands and definitions in the body. Pulls from `lesson.vocabulary` when no bullets given. |
| `wordWall` | Key terms (punchy term-only grid) | 2×N / 3×N grid of solid accent-coloured term cards — definitions go in `speakerNotes`. Phase B. |
| `warmUp` | Playful opener | Tinted card + "WARM-UP" eyebrow + big question heading + optional 0–2 hint bullets + accent dot. Phase B. |
| `concept` | Direct teaching (exposition) | Heading bar + bullets |
| `example` | Worked example (flat) | Heading bar + bullets |
| `workedExample` | Worked example (step cards) | Vertically stacked numbered step cards — each bullet becomes a card with an accent-coloured circle badge. Phase B. |
| `thinkPairShare` | Discussion prompt | Question card + 1–3 sub-prompts + paired figure silhouettes + speech-bubble cue. Phase B. |
| `diagram` | Embedded chart | Renders `stimulusRef` via the SVG → PNG raster path used for DOCX |
| `practice` | "Now try the worksheet" (plain) | Heading bar + bullets |
| `yourTurn` | "Now try the worksheet" (kid-mode) | Bright tinted panel with action-style headline + bullet hints + accent icon placeholder (Phase C swaps in real subject art). Phase B. |
| `exitTicket` | Consolidation | Heading bar + bullets |
| `celebrate` | Closing well-done slide | Tinted background + scattered confetti shapes + big friendly headline + optional recap bullets. Phase B. |

Visual chrome (green accent bar at top — rounded on junior, square on senior; footer with subject/grade/term, "The Resource Room" caption) is applied to every slide. Diagram slides reuse `lib/diagrams/` (bar_graph / number_line / food_chain) so the SVG → PNG raster matches the DOCX output exactly.

Layout guidance in `buildLessonContextBlock` nudges the model to **use at least 3 different layouts beyond title/objectives/vocabulary** across the deck — a deck of 8 slides where 5 are `concept` is wrong and gets surfaced in prompt-level reviews.

### The `lesson` schema branch

Defined in `schema/resource.schema.js`:

```jsonc
"lesson": {
  "lessonMinutes": 45,                 // 20-120
  "capsAnchor": {                      // unit metadata
    "unitTopic": "Number Sentences",
    "capsStrand": "Patterns, Functions and Algebra",
    "subStrand": "Number Sentences",
    "weekRange": "Weeks 1-2",
    "sourcePdf": "2026_ATP_Mathematics_Grade 6.pdf",
    "sourcePage": 4
  },
  "learningObjectives": [...],         // 2-6 strings
  "priorKnowledge": [...],             // verbatim from Unit.prerequisites
  "vocabulary": [
    { "term": "expanded form",
      "definition": "Number written as the sum of its place values." }
  ],
  "materials": [...],
  "phases": [
    { "name": "Introduction",          // enum (EN + AF variants)
      "minutes": 5,                    // 1-60
      "teacherActions": [...],         // ≥1 string
      "learnerActions": [...],         // ≥1 string
      "questionsToAsk": [...],         // optional
      "worksheetRef": false }          // optional — see "Inference behaviour"
  ],
  "slides": [                          // 5-15 entries
    { "ordinal": 1,
      "layout": "title",               // see layout table above
      "heading": "Whole numbers",
      "bullets": [...],                // optional, ≤8
      "speakerNotes": "...",           // optional
      "stimulusRef": "bar-1" }         // required when layout='diagram'
  ],
  "differentiation": {
    "below":   [...],
    "onGrade": [...],
    "above":   [...]
  },
  "homework": { "description": "...", "estimatedMinutes": 10 },
  "teacherNotes": [...]
}
```

Required at the schema level: `lessonMinutes`, `capsAnchor`, `learningObjectives`, `phases`, `slides`. Required at runtime (assertResource):

- Phase minutes must sum within ±5 of `lessonMinutes`
- Slide ordinals must be unique
- At most one slide may have `layout: "title"` (zero is allowed; the renderer infers)
- Diagram slides must carry a `stimulusRef` that resolves to a `stimuli[]` entry

### Inference behaviour

Sonnet 4.6 reliably skips two specific fields no matter how loud the prompt shouts. Rather than failing the generation, the renderers infer:

1. **`worksheetRef`** — the DOCX renderer's `pickWorksheetPhaseIndex()` decides which phase gets the *"→ Learners complete the attached worksheet"* cue. Order of preference:
   1. Explicit `worksheetRef: true`
   2. Phase name match on `Independent Work` / `Onafhanklike Werk`
   3. Phase #4 (the prompt-prescribed slot)
2. **Title slide** — the PPTX renderer treats the lowest-ordinal slide as the title slide regardless of declared layout, when no slide explicitly declares `layout: "title"`.

These inferences are tested in `test/lesson.test.js`. If a future model becomes more compliant and starts emitting both fields explicitly, the renderers honour the explicit choice — the inference only kicks in as a fallback.

### How to add a Lesson resource type for a new subject

The frontend appends a "Lesson plan + worksheet" option to **every** subject/grade/term cascade in `loadResourceTypes()`. There is no per-subject config to maintain. Whether a given subject gets a usable Lesson depends on:

1. Subject is in `SUBJECTS` (intermediate or senior) — see `data/atp.json`
2. Subject + grade has rich pacing data in `data/atp-pacing.json` so the Unit picker has Units to choose from. Without pacing data, `/api/pacing-units` returns `{ units: [] }` and the frontend shows *"No CAPS units available"*.

To add pacing data for a subject not yet covered, run `scripts/extract-atp-pacing.js` against the relevant DBE PDF (kept in repo root). See `docs/atp-pacing-schema.md` for the pacing-data shape.

---

## Architecture

### One Claude tool call → schema-validated Resource → renderer

The pipeline does **not** ask the model to produce DOCX / markdown / preview text. It asks the model to fill a strict JSON Schema. The schema is the contract; everything downstream is mechanical:

```
request → narrow schema for this request →
  Claude tool call (forced) → unwrap stringified branches →
  snap topics to canonical → rebalance leaf marks →
  assertResource → render DOCX → render PPTX (Lessons) →
  cache the payload → stream result
```

### Key design rules (don't break these without thought)

1. **Every fact appears exactly once.** The model writes question stems; code derives section totals, paper totals, cog tables, breakdowns, closers, and i18n labels.
2. **Cross-references use ids, not text.** A comprehension question points to a passage by `stimulusRef: "passage-1"`, not by re-quoting it.
3. **Every question is leaf XOR composite.** Leaves carry `marks + cognitiveLevel + answerSpace`. Composites carry `subQuestions[]` and never `marks`. Composite totals are computed.
4. **Cog framework levels live in meta.** Each leaf's `cognitiveLevel` must be one of `meta.cognitiveFramework.levels[*].name`. Phantom levels are structurally impossible.
5. **Stimuli are first-class.** A passage that anchors comprehension and summary is the same stimulus referenced twice.
6. **Language is set at meta.language.** All localised strings are derived from `lib/i18n.js` — no per-call language overrides downstream.

### Schema-first vs runtime validator boundary

`schema/resource.schema.js` exports two things:

- `resourceSchema` — JSON Schema enforced by the **Anthropic tool API** before the tool call even returns. Use it for shape (required fields, enums, minItems, patterns).
- `assertResource(resource)` — runtime validator that catches **cross-field invariants** JSON Schema can't express cleanly: leaf-marks-sum-to-totalMarks, memo-covers-leaves-exactly, phase-minutes-sum-to-lessonMinutes, etc.

Live testing has shown Anthropic's tool API does **not** strictly enforce JSON Schema enums on string fields (the `topic` enum, for example, gets near-misses); we snap those back to canonical values in `snapTopicsToCanonical()` before validation.

### Retry + corrective feedback loop

When `assertResource` fails, the pipeline retries up to 2× (Final Exam: 0×, since it already eats most of the 5-min budget). Each retry includes the previous failure's error list in the user prompt, plus targeted remediation strings via `buildTargetedRemediation()` for known recurring failure patterns (mark-sum drift, phase-minute drift).

### Cache layer

`lib/cache.js` is a thin SQLite wrapper. The cache key is built in `api/generate.js`:

```
gen:v6:{"subject":"...","grade":4,"term":2,"language":"English","resourceType":"Lesson","totalMarks":10,"difficulty":"on","unitId":"MATH-6-2026-t2-u2","lessonMinutes":45,"subtopicHeading":"Solving by inspection","seriesPosition":3,"seriesTotal":8,"seriesPrior":"Number sentences|Solving for a variable"}
```

Lesson keys include `unitId`, `lessonMinutes`, `subtopicHeading`, and series fields (when present). For non-Lesson types those keys are omitted. A 1-of-1 series collapses to the same key as a single-lesson request — that's a deliberate freebie when teachers click "Generate series" on a Unit with one subtopic. Bumping the prefix (`v5` → `v6`) is the standard way to invalidate the entire cache when the response shape changes.

Cache version history:
- `v2` — pre-Lesson baseline
- `v3` — added `lesson` to top-level required[] for Lesson narrowing
- `v4` — added `subtopicHeading`
- `v5` — added `seriesPosition`, `seriesTotal`, `seriesPrior`
- `v6` — Phase B slide-layout variety (added `warmUp`, `wordWall`, `thinkPairShare`, `workedExample`, `yourTurn`, `celebrate` to `lessonSlide.layout` enum) (current)

Pass `{ fresh: true }` in the request body to bypass cache for one call. The series orchestrator's resume/retry paths rely on cache hits to re-serve completed lessons free of charge.

---

## Project layout

```
server.js                Express boot, CORS, rate limits, SPA fallback, all route mounts

api/                     Express handlers (one per route)
  generate.js              MAIN — schema-first generation pipeline (plan → write → verify → DOCX → PPTX)
  refine.js                Single-shot edit on an already-generated resource
  rebuild-docx.js          Re-render a DOCX from edited preview text (no Claude call)
  test.js                  Anthropic health check (secret-gated)
  atp.js                   GET /api/atp — returns the full ATP topic database (cached, ETag'd)
  pacing-units.js          GET /api/pacing-units?subject&grade&term — slim Unit list for the Lesson picker
  auth-signup.js           POST /api/auth/signup — email + password account creation, sends verify + welcome
  auth-signin.js           POST /api/auth/signin — email + password sign-in
  auth-forgot.js           POST /api/auth/forgot — send a password-reset link
  auth-reset.js            GET/POST /api/auth/reset — set a new password
  auth-verify.js           GET/POST /api/auth/verify — confirm an email-verification link
  auth-resend-verification.js  POST /api/auth/resend-verification — re-send the verification email
  auth-logout.js           POST /api/auth/logout — clear session cookie
  auth-me.js               GET /api/auth/me — return current user (incl. profile + emailVerified + hasPassword)
  user-settings.js         GET/PUT /api/user/settings
  user-profile.js          GET/PUT /api/user/profile — teacher profile (name, school, role, grades, province)
  user-history.js          GET/POST/DELETE /api/user/history[/:id]
  user-account.js          DELETE /api/user/account — POPIA right-to-erasure (cascade-deletes everything)
  health-status.js         GET /health/status — per-dependency operational snapshot, optional secret guard
  analytics-config.js      GET /_/analytics.js — Plausible loader (no-op when PLAUSIBLE_DOMAIN unset)
  billing-checkout.js      POST /api/billing/checkout — open Stripe Checkout
  billing-portal.js        POST /api/billing/portal — open Stripe Customer Portal
  stripe-webhook.js        POST /api/stripe/webhook — subscription state source-of-truth

lib/                     Pure-ish logic (no Express dependencies)
  anthropic.js             Anthropic SDK wrapper — retries, abort, prompt caching
  atp.js                   ATP topic database + pacing helpers (loaded from data/*.json at boot)
  atp-prompt.js            CAPS-pacing prompt-block builders (CAPS reference, lesson directives, …)
  auth.js                  User/session helpers, magic-link issuing/consuming with purpose, signed session cookies, requireAuth middleware, deleteUserCascade
  password.js              scrypt-based password hash + verify (Node-built-in, no native dep)
  health.js                Per-dependency status checks (database, auth, anthropic, email, sentry)
  sentry.js                Sentry server-side init + middleware + captureException helper
  billing.js               Stripe price/tier mapping, subscription state helpers
  cache.js                 SQLite-backed result cache + DB schema (users, sessions, magic_links, user_settings, user_history)
  clean-output.js          Legacy markdown/regex cleanup (mostly unused under v2 schema-first pipeline)
  cognitive.js             marksToTime(), getCogLevels(), largestRemainder() — cog-framework math
  diagrams/                SVG renderers for bar_graph / number_line / food_chain
    index.js                 Dispatcher
    bar_graph.js             Bar chart SVG
    number_line.js           Number line SVG
    food_chain.js            Trophic chain SVG
    silhouettes.js           Reusable organism silhouettes used by food_chain
    raster.js                SVG → PNG via @resvg/resvg-js (uses /fonts/Inter*.ttf for determinism)
  docx-builder.js          Legacy v1 DOCX builder (still used by api/rebuild-docx.js)
  email.js                 Email provider switch (console / Resend / disabled), Reply-To, sandbox warning, checkEmailConfig
  i18n.js                  Two-language label dictionary (English + Afrikaans)
  logger.js                Pino logger
  marks.js                 Mark-allocation helpers
  illustrations/           Hand-rolled SVG illustrations for Lesson kid-mode
    index.js                 Picker dispatcher (pickHero / pickIcon / pickStamp + raster wrapper)
    subject-icons.js         Per-subject SVG generators (calculator / book / flask / globe / …)
    mascot.js                Friendly geometric mascot (junior band)
    stamps.js                "Well done!" celebration stamp (junior band)
  moderator.js             Quality-gate moderator (post-generation review)
  palette.js               Lesson visual-style picker (per-grade-band palette + accent rotation)
  pptx-builder.js          Lesson PowerPoint renderer (pptxgenjs)
  rebalance.js             Distributes leaf marks to hit prescribed cog-level percentages exactly
  render.js                MAIN DOCX renderer for the schema-first pipeline (cover, sections, memo, lesson plan)
  sse.js                   Server-Sent Events channel helper for /api/generate streaming
  tools.js                 Tool definitions for Claude calls
  user-state.js            User settings + history persistence
  validate.js              str() / int() / oneOf() / bool() request-input helpers

schema/                  JSON Schema + runtime validator
  resource.schema.js       resourceSchema (JSON Schema) + assertResource() + narrowSchemaForRequest()
  fixtures/                Sample valid Resources for tests/scripts
  flag-outputs.js          Tagged-output classification helpers
  render-spike.js          Day-3 render spike runner
  spike-runner.js          Day-2 generation spike runner
  test-matrix.js           Coverage matrix for spike configurations

scripts/                 Ops + analysis (not run in production)
  extract-atp-pacing.js    Sonnet-driven extractor: PDF → data/atp-pacing.json entry
  bundle-grade-review.js   Bundles a grade's outputs for human review
  cost-quality-bench.js    Per-call cost vs quality benchmark
  cost-quality-diff.js     Diff two benchmark runs
  moderate-sweep.js        Run the moderator across many cached resources
  render-fixture.js        Render a fixture Resource → DOCX file
  simulate-prompt-budget.js  Estimate tokens for prompt + tool schema
  smoke-gate.js            CI smoke test against a curated request matrix
  spot-check-haiku.js      Cheap Haiku-based sanity checks
  targeted-resweep.js      Re-run specific failing slots after a fix

test/                    node:test suites (run with `npm test`)
  ...                      One file per concern. lesson.test.js covers the entire Lesson generator.

data/                    Loaded at boot
  atp.json                 ATP topic database — subjects, examScope, ATP[subject][grade][term].topics
  atp-pacing.json          Rich CAPS pacing data — units, prerequisites, formal-assessment splits, source citations
  cache.db                 SQLite cache (not in git; created on first request)
  samples/                 Reference outputs

docs/
  atp-pacing-schema.md     Schema doc for data/atp-pacing.json — start here when modifying pacing extraction

fonts/                   TTFs vendored for deterministic SVG rasterisation
  Inter-*.ttf
  SourceSerif4-*.ttf

mockups/                 Design references
public/                  Static assets served as-is
  landing.html             Public landing page — hero, features, sign-in/up form
  index.html               Authenticated SPA — entire generator (single file, no build step)
  help.html                Help / FAQ page (21 collapsible items)
  privacy.html             Privacy Policy (POPIA-aware draft template)
  terms.html               Terms of Service (draft template)
  404.html                 Public 404 page (replaces silent SPA fallback)
  favicon.svg              Inline-SVG favicon
  robots.txt               Disallows /api/ and /app
*.pdf                    DBE Annual Teaching Plan PDFs (source of truth for atp-pacing.json)
ResourceRoom_MASTER_v2_7.xlsx  Internal pacing spreadsheet (deprecated by atp-pacing.json)
```

---

## API surface

All `/api/*` endpoints return JSON. Rate limits, per route family:

- **Email-sending** (`/auth/signup`, `/auth/forgot`, `/auth/resend-verification`): 3/min, 10/hr per IP.
- **Sign-in / reset** (`/auth/signin`, `/auth/reset` POST): 10/min, 60/hr per IP.
- **Claude-backed** (`/generate`, `/refine`, `/rebuild-docx`): auth-gated, **per-user** 10/min, 50/hr, 200/day.

### Generation

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/generate` | Generate a CAPS-aligned resource pack. Streams SSE phases when client sends `Accept: text/event-stream`, otherwise returns plain JSON. |
| POST | `/api/refine` | Apply one refinement instruction to an existing resource. |
| POST | `/api/rebuild-docx` | Re-render a DOCX from edited preview text (no Claude call). |
| GET  | `/api/atp` | Full ATP topic database (subjects, examScope, ATP, ATP_TASKS). Cached + ETag'd. |
| GET  | `/api/pacing-units` | Slim Unit list for Lesson Unit picker. Query params: `subject`, `grade` (4–7), `term` (1–4). |
| GET  | `/api/test` | Secret-gated Anthropic connectivity check. |

### Auth

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/signup` | Create an account with email + password. Sends verify + welcome emails. Returns 200 even if email is already registered (no enumeration). |
| POST | `/api/auth/signin` | Verify password, mint session cookie. Generic 401 on any failure. |
| POST | `/api/auth/forgot` | Send a password-reset email. Always 200 regardless of whether the email is registered. |
| GET  | `/api/auth/reset` | Render the "set new password" form (token NOT consumed — defeats email-scanner prefetch). |
| POST | `/api/auth/reset` | Apply the new password, mark email verified, drop other sessions, mint a fresh session, redirect to `/app`. |
| GET  | `/api/auth/verify` | Render the "confirm email" page (token NOT consumed). |
| POST | `/api/auth/verify` | Consume the verify token, set `email_verified_at`, sign the user in if not already, redirect to `/app`. |
| POST | `/api/auth/resend-verification` | Re-send the verification email. Auth-gated. No-op if already verified. |
| POST | `/api/auth/logout` | Delete the session row + clear the cookie. |
| GET  | `/api/auth/me` | Return the current user (with `profile`, `emailVerified`, `hasPassword`, `subscription`) or 401. |

### User state

| Method | Path | Purpose |
|---|---|---|
| GET / PUT | `/api/user/profile` | Teacher profile (name, school, role, grades, subjects, province). PUT also flips `profile_completed_at`. |
| GET / PUT | `/api/user/settings` | Per-user JSON settings blob (the sidebar cascade state). |
| GET / POST / DELETE | `/api/user/history` | Recent generation history (capped per user). |
| DELETE | `/api/user/history/:id` | Delete one history entry. |
| DELETE | `/api/user/account` | Permanently delete the account (POPIA right-to-erasure). Requires `confirmEmail` matching the signed-in email. |

### Billing

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/billing/checkout` | Open Stripe Checkout for a subscription tier. |
| POST | `/api/billing/portal` | Open Stripe Customer Portal. |
| POST | `/api/stripe/webhook` | Subscription-state source of truth. Uses **raw body** for signature verification — mounted before `express.json()`. |

### Health / operational

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Unauthenticated 200 for Railway health checks. |
| GET | `/health/status` | Per-dependency status snapshot (database, auth, anthropic, email, sentry). Optionally guarded by `?secret=$HEALTH_STATUS_SECRET`. |
| GET | `/_/analytics.js` | Plausible analytics loader. Emits the script tag when `PLAUSIBLE_DOMAIN` is set, a no-op otherwise. |
| ALL | `/api/*` | 404 for unknown API routes (before HTML catch-all). |
| GET | `*` | Catch-all → public 404 page. |

### Generate request body

```jsonc
{
  "subject": "Mathematics",
  "grade": 6,                        // 4-7
  "term": 2,                         // 1-4
  "language": "English",             // English | Afrikaans
  "resourceType": "Lesson",          // Worksheet|Test|Exam|Final Exam|Investigation|Project|Practical|Assignment|Lesson
  "duration": 10,                    // total marks (5-200; the field is named "duration" for legacy reasons)
  "difficulty": "on",                // below | on | above
  "topic": "Number Sentences",       // optional — pin to a single topic; ignored for Lesson (replaced by unitId)

  // Lesson-only fields:
  "unitId": "MATH-6-2026-t2-u2",     // required for Lesson — from /api/pacing-units
  "lessonMinutes": 45,               // optional, 20-120, default 45
  "subtopicHeading": "Solving by inspection",  // optional — narrows lesson to one subtopic of the Unit
  "seriesContext": {                 // optional — set by the frontend series orchestrator
    "position": 3,                   //   1-indexed lesson number
    "total": 8,                      //   total lessons in the series
    "priorSubtopics": [              //   subtopics already covered by earlier lessons in this series
      "Number sentences with one or more variables",
      "Solving for a variable using known number facts"
    ]
  },

  "fresh": false                     // optional — bypass result cache
}
```

### Generate response payload

```jsonc
{
  "docxBase64": "...",               // always present
  "preview": "plain-text preview",
  "filename": "Mathematics-Lesson-Grade6-Term2.docx",
  "verificationStatus": "invariants_passed" | "mark_sum_drift",
  "_meta": {
    "pipeline": "v2",
    "rebalanceNudges": 0,
    "framework": "Bloom's"
  },
  // Lesson-only:
  "pptxBase64": "...",
  "pptxFilename": "Mathematics-Lesson-Grade6-Term2.pptx"
}
```

When the request is SSE, phases stream as named events: `cache`, `generate`, `generate-retry-1`, `generate-retry-2`, `docx_render`, `pptx_render`, plus a final `result` event.

---

## Schema overview

`schema/resource.schema.js` defines the entire Resource shape. Key top-level branches:

- `meta` — request echoes (subject/grade/term/language/resourceType/totalMarks/duration/difficulty), cognitive framework spec, topic scope
- `cover` — pure presentation: resourceTypeLabel, subjectLine, gradeLine, termLine, learnerInfoFields, instructions
- `stimuli[]` — shared content (passage / visualText / dataSet / diagram / scenario), each with an id
- `sections[]` — ordered question groups (each with title, optional letter A/B/C, optional stimulusRefs, questions[])
- `memo` — answers (one per leaf question, matched by `questionNumber`), optional rubric, optional extension
- `lesson` (optional, required when resourceType === 'Lesson') — see [The Lesson generator](#the-lesson-generator)

### `narrowSchemaForRequest(ctx)`

Per-request narrowing tightens the base schema for one specific generation. Critical: this is what gets sent to Anthropic as the tool's `input_schema`, so anything narrowed here is enforced by the API at the response level.

It narrows:

- `meta.subject`, `meta.language`, `meta.resourceType` → single-value enums
- `meta.cognitiveFramework.levels[*].name` → enum of the framework's level names
- `sections[*].questions[*].cognitiveLevel` (recursive via $ref) → same
- `sections[*].questions[*].topic` (recursive via $ref) → enum of `meta.topicScope.topics`
- `memo.answers[*].cognitiveLevel` → same
- **`required[]` adds `'lesson'` when resourceType === `'Lesson'`** — without this, Sonnet skips the entire lesson branch (it's optional in the base schema, since most resource types don't have one)

### Lesson-flow helpers in `lib/atp.js`

- `getPacingUnitsSlim(subject, grade, term)` — slim Unit list for the frontend Unit picker. Includes `subtopicHeadings[]` so the picker can populate without a follow-up fetch.
- `getPacingUnitById(subject, grade, unitId)` — looks up the chosen Unit (returns `{ unit, term, year }`).
- `getUnitSubtopicHeadings(unit)` — returns deduped, trimmed top-level subtopic headings for a Unit.
- `findUnitSubtopic(unit, heading)` — finds a subtopic by exact (trimmed) heading match. Returns `null` for unknown headings (graceful fallback to whole-Unit scope rather than failing the request).

### `assertResource(resource)`

Runtime cross-field invariants:

1. Every leaf question's `marks` contributes to `meta.totalMarks`
2. Every question is leaf XOR composite
3. `cognitiveLevel ∈ meta.cognitiveFramework.levels[*].name`
4. `topic ∈ meta.topicScope.topics`
5. `stimulusRef` points to an existing `stimulus.id`
6. `memo.answers` covers exactly the leaf questions, no more, no less
7. `cognitiveFramework.levels[*].percent` sums to 100
8. `cognitiveFramework.levels[*].prescribedMarks` sums to `meta.totalMarks`
9. `memo.answers[*].marks` matches the question's marks
10. MCQ has exactly one correct option
11. **Lesson invariants** (when `meta.resourceType === 'Lesson'`):
    - `lesson` is present and is an object (not a stringified branch — see [Bugs we've hit](#bugs-weve-hit--how-to-debug))
    - `lesson.phases[*].minutes` sums within ±5 of `lesson.lessonMinutes`
    - `lesson.slides[*].ordinal` values are unique
    - At most one slide may have `layout: "title"` (zero is allowed; the renderer infers)
    - Diagram-layout slides must carry a `stimulusRef` that resolves

---

## CAPS data files

Two JSON files in `data/` carry all CAPS data. Both are loaded once at boot in `lib/atp.js` and exposed via helpers used by both backend and frontend.

### `data/atp.json`

Lightweight topic database. Shape:

```jsonc
{
  "subjects": {
    "intermediate": [...subject names for Gr 4-6...],
    "senior":       [...subject names for Gr 7...]
  },
  "examScope": { "1": [1], "2": [1, 2], "3": [3], "4": [3, 4] },
  "atp": {
    "Mathematics": {
      "4": {
        "1": { "topics": [...string list...], "tasks": [{ label, resourceType, minMarks, maxMarks }] },
        "2": { ... }, "3": { ... }, "4": { ... }
      },
      "5": { ... }, "6": { ... }, "7": { ... }
    },
    ...
  }
}
```

The `tasks[]` field per slot drives the **Resource type cascade** in the frontend — for any subject/grade/term combo, the dropdown shows the CAPS-prescribed tasks (e.g. *"Test (50 marks)"*, *"Investigation (30 marks)"*) plus a synthetic *"Lesson plan + worksheet"* option appended in the frontend.

### `data/atp-pacing.json`

Rich pacing extracted from the DBE PDFs (in repo root). Shape (full schema in `docs/atp-pacing-schema.md`):

```
subjects[<Subject>][<grade>][<year>] → PacingDoc {
  capsStrands: [...],
  terms: {
    "1": TermPlan {
      totalWeeks, totalHours,
      units: [Unit { id, weeks, hours, topic, capsStrand,
                     subtopics, prerequisites, resources,
                     informalAssessment, notes,
                     source: { pdf, page } }],
      formalAssessment: [...]
    },
    ...
  },
  yearOverview, notes
}
```

Used by:

- `getPacingUnits(subject, grade, term, isExamType)` — full Units for the system prompt's *"## CAPS reference"* block
- `getPacingFormalAssessments(...)` — drives the *"## CAPS assessment structure"* prompt block (mainly for Languages)
- `getPacingUnitsSlim(subject, grade, term)` — slim list for the frontend Unit picker (`/api/pacing-units`)
- `getPacingUnitById(subject, grade, unitId)` — looks up the chosen Unit when generating a Lesson

To **add pacing data for a new subject**: drop the DBE PDF into the repo root, then run `node scripts/extract-atp-pacing.js --only "<filename>"`. The extractor uses Sonnet to parse the PDF and emits a PacingDoc into `data/atp-pacing.json`. The schema-doc decision is *"use the latest available year"*, so 2026 PDFs win over 2023-24 wherever both exist.

---

## Frontend cascade

`public/index.html` is one file (~2,400 lines). The cascade is wired by these handlers:

- `onGradeChange()` → `loadSubjects()` → `loadResourceTypes()` → `loadTopics()`
- `onTermChange()` → same chain
- `onSubjChange()` → `loadResourceTypes()` + `loadTopics()`
- `onResTypeChange()` → reads `data-rtype` off the selected option, sets `rtype`, swaps the topic dropdown for a Unit picker if `rtype === 'Lesson'`, shows/hides the Lesson length + Subtopic + Series rows, retunes the marks dropdown

### Lesson-specific UI

When the user selects "Lesson plan + worksheet":

1. Topic dropdown label flips to **"CAPS Unit"**.
2. `loadTopics()` async-fetches `GET /api/pacing-units?subject=…&grade=…&term=…` and populates the dropdown with `<option value="<topic>" data-unit-id="..." data-subtopics="[…JSON…]">…</option>`. Subtopic headings are stashed on the option so the Subtopic picker can populate sync, no extra fetch.
3. **Lesson length** field (30 / 45 / 60 / 90 min, default 45).
4. **Subtopic focus** dropdown — always visible in Lesson mode. Populated from the chosen Unit's `data-subtopics`. For single-subtopic Units it shows "Whole unit only" disabled with helper text *"CAPS doesn't break this Unit into named subtopics."*
5. **Generate full unit series** upsell button — always visible in Lesson mode. Enabled (with the lesson count subtitle) for Units with 2+ subtopics; disabled with *"Series unavailable for single-subtopic Units"* otherwise. Same data source as the picker.
6. Marks dropdown re-tunes to **10–30 marks** (worksheet-sized).

`doGenerate()` reads `unitId` from the selected option's `data-unit-id`, `lessonMinutes` from the lesson-length dropdown, and `subtopicHeading` from the subtopic dropdown (empty string = whole-Unit fallback, dropped from the request body). Posts via SSE for live phase progress.

`openSeriesModal()` → `confirmSeriesGenerate()` → `generateSeries(plan, startFrom)` is the series flow. The orchestrator iterates the Unit's subtopics, calls `callGenerateOnceWithRetry()` per lesson (which wraps `callGenerateOnce()` with auto-retry classification), and renders progress + per-lesson results via `renderSeriesProgress()`. JSZip is loaded lazily by `ensureJSZip()` for the bulk-download path (same lazy pattern as the existing `ensureDocxLib()`).

The output card includes a **PowerPoint download button** (orange `#D04423`, distinguishable from the blue Word button) when the result payload contains `pptxBase64`.

---

## Testing

```bash
npm test          # runs all node:test suites — 549 tests, ~32s, no Anthropic calls
```

Test files live in `test/`. Conventions:

- One file per concern (`api.test.js` would cover one route; `lesson.test.js` covers the whole Lesson generator including schema, prompt, renderers, inference helpers, subtopic flow, and series context)
- Pure functions only — no Anthropic API key needed (all Anthropic calls are mocked or stubbed)
- `node:test` reporter `spec` for readable output

Key test files:

- `test/lesson.test.js` — schema invariants, prompt builder (whole-Unit, subtopic focus, series context), renderers, inference, stringified-branch unwrapping, narrowSchema "lesson" required, subtopic helpers (`getUnitSubtopicHeadings` / `findUnitSubtopic`), cache key separation across single/subtopic/series modes
- `test/atp.test.js` — ATP database integrity, pacing helpers
- `test/atp-prompt.test.js` — prompt-block builders (CAPS reference, assessment structure, formal-assessment matcher, lesson-prompt subtopic + series blocks)
- `test/generate-cache.test.js` — cache key shape + handler short-circuit
- `test/anthropic*.test.js` — SDK wrapper retry / abort / caching behaviour
- `test/diagrams.test.js` — bar_graph / number_line / food_chain SVG output
- `test/cognitive.test.js` — `marksToTime`, `largestRemainder`, framework selection

A CI smoke gate (`scripts/smoke-gate.js`) runs a curated request matrix against the real Anthropic API for end-to-end coverage. Not run on every push (cost) — manual / nightly only.

---

## Deployment

**Railway** — the only currently supported deploy target.

1. New project → deploy from this repo.
2. Add the variables from `.env.example` in Railway → Variables. Only `ANTHROPIC_API_KEY` is strictly required; auth + email + Stripe vars are needed for prod.
3. The health check path is `/health` (already configured in `railway.json`).
4. **Mount a persistent volume for `data/cache.db`** if you want the result cache to survive deploys. Set `CACHE_DB_PATH` to a path inside the volume.
5. **Trust proxy** is set to `1` in `server.js` so Railway's TLS-terminating proxy passes through the real client IP for rate limits.

Cold starts are ~3s (no native build step, no deps to compile beyond `better-sqlite3`'s prebuilt binaries). `npm ci` in production, `npm install` for local dev.

### What's NOT in the deploy

- LibreOffice / headless PDF conversion — explicitly not added. Teachers convert DOCX/PPTX to PDF in their own Office app (one-click, no server cost, keeps the deploy small).

---

## Bugs we've hit + how to debug

The most useful section in this README. If something looks weird in production, the answer is usually one of these.

### "The lesson DOCX has only the title and 'CAPS Anchor' header — everything else is empty, and the PowerPoint button doesn't appear"

**Cause:** Sonnet 4.6 returned the `lesson` branch as a JSON-encoded **string** instead of an object. The DOCX renderer's headers run unconditionally (so the title block + CAPS Anchor heading appear), but every conditional body section (objectives, vocabulary, phases, …) checks `resource.lesson?.<field> || []`, gets `undefined` because string properties don't exist, and renders nothing. assertResource passes spuriously because `!lesson` is false for a non-empty string. PPTX renderer hits *"slides is empty"* and we catch silently → no button.

**Fix already in place:** `unwrapStringifiedBranches()` in `api/generate.js` includes `'lesson'` in `TOP_KEYS` and recurses one level into the lesson branch's array properties + `capsAnchor`. `assertResource` defensively checks `typeof lesson === 'object'` so any future bypass fails loudly.

**Debugging hint:** if this comes back for a different branch, look for the exact same symptom — partial render with all conditional sections empty — and add the branch to `TOP_KEYS`. The original Day-2 spike comment in `api/generate.js` documents this pattern.

### "Lesson generation fails on every retry with `worksheetRef` and `title slide` errors"

**Cause:** Sonnet reliably skips both fields. We **do not** require them anymore — the renderers infer them. If you see this error class, it means someone re-tightened `assertResource`. Don't.

**Fix already in place:** `assertResource` no longer requires `worksheetRef === true` on any phase, and allows zero `layout: "title"` slides. The DOCX renderer's `pickWorksheetPhaseIndex()` falls back to phase-name match then phase #4. The PPTX renderer treats slide #1 as the title when no slide declares it.

### "Lesson generation produces a worksheet-shaped DOCX, no lesson plan, no PowerPoint"

**Cause:** The base `resourceSchema.required` array does NOT include `'lesson'`. Without `narrowSchemaForRequest()` adding it for Lesson requests, Anthropic's tool API treats the entire lesson branch as optional, and Sonnet skips it. assertResource then fails with *"lesson required when meta.resourceType === 'Lesson'"* and we hit the retry loop until exhaustion.

**Fix already in place:** `narrowSchemaForRequest()` appends `'lesson'` to the cloned schema's top-level `required[]` when `resourceType === 'Lesson'`.

### "Cached results from the old Lesson shape come back as a worksheet"

**Cause:** Cache key prefix doesn't change when schema changes.

**Fix:** Bump the prefix in `buildCacheKey()` (currently `gen:v3:`). Old entries become unreachable.

### "I added a new resource type and the cache is serving stale results from a different type"

**Cause:** Same as above — cache key didn't change for resource-type-specific shape changes. Bump the prefix.

### "Phase minutes don't add up — assertResource fails with `phases[*].minutes`"

**Cause:** Sonnet's per-phase budget allocation drifts. The retry loop's `buildTargetedRemediation()` injects an explicit *"recalculate per-phase minutes so they add up to N"* hint on retry.

**If this fires often:** bump the `±5` tolerance in `assertResource` lesson invariants, or tighten the prescribed budget formula in `buildLessonContextBlock()`.

### "Generation hangs / times out on Final Exam"

**Cause:** Final Exam is the worst-case prompt — all four terms in scope, max marks, longest output. A single Anthropic call can run 4–6 minutes at the 32k output budget. Final Exam therefore has its own enlarged budgets:

- **Output cap**: 32,000 tokens (vs 16,000 for Tests/Exams, 24,000 for Lessons). The earlier 16k budget cut Final Exams off mid-tool-call, which then failed schema validation and chewed the retry budget — at $0.79 a pop. Bumping to 32k lets the model finish under the schema in a single attempt.
- **Per-call Anthropic timeout**: 360s (vs default 240s). At ~100 tok/s the model needs the full 6 min to emit 32k tokens.
- **Hard wall-clock**: 7 min (vs 5.5 min for everything else). Wraps the per-call timeout with a small safety margin.
- **Retries**: 0 (single shot — wall clock is too tight for retry passes).

If a Final Exam still hangs past 7 min, the per-call Anthropic timeout (`lib/anthropic.js`) or the model itself is the next thing to check.

**Friendly error:** the handler reshapes the abort into *"Generation took longer than N minutes…"* (N = 7 for Final Exam, 5 for everything else) and surfaces it via SSE.

### "Diagram doesn't render in the DOCX/PPTX"

**Cause:** Sonnet emitted a `kind: "diagram"` stimulus without a `spec`, or the spec doesn't match one of the three supported diagram types (`bar_graph`, `number_line`, `food_chain`).

**Fix:** the prompt explicitly forbids this in the system-prompt structural rules (5a–5g). If the model still does it, the renderer falls back to the verbal `description`. Adding new diagram types means adding a renderer in `lib/diagrams/` AND updating the schema's `diagramSpec` `oneOf`.

### "ATP topic mismatch — `assertResource` rejects a question whose topic is almost-but-not-quite right"

**Cause:** Sonnet emits a near-miss like `"X — Y — Y"` instead of canonical `"X — Y"`. We snap to canonical via `snapTopicsToCanonical()` (collapse-duplicates pass + Levenshtein within a 10% budget). If a real near-miss is being rejected, widen the budget — but check first that the canonical topic isn't itself wrong.

### "The Subtopic dropdown vanishes for some Units — looks like the feature broke"

**Cause:** Phase A's original logic hid the Subtopic row whenever the chosen Unit had fewer than 2 subtopics in the CAPS pacing data. NUMBER SENTENCES Gr 6 T2 (and others) are captured as a single subtopic block in `data/atp-pacing.json`, so the entire row vanished with no explanation.

**Fix already in place:** `loadSubtopicsForCurrentUnit()` always shows the row in Lesson mode. For single-subtopic Units the dropdown is rendered disabled with explanatory help text and the Series button shows disabled with a tooltip. The teacher always sees the controls, so they know the feature exists and why it isn't actionable for this particular Unit.

**Debugging hint:** if the controls are silently hidden again, check that `loadSubtopicsForCurrentUnit()` is the function setting the row's `display`. The `onResTypeChange()` handler also hides them when `rtype !== 'Lesson'` — that's the only intentional hide path.

### "Series stops mid-way with a transient error and the user has to manually click Retry"

**Cause:** The original orchestrator (Phase B) treated every error as terminal — even rate-limit (429), Anthropic 5xx, and schema-fail-after-retries which are all effectively transient. The user had to click the Retry button by hand and let the cache replay completed lessons.

**Fix already in place:** `callGenerateOnceWithRetry()` wraps every series call. Up to 3 attempts per lesson on transient failures: 429 → respect `Retry-After` / `RateLimit-Reset` (capped 90s, default 30s); 5xx + network → exponential 2s → 4s → 8s with jitter; 4xx-but-not-429 → terminal. The progress strip shows "retrying (attempt 2 of 3) — waiting 12s — Too many requests" so the user knows it's handling the failure.

**Debugging hint:** if a series stops without auto-retry firing, the error is probably 4xx-but-not-429 (real input bug — auth, validation, etc.). Open DevTools → Console; the `[series] error response` log shows the full server response body.

### "Series cache key collision — re-running mid-series serves a wrong / single-lesson result"

**Cause:** The cache key needs to include enough series context that mid-series lessons can't collide with single-lesson cache entries for the same Unit + subtopic. Without `seriesPosition` / `seriesTotal` / `seriesPrior` in the key, lesson 3 of 8 would key-collide with a previously-cached single-lesson generation against the same subtopic — and serve a lesson without prior-context awareness.

**Fix already in place:** `buildCacheKey` (now `gen:v6:`) includes the series fields when `seriesContext.total > 1`. A 1-of-1 series collapses to the single-lesson key — that's deliberate (free win when teachers click Generate Series on a Unit with one subtopic).

**Debugging hint:** if you bump cache version, also check `test/lesson.test.js`'s "cache key uses a versioned prefix" test still uses `/^gen:v\d+:/` (version-agnostic) rather than pinning to a specific number.

### "Series rate-limit issues — orchestrator hits 429 repeatedly"

**Cause:** Server rate limit is 10 calls/min per user on `/api/generate` (and the limiter is shared with `/api/refine`, `/api/cover`, `/api/rebuild-docx`). If pacing is too aggressive, a long series can hit 429 once the rolling window fills up.

**Fix already in place:** Pacing is **8 seconds** between non-cache-hit calls (~7.5 calls/min, comfortable headroom). Cache hits skip pacing. Auto-retry honors `Retry-After` if a 429 still slips through.

**Debugging hint:** if 429s become common, either the user's other-tab activity is sharing the limit (auth-me polls don't count, but generate/refine/cover do), or pacing needs to widen further (10s would be ~6 calls/min — very safe). Also worth checking that `callGenerateOnce` is reading `RateLimit-Reset` correctly via `parseRetryAfter`.

---

## Glossary

- **ATP** — Annual Teaching Plan. The DBE document that prescribes what every CAPS subject covers each week of each term.
- **CAPS** — Curriculum and Assessment Policy Statement. The South African national curriculum.
- **Cognitive framework** — Bloom's (Knowledge / Routine / Complex / Problem Solving for Maths; Low / Middle / High Order for everything else) or Barrett's (Literal / Reorganisation / Inferential / Evaluation+Appreciation for English/Afrikaans Home Language and FAL). Selected per subject in `lib/cognitive.js`.
- **Composite question** — a parent question with `subQuestions[]`. Carries no `marks`; its total is the sum of its leaves.
- **DBE** — Department of Basic Education (the SA government department).
- **FAL** — First Additional Language.
- **HL** — Home Language.
- **Leaf question** — a question with `marks + cognitiveLevel + answerSpace`. Has exactly one matching `memo.answer`.
- **NST** — Natural Sciences and Technology (Intermediate Phase combined subject).
- **Pacing data** — the rich week-by-week, concept-tree CAPS data extracted from DBE PDFs into `data/atp-pacing.json`.
- **Phase** (Lesson) — one of Introduction / Direct Teaching / Guided Practice / Independent Work / Consolidation. Five phases per Lesson, prescribed by CAPS.
- **Resource type** — Worksheet / Test / Exam / Final Exam / Investigation / Project / Practical / Assignment / Lesson. Drives the entire generation shape.
- **RTT** — Response-to-Text. The CAPS HL/FAL paper format with a passage + comprehension + summary + visual-text sections.
- **Series** (Lesson) — N orchestrated single-lesson generations covering one Unit's subtopics in CAPS order, each aware of the prior subtopics via `seriesContext`. Frontend-orchestrated; each call is a normal billable `/api/generate`.
- **Stimulus** — shared content (passage / visualText / dataSet / diagram / scenario) referenced by questions via `stimulusRef`.
- **Subtopic** (Lesson) — one of a Unit's top-level concept blocks. Source of `findUnitSubtopic` lookups and the optional `subtopicHeading` request field that narrows lesson focus.
- **Tool call** — Claude's structured-output mechanism. We use **forced** tool use (`tool_choice: { type: "tool", name: "build_resource" }`) so the model must call our tool with a schema-conforming object.
- **Transient error** — series-orchestrator term for an error class that should be auto-retried: 429 (rate limit), 5xx (server / Anthropic-side), and network errors. Anything else (4xx-non-429) is treated as terminal and surfaced to the user immediately.
- **Unit** (Lesson) — one teaching block from the ATP pacing data, identified by a stable id like `MATH-6-2026-t2-u2`.

---

## License

Proprietary. © The Resource Room.
