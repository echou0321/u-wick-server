# U-Wick Server — Claude Working Doc

Project: UW Capstone 2026, partnered with Maximal Learning/Wick (wick.app).
Conversational AI academic planner: React Native + Expo + Node/Express + PostgreSQL + Anthropic Claude.
@docs/design.md
Say "Design Doc loaded." at the start of every session after reading it.

---

## Locked Decisions
- Auth: bcrypt + JWT. No Azure AD B2C. JWT expiry 30 days. No refresh tokens — stateless.
- No compression middleware — conflicts with SSE streaming on /chat.
- All code is CommonJS (`require`/`module.exports`). Ignore VS Code "convert to ES module" hint.
- Hybrid scrape approach: store URLs + parsed data in DB, one-time manual scrape updated each academic year. Claude reads from DB at chat time, never scrapes live.
- Anthropic API key not yet received — /chat, POST /tasks/:id/breakdown, and syllabus text extraction are blocked until it arrives.

---

## Azure Resources (all Central US)
- Resource group: `u-wick-rg`
- PostgreSQL: `u-wick-db.postgres.database.azure.com`, admin: `uwickadmin`, db: `uwick`
- Blob Storage: `syllabi-uploads` container, private access
- Document Intelligence: F0 tier
- App Service: `https://u-wick-api-hxaketgeedg9cjcr.centralus-01.azurewebsites.net`
- GitHub Actions CI/CD — push to main autodeploys
- `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL` set in Azure App Service env vars
- `DATABASE_URL` and `JWT_SECRET` also added as GitHub Actions secrets (required for CI test step)

---

## DB Schema Deviations (actual columns differ from design doc)
- `courses`: `id, user_id, name, code, quarter, color, source, created_at` — column is `name` not `title`; no UNIQUE constraint on `(user_id, name)`, dedup via SELECT-first
- `tasks`: `id, user_id, course_id, title, due_date, weight, source, ics_uid, done, highlighted, created_at` — no UNIQUE on `ics_uid`, dedup via SELECT WHERE `user_id + ics_uid`
- `schedule_blocks`: `id, user_id, course_id, title, start_time, end_time, block_type, source, color, created_at`
- `chat_sessions`: `id, user_id, flow, platform, app_version, started_at, ended_at, duration_s`
- All other tables assume design doc column names until verified

---

## Code Conventions
- Auth middleware sets `req.user = { id, email }` — always use `req.user.id`, never `req.user.userId`
- `requireAdmin` middleware in `src/middleware/auth.js` — checks `req.user.email === process.env.ADMIN_EMAIL`; used on GET /sessions/export
- Test account: `test@uw.edu` / `password123` (live Azure DB)
- Local `.env` required (not committed): `DATABASE_URL` + `JWT_SECRET`
- Admin tests: set `process.env.ADMIN_EMAIL = 'test@uw.edu'` at top of test file to grant admin to test account

---

## Testing Protocol
Every new route gets a `tests/<route>.test.js` immediately after the route is built. Structure:
- `beforeAll`: login as `test@uw.edu / password123`, capture JWT
- `afterAll`: delete any rows created during the run, call `db.end()`
- Cover: 401 (no auth), key 400 validation errors, happy path per handler
- Run: `npm test` (`jest --runInBand --forceExit` configured in package.json)

---

## What's Built
- `src/routes/auth.js` — POST /register, POST /login
- `src/routes/users.js` — GET /me, PATCH /me, POST /me/onboarding/complete
- `src/routes/ics.js` — POST /connect, POST /sync, GET /status
- `src/routes/tasks.js` — GET /, PATCH /:id, DELETE /:id
- `src/routes/schedule.js` — GET /, POST /blocks, PATCH /blocks/:id, DELETE /blocks/:id, GET /heat
- `src/routes/sessions.js` — POST /start, POST /event, POST /end, GET /export (admin)
- `src/routes/majors.js` — GET /, GET /:id
- `src/routes/goals.js` — POST /major, GET /major, PATCH /major/:id, PATCH /major/:id/checklist
- `src/lib/icsSync.js` — fetchAndSync(), parseAndUpsert(), findOrCreateCourse(), upsertTask()
- `src/middleware/auth.js` — requireAuth (JWT verify); requireAdmin (ADMIN_EMAIL check); sets `req.user = { id, email }`
- `src/middleware/logger.js` — logEvent() fire-and-forget INSERT into session_events
- `tests/schedule.test.js` — 25 tests, all passing
- `tests/sessions.test.js` — 20 tests, all passing
- `tests/majors.test.js` — 8 tests, all passing
- `tests/goals.test.js` — 20 tests, all passing
- `CLAUDE.md` + `docs/design.md` — living docs system; cross-checked, contradiction-free as of 2026-04-30

## What's Next (in order)
1. **Syllabus upload pipeline** — POST /syllabus/upload, GET /syllabus/status/:jobId, POST /syllabus/confirm/:jobId, GET /syllabus + tests
2. **Cron jobs** — ICS re-sync every 6h, start-this-now nudge, morning digest, major app reminders (node-cron)
3. **Push token** — PATCH /users/me/push-token
4. **Chat route** — POST /chat (SSE), GET /chat/history, DELETE /chat/history — blocked on Anthropic API key
5. **One-time major scraper** — populate `major_requirements` table with 6 UW programs (Cheerio + Axios)

---

## Dependencies Installed
`axios, bcryptjs, cors, dotenv, express, ical.js, jsonwebtoken, pg, jest (dev), supertest (dev)`

Not yet installed (add when needed): `node-cron, multer, @anthropic-ai/sdk, @azure/storage-blob, @azure/ai-form-recognizer, cheerio`
