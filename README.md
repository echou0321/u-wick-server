# U-Wick API Server

Backend for U-Wick — a conversational AI academic planner built for UW Capstone 2026 in partnership with Maximal Learning / Wick (wick.app).

**Stack:** Node.js + Express · PostgreSQL (Azure) · Anthropic Claude · Azure Blob Storage · Azure Document Intelligence · Expo Push Notifications

**Live:** https://u-wick-api-hxaketgeedg9cjcr.centralus-01.azurewebsites.net

---

## Setup

```bash
npm install
cp .env.example .env   # fill in real credentials
node server.js
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing JWTs |
| `ANTHROPIC_API_KEY` | Claude API key |
| `AZURE_BLOB_CONN_STR` | Azure Blob Storage connection string |
| `AZURE_DOC_INTEL_ENDPOINT` | Azure Document Intelligence endpoint |
| `AZURE_DOC_INTEL_KEY` | Azure Document Intelligence key |

---

## Implementation Status

### Infrastructure
- [x] Azure PostgreSQL — all 11 tables migrated and live
- [x] Azure App Service — live, autodeploy from GitHub Actions
- [x] Azure Blob Storage — syllabi-uploads container provisioned
- [x] Azure Document Intelligence — F0 tier provisioned
- [x] Express server scaffold (`src/app.js`, `src/db.js`)
- [x] `.env` / `.env.example` setup, `.gitignore`

### Auth — `src/routes/auth.js`
- [x] `POST /api/auth/register`
- [x] `POST /api/auth/login`
- [x] JWT middleware (`src/middleware/auth.js`)

### Users — `src/routes/users.js`
- [x] `GET /api/users/me`
- [x] `PATCH /api/users/me`
- [x] `POST /api/users/me/onboarding/complete`
- [ ] `PATCH /api/users/me/push-token`

### ICS / Canvas Calendar — `src/routes/ics.js`
- [x] `POST /api/ics/connect`
- [x] `POST /api/ics/sync`
- [x] `GET /api/ics/status`
- [ ] `DELETE /api/ics/disconnect`

### Tasks — `src/routes/tasks.js`
- [x] `GET /api/tasks`
- [x] `PATCH /api/tasks/:id`
- [x] `DELETE /api/tasks/:id`
- [ ] `POST /api/tasks`
- [ ] `GET /api/tasks/:id/subtasks`
- [ ] `POST /api/tasks/:id/breakdown` *(blocked — requires Anthropic API key)*

### Schedule — `src/routes/schedule.js`
- [ ] `GET /api/schedule`
- [ ] `POST /api/schedule/blocks`
- [ ] `PATCH /api/schedule/blocks/:id`
- [ ] `DELETE /api/schedule/blocks/:id`
- [ ] `GET /api/schedule/heat`

### Chat — `src/routes/chat.js`
- [ ] `POST /api/chat` *(blocked — requires Anthropic API key)*
- [ ] `GET /api/chat/history`
- [ ] `DELETE /api/chat/history`

### Syllabus — `src/routes/syllabus.js`
- [ ] `POST /api/syllabus/upload`
- [ ] `GET /api/syllabus/status/:jobId`
- [ ] `POST /api/syllabus/confirm/:jobId` *(extraction step blocked — requires Anthropic API key)*
- [ ] `GET /api/syllabus`

### Major Advising — `src/routes/majors.js` + `src/routes/goals.js`
- [ ] One-time scraper script + monthly cron refresh
- [ ] `GET /api/majors`
- [ ] `GET /api/majors/:id`
- [ ] `POST /api/goals/major`
- [ ] `GET /api/goals/major`
- [ ] `PATCH /api/goals/major/:id`
- [ ] `PATCH /api/goals/major/:id/checklist`

### Session Logging — `src/routes/sessions.js`
- [x] `logEvent()` helper (`src/middleware/logger.js`)
- [ ] `POST /api/sessions/start`
- [ ] `POST /api/sessions/event`
- [ ] `POST /api/sessions/end`
- [ ] `GET /api/sessions/export` *(admin only)*

### Proactive Features
- [ ] Morning digest cron (8am daily)
- [ ] "Start this now" nudge cron (every 6 hours)
- [ ] Major application deadline reminders cron (daily)
- [ ] Monthly major requirements re-scrape cron
- [ ] Expo push notification delivery
