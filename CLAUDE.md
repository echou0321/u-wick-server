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
- Anthropic API key obtained and set in .env + Azure App Service env vars.
- Syllabus approach: text paste only (no PDF upload). Student pastes raw text → Claude extracts tasks → student confirms. Full text stored in `extracted_text` for RAG injection at chat time.

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
- `syllabi`: has a `pending_tasks` JSONB column (not in design doc) used to hold extracted tasks before `/confirm`
- All other tables assume design doc column names until verified

## API Behaviour Notes (deviations from design doc descriptions)
- `DELETE /tasks/:id` returns **403** for non-manual tasks (ICS/syllabus/ai) — not a soft-delete
- `PATCH /goals/major/:id/checklist` body: `{ step_id, completed: bool }` — field is `completed`, not `done`
- `GET /users/me/dashboard` returns `tasks_due_soon` (tasks due in next 48 h), not just today
- `GET /users/me/dashboard` heat uses absolute thresholds; `/schedule/heat` uses normalized thresholds — both correct, different purposes
- bcrypt saltRounds in `/auth/register` is **10** (design doc says 12)

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
- `src/routes/auth.js` — POST /register, POST /login, DELETE /logout
- `src/routes/users.js` — GET /me, GET /me/dashboard, PATCH /me, POST /me/onboarding/complete, PATCH /me/push-token
- `src/routes/ics.js` — POST /connect, POST /sync, GET /status, DELETE /disconnect
- `src/routes/tasks.js` — GET /, POST /, PATCH /:id, DELETE /:id, GET /:id/subtasks, POST /:id/breakdown
- `src/routes/schedule.js` — GET /, POST /blocks, PATCH /blocks/:id, DELETE /blocks/:id, GET /heat
- `src/routes/sessions.js` — POST /start, POST /event, POST /end, GET /export (admin)
- `src/routes/syllabus.js` — POST / (text paste → Claude extract), GET /status/:jobId, POST /confirm/:jobId, GET /
- `src/routes/chat.js` — POST / (SSE stream, all 7 side-effects wired), GET /history, DELETE /history
- `src/routes/majors.js` — GET /, GET /:id
- `src/routes/goals.js` — POST /major, GET /major, PATCH /major/:id, PATCH /major/:id/checklist
- `src/lib/icsSync.js` — fetchAndSync(), parseAndUpsert(), findOrCreateCourse(), upsertTask()
- `src/lib/expoPush.js` — sendPush(token, title, body, data) — fires to Expo push API; data field enables deep linking
- `src/lib/syllabusExtract.js` — extractTasksWithClaude(text, courseName) — claude-haiku-4-5 extracts structured task list from pasted syllabus text
- `src/lib/chatContext.js` — buildSystemPrompt(userId, flow) — assembles dynamic system prompt from 6 DB tables (user, courses, tasks, schedule, syllabi, major goals)
- `src/middleware/auth.js` — requireAuth (JWT verify); requireAdmin (ADMIN_EMAIL check); sets `req.user = { id, email }`
- `src/middleware/logger.js` — logEvent() fire-and-forget INSERT into session_events
- `src/jobs/icsResync.js` — every 6h, re-syncs all users with ics_url set
- `src/jobs/startThisNow.js` — every 6h, push nudge for weight>=2.0 tasks due in 72h with no study block; sends taskId for deep link
- `src/jobs/morningDigest.js` — 8am Pacific (15:00 UTC), today's tasks summary push
- `src/jobs/majorReminders.js` — 9am Pacific (16:00 UTC), 30d/7d/1d major application deadline reminders
- `src/jobs/index.js` — registers all four cron jobs; loaded by server.js on startup
- `tests/schedule.test.js` — 25 tests, all passing
- `tests/sessions.test.js` — 20 tests, all passing
- `tests/majors.test.js` — 8 tests, all passing
- `tests/goals.test.js` — 20 tests, all passing
- `tests/users.test.js` — 13 tests, all passing
- `tests/syllabus.test.js` — 16 tests, all passing
- `tests/auth.test.js` — 8 tests, all passing
- `tests/ics.test.js` — 9 tests, all passing
- `tests/tasks.test.js` — 18 tests, all passing (Anthropic SDK mocked for breakdown)
- `tests/chat.test.js` — 24 tests, all passing (Anthropic SDK mocked; all 7 side-effects covered)
- `CLAUDE.md` + `docs/design.md` — living docs system; cross-checked, contradiction-free as of 2026-05-07

## What's Next (in order)
- **Frontend integration and user study prep**

---

## Dependencies Installed
`axios, bcryptjs, cors, dotenv, express, ical.js, jsonwebtoken, node-cron, pg, @anthropic-ai/sdk, jest (dev), supertest (dev)`

Not yet installed (add when needed): `multer, @azure/storage-blob, @azure/ai-form-recognizer, cheerio`
