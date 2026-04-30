# U-Wick Backend Design Document

**FifthGear Team · University of Washington · Capstone 2026**  
Built in partnership with Maximal Learning, Inc. — [Wick](https://wick.app)

**Version 2.1 · Status: Active Development · April 2026**

---

## 1. Project Overview

U-Wick is a chatbot-centered academic planning assistant built as a University of Washington capstone project in partnership with Maximal Learning, Inc. — the company behind Wick (wick.app), a commercially deployed study planner for college students. Wick pulls assignments from Canvas and other LMS platforms, syncs calendars, builds personalized daily plans, and sends proactive reminders so students never miss a deadline.

U-Wick extends that foundation with a conversational AI layer powered by Anthropic Claude, allowing students to interact with their academic data through natural language. The capstone is structured as a blind comparative study — a 'Pepsi Challenge' — where 20–50 UW students are given either U-Wick or the production Wick app and asked to complete structured academic tasks. The primary research question is whether a conversational AI interface meaningfully reduces friction in academic planning.

### 1.1 Core Flows (MVP Scope)

| Flow | User Goal | Backend Responsibility |
|------|-----------|----------------------|
| Conversational Onboarding | Set up profile, import Canvas via ICS, upload syllabi, declare major intent | Auth, user storage, ICS parsing, PDF extraction, major DB lookup |
| Personalized Planning | Generate and manage study schedule via chat or manual tap | Claude AI integration, schedule CRUD, heat map scoring, task breakdown |
| Proactive Guidance | Receive deadline alerts, 'start this now' nudges, major app reminders | Background job scheduler, notification dispatch, proactive event rules |
| Academic Advising | Ask about major requirements, syllabi policies, eligibility, application deadlines | Syllabus RAG, major requirements DB, Claude context injection |
| User Study Logging | Researcher observes feature usage and task completion across both apps | Session + event logging, anonymized export endpoint |

### 1.2 Scope Decisions (2–3 Person Team, 2–3 Weeks)

| Feature | Decision | Reason |
|---------|----------|--------|
| ICS calendar feed (Canvas) | MVP | Simpler than OAuth; no UW-IT approval needed |
| Claude AI chatbot | MVP | Core differentiator under study |
| Syllabus upload + RAG Q&A | MVP | Current quarter only; high research value |
| Task persistence + schedule | MVP | Required for any meaningful user session |
| Workload heat map (toggle) | MVP | Thin bar UI; backend is a simple weighted sum |
| Capacity-constrained major advising | MVP | Targeted scrape of known UW pages; stored in DB |
| 'Am I on track?' + 'Start this now' | MVP | Claude prompt features; no extra backend routes |
| Smart task breakdown | MVP | Claude prompt feature; one side-effect action |
| Quarter planning mode | MVP | Claude prompt feature with schedule side-effects |
| Session + event logging | MVP | 1 day effort; critical for research analysis |
| Expo push notifications | MVP | Required for proactive nudges during study |
| Cross-quarter persistence | Dropped | Schema ready but UX deprioritized for study |
| SMS notifications | Dropped | Expo push sufficient for prototype; Twilio = stretch |
| Canvas OAuth (full) | Dropped | Replaced by ICS feed approach |
| Azure AD B2C / UW NetID SSO | Dropped | Replaced by bcrypt + JWT email/password auth |

---

## 2. Technology Stack

| Layer | Technology | Version / Service | Notes |
|-------|-----------|-------------------|-------|
| Frontend | React Native + Expo | RN 0.81 / Expo 54 | Managed workflow; iOS + Android |
| Routing | Expo Router | v6 | File-based; (onboarding) + (tabs) groups |
| API Server | Node.js + Express | Node 20 LTS | REST + SSE streaming |
| AI Chatbot | Anthropic Claude API | claude-sonnet-4-20250514 | Server-side only; key never exposed to client |
| Database | PostgreSQL | Azure Database for PostgreSQL Flexible Server | All persistent state |
| Authentication | bcrypt + JWT | jsonwebtoken + bcryptjs (npm) | Email/password; JWT signed with JWT_SECRET env var |
| File Storage | Azure Blob Storage | Standard LRS | Syllabus PDF uploads; private container |
| PDF Parsing | Azure Document Intelligence | 2024-02-29-preview | Text extraction from syllabus PDFs |
| ICS Parsing | ical.js (npm) | 1.5.0 | Parse Canvas calendar feed |
| Web Scraping | Cheerio + Axios | Latest | One-time scrape of UW major requirement pages |
| Scheduling / Jobs | node-cron | 3.x | Proactive notification background jobs |
| Hosting | Azure App Service | B2 tier (2 vCPU, 3.5 GB) | Auto-deploy from GitHub Actions |
| Push Notifications | Expo Push Notification Service | SDK 54 | No direct APNS/FCM credentials needed |

---

## 3. System Architecture

### 3.1 High-Level Diagram

```
  React Native App (Expo / Expo Router)
          |   HTTPS + SSE
  Express API Server  ──────────────────────────────────────┐
    |          |           |           |          |          |
PostgreSQL  Claude API  ICS Feed   Azure Blob  node-cron  Expo Push
 (Azure)   (Anthropic)  (canvas.   (Syllabi)  (Notif     (Notif
                         uw.edu)              Jobs)      Delivery)
```

### 3.2 Chat Message Request Flow

Every chat turn follows this sequence. This is the most performance-sensitive path in the system.

1. Client sends `POST /api/chat  { message, flow, conversationHistory }` with JWT header
2. Express JWT middleware validates token signature using `JWT_SECRET`; checks expiry
3. Server loads user context from PostgreSQL: tasks due soon, schedule blocks, active courses, current quarter syllabi
4. Server assembles dynamic Claude system prompt: role definition + injected user context + active flow instructions + side-effect JSON schema
5. Claude API call made server-side; response streamed back to client via Server-Sent Events
6. Server parses structured side-effect JSON block from Claude response (e.g., `add_study_blocks`, `breakdown_task`)
7. Side-effects written to PostgreSQL; session event logged; updated state returned alongside stream

### 3.3 ICS Calendar Sync Flow

1. Student pastes Canvas ICS URL during onboarding step 3 → `POST /api/ics/connect  { icsUrl }`
2. Server fetches `.ics` file from `canvas.uw.edu` using Axios; validates content-type
3. ical.js parses VEVENT blocks: extracts SUMMARY, DTSTART, DTEND, DESCRIPTION, UID
4. Events upserted into `tasks` and `schedule_blocks` tables using UID as deduplication key
5. ICS URL stored in `users` table; background job re-fetches every 6 hours to catch new assignments
6. Client receives `{ synced: N, courses: [...] }` — frontend updates Context from API on next launch

> ⚠️ Canvas ICS feeds include assignment due dates and calendar events but NOT grades. Grade tracking requires Canvas OAuth and is out of scope for this MVP.

### 3.4 Authentication Flow

1. App launches → SecureStore checked for existing valid JWT
2. If missing or expired → login screen presented (email + password form)
3. User submits credentials → `POST /api/auth/login`
4. Server looks up user by email, verifies password with `bcrypt.compare()`
5. On success: server signs a JWT with `JWT_SECRET` (payload: user id + email); returns `{ token, user }`
6. JWT stored in SecureStore on the client
7. All subsequent requests include `Authorization: Bearer {token}`; middleware rejects expired or invalid tokens with 401
8. New users register via `POST /api/auth/register` — password hashed with bcrypt (saltRounds: 12) before storage

---

## 4. Database Design

PostgreSQL hosted on Azure Database for PostgreSQL Flexible Server. All primary keys are UUIDs generated server-side. All timestamps are `TIMESTAMPTZ` (timezone-aware). Migrations managed with node-postgres (`pg`) migration scripts.

### 4.1 Entity Overview

| Table | Description |
|-------|-------------|
| users | Core profile: email, password_hash, major, enrollment status, ICS URL, onboarding state, push token |
| courses | Courses extracted from ICS feed or manually entered; tied to a quarter/year |
| tasks | All assignments and to-dos: from ICS, syllabus parsing, manual entry, or AI generation |
| task_subtasks | AI-generated subtask breakdowns (smart task breakdown feature) |
| schedule_blocks | Time blocks: classes, study sessions, commitments; source-tagged |
| syllabi | Raw extracted text per course per quarter; used for RAG Q&A |
| major_requirements | Scraped UW capacity-constrained major data: prereqs, deadlines, steps |
| student_major_goals | Student's declared major intent(s) + application deadline + checklist progress; multiple active goals supported |
| chat_sessions | One row per app session; links to session_events |
| session_events | Granular interaction log for user study analysis |
| notifications | Scheduled proactive alerts: type, scheduled_for, delivered_at, dismissed_at |

### 4.2 Schema Definitions

#### users
```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
email               TEXT UNIQUE NOT NULL
password_hash       TEXT NOT NULL                 -- bcrypt hash, saltRounds: 12
display_name        TEXT NOT NULL
major               TEXT
enrollment_status   TEXT                          -- 'pre-major' | 'in-major'
ics_url             TEXT                          -- Canvas calendar feed URL
ics_last_synced     TIMESTAMPTZ
onboarding_complete BOOLEAN DEFAULT false
notif_active        BOOLEAN DEFAULT false
expo_push_token     TEXT                          -- for Expo push delivery
current_quarter     TEXT                          -- e.g. 'Spring 2026'
created_at          TIMESTAMPTZ DEFAULT now()
last_active         TIMESTAMPTZ DEFAULT now()
```

#### courses
```sql
id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id       UUID REFERENCES users(id) ON DELETE CASCADE
name          TEXT NOT NULL                       -- actual column is 'name', not 'title'
code          TEXT                                -- e.g. 'INFO 201'
quarter       TEXT                                -- e.g. 'Spring 2026'
color         TEXT                                -- hex color for UI
source        TEXT DEFAULT 'ics'                  -- 'ics' | 'manual'
created_at    TIMESTAMPTZ DEFAULT now()
-- No UNIQUE constraint on (user_id, name) — dedup via SELECT-first in app layer
```

#### tasks
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id         UUID REFERENCES users(id) ON DELETE CASCADE
course_id       UUID REFERENCES courses(id) ON DELETE SET NULL
title           TEXT NOT NULL
due_date        TIMESTAMPTZ
weight          NUMERIC(4,2) DEFAULT 1.0          -- heat map weight (exam=3, paper=2.5, quiz=1, reading=0.5)
source          TEXT                              -- 'ics' | 'syllabus' | 'manual' | 'ai'
ics_uid         TEXT                              -- Canvas UID for deduplication
done            BOOLEAN DEFAULT false
highlighted     BOOLEAN DEFAULT false
created_at      TIMESTAMPTZ DEFAULT now()
-- No UNIQUE constraint on ics_uid — dedup via SELECT WHERE user_id + ics_uid in app layer
```

#### task_subtasks
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
task_id         UUID REFERENCES tasks(id) ON DELETE CASCADE
title           TEXT NOT NULL
suggested_start TIMESTAMPTZ                       -- Claude-suggested time to work on this
done            BOOLEAN DEFAULT false
sort_order      INTEGER DEFAULT 0
```

#### schedule_blocks
```sql
id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id       UUID REFERENCES users(id) ON DELETE CASCADE
course_id     UUID REFERENCES courses(id) ON DELETE SET NULL
title         TEXT NOT NULL
start_time    TIMESTAMPTZ NOT NULL
end_time      TIMESTAMPTZ NOT NULL
block_type    TEXT DEFAULT 'study'                -- 'class' | 'study' | 'commitment' | 'other'
source        TEXT DEFAULT 'manual'               -- 'ics' | 'manual' | 'ai_generated'
color         TEXT
created_at    TIMESTAMPTZ DEFAULT now()
CONSTRAINT schedule_blocks_end_after_start CHECK (end_time > start_time)
```

#### syllabi
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id         UUID REFERENCES users(id) ON DELETE CASCADE
course_id       UUID REFERENCES courses(id) ON DELETE CASCADE
quarter         TEXT NOT NULL                     -- e.g. 'Spring 2026'
blob_url        TEXT                              -- Azure Blob Storage URL
extracted_text  TEXT                              -- full text for RAG injection
parse_status    TEXT DEFAULT 'pending'            -- 'pending' | 'extracting' | 'ready' | 'failed'
parsed_at       TIMESTAMPTZ
UNIQUE(user_id, course_id, quarter)
```

#### major_requirements
```sql
id                    UUID PRIMARY KEY DEFAULT gen_random_uuid()
major_name            TEXT NOT NULL               -- e.g. 'Informatics', 'Computer Science'
department            TEXT
source_url            TEXT                        -- UW page this was scraped from
application_deadline  TEXT                        -- e.g. 'March 1 of sophomore year'
min_gpa               NUMERIC(3,2)
prereqs               JSONB                       -- [{ course: 'MATH 126', min_grade: '2.0' }]
checklist_steps       JSONB                       -- ordered array of application steps
last_scraped          TIMESTAMPTZ
notes                 TEXT
```

#### student_major_goals
```sql
id                    UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id               UUID REFERENCES users(id) ON DELETE CASCADE
major_req_id          UUID REFERENCES major_requirements(id)
status                TEXT NOT NULL DEFAULT 'active'  -- 'active' | 'dropped' | 'achieved'
declared_at           TIMESTAMPTZ DEFAULT now()
updated_at            TIMESTAMPTZ DEFAULT now()
application_deadline  TIMESTAMPTZ                 -- confirmed by student or from major_requirements
checklist_progress    JSONB                       -- { step_id: bool } completion map
reminder_30d_sent     BOOLEAN DEFAULT false
reminder_7d_sent      BOOLEAN DEFAULT false
reminder_1d_sent      BOOLEAN DEFAULT false
-- No UNIQUE(user_id): multiple concurrent active goals are supported.
-- Duplicate-major guard enforced at app layer:
--   SELECT 1 WHERE user_id=$1 AND major_req_id=$2 AND status='active' before INSERT.
```

#### chat_sessions
```sql
id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id       UUID REFERENCES users(id) ON DELETE CASCADE
flow          TEXT                                -- 'planning' | 'proactive' | 'advising' | 'quarter_planning' | 'free'
platform      TEXT                                -- 'ios' | 'android'
app_version   TEXT
started_at    TIMESTAMPTZ DEFAULT now()
ended_at      TIMESTAMPTZ
duration_s    INTEGER                             -- computed on session end
```

#### session_events
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
session_id      UUID REFERENCES chat_sessions(id) ON DELETE CASCADE
user_id         UUID REFERENCES users(id) ON DELETE CASCADE
event_type      TEXT NOT NULL
                -- 'chat_turn' | 'task_completed' | 'study_block_added'
                -- | 'heat_map_toggled' | 'task_breakdown_requested'
                -- | 'on_track_check' | 'nudge_dismissed' | 'syllabus_uploaded'
                -- | 'ics_synced' | 'major_goal_set' | 'notif_tapped'
                -- | 'session_start' | 'session_end'
metadata        JSONB                             -- event-specific payload (no PII)
occurred_at     TIMESTAMPTZ DEFAULT now()
```

#### notifications
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id         UUID REFERENCES users(id) ON DELETE CASCADE
type            TEXT                              -- 'morning_digest' | 'deadline_reminder'
                                                  -- | 'start_this_now' | 'major_app_reminder'
title           TEXT NOT NULL
body            TEXT NOT NULL
scheduled_for   TIMESTAMPTZ NOT NULL
delivered_at    TIMESTAMPTZ
dismissed_at    TIMESTAMPTZ
related_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL
```

---

## 5. API Reference

**Base URL:** `https://u-wick-api-hxaketgeedg9cjcr.centralus-01.azurewebsites.net/api`

All routes require `Authorization: Bearer {jwt}` unless marked **Public**. All bodies are `application/json`.

### 5.1 Auth

| Method + Path | Auth | Description |
|---------------|------|-------------|
| `POST /auth/register` | Public | Create account: `{ email, password, display_name }` → `{ token, user }`. Password hashed with bcrypt (saltRounds: 12). |
| `POST /auth/login` | Public | `{ email, password }` → `{ token, user }`. Verifies bcrypt hash; signs JWT with `JWT_SECRET`. |
| `DELETE /auth/logout` | Yes | Invalidate current session (client drops token from SecureStore). |

### 5.2 User & Onboarding

| Method + Path | Auth | Description |
|---------------|------|-------------|
| `GET /users/me` | Yes | Full user profile + `onboarding_complete` flag + `current_quarter` |
| `PATCH /users/me` | Yes | Update `major`, `enrollment_status`, `display_name`, `current_quarter` |
| `POST /users/me/onboarding/complete` | Yes | Persist `onboarding_complete = true` |
| `GET /users/me/dashboard` | Yes | Aggregate: today's tasks, schedule blocks, active nudges, heat scores |
| `PATCH /users/me/push-token` | Yes | Store Expo push token after notification permission granted |

### 5.3 ICS / Canvas Calendar

| Method + Path | Auth | Description |
|---------------|------|-------------|
| `POST /ics/connect` | Yes | Store ICS URL, trigger initial sync, return `{ synced, courses }` |
| `POST /ics/sync` | Yes | Manual re-sync; also runs automatically every 6 hours via cron |
| `GET /ics/status` | Yes | `{ connected: bool, last_synced, course_count, task_count }` |
| `DELETE /ics/disconnect` | Yes | Remove ICS URL; soft-delete ICS-sourced tasks |

### 5.4 Tasks

| Method + Path | Auth | Description |
|---------------|------|-------------|
| `GET /tasks` | Yes | List tasks (query: `?done=false`, `?course_id=`, `?due_before=`, `?limit=`) |
| `POST /tasks` | Yes | Create manual task; optionally trigger AI subtask breakdown |
| `PATCH /tasks/:id` | Yes | Toggle done, update title/due_date/weight, set highlighted |
| `DELETE /tasks/:id` | Yes | Hard delete (manual tasks only); ICS tasks are soft-deleted |
| `GET /tasks/:id/subtasks` | Yes | Return Claude-generated subtask breakdown for a task |
| `POST /tasks/:id/breakdown` | Yes | Trigger Claude to generate subtasks; stores in task_subtasks |

### 5.5 Schedule

| Method + Path | Auth | Description |
|---------------|------|-------------|
| `GET /schedule` | Yes | Blocks in range (query: `?start=&end=` as ISO8601 dates) |
| `POST /schedule/blocks` | Yes | Create one or more blocks (accepts single object or array) |
| `PATCH /schedule/blocks/:id` | Yes | Update `title`, `start_time`, `end_time`, `color` |
| `DELETE /schedule/blocks/:id` | Yes | Remove a block |
| `GET /schedule/heat` | Yes | Heat scores per week (query: `?start=&weeks=8`); returns `[{week_start, raw_score, normalized, label, color}]` |

### 5.6 Chat

| Method + Path | Auth | Description |
|---------------|------|-------------|
| `POST /chat` | Yes | Send message; returns SSE stream of Claude response + side-effect event |
| `GET /chat/history` | Yes | Conversation history (query: `?flow=planning&limit=50`) |
| `DELETE /chat/history` | Yes | Clear history for a given flow mode |

### 5.7 Syllabus

| Method + Path | Auth | Description |
|---------------|------|-------------|
| `POST /syllabus/upload` | Yes | Upload PDF (multipart); returns `{ jobId }`; triggers async extract |
| `GET /syllabus/status/:jobId` | Yes | Poll extraction status: `pending \| extracting \| ready \| failed` |
| `POST /syllabus/confirm/:jobId` | Yes | Confirm extracted tasks + store full text in syllabi table |
| `GET /syllabus` | Yes | List all syllabi for current quarter with course associations |

### 5.8 Major Advising

| Method + Path | Auth | Description |
|---------------|------|-------------|
| `GET /majors` | Yes | List all capacity-constrained majors in DB (name, dept, deadline) |
| `GET /majors/:id` | Yes | Full major detail: prereqs, checklist_steps, application_deadline, notes |
| `POST /goals/major` | Yes | Student declares major intent; creates `student_major_goals` row. Rejects duplicate active goal for same major (app-layer guard). |
| `GET /goals/major` | Yes | Return all of student's major goals (default: `status=active`). Accepts optional `?status=dropped\|achieved\|all` query param. |
| `PATCH /goals/major/:id` | Yes | Update `status` (`'dropped'` \| `'achieved'`) or `application_deadline`. |
| `PATCH /goals/major/:id/checklist` | Yes | Update `checklist_progress` for a step (student or Claude side-effect). |

### 5.9 Session Logging

| Method + Path | Auth | Description |
|---------------|------|-------------|
| `POST /sessions/start` | Yes | Create `chat_sessions` row; return `session_id` for this launch |
| `POST /sessions/event` | Yes | Log a session_event `{ event_type, metadata }` |
| `POST /sessions/end` | Yes | Mark session closed; record duration |
| `GET /sessions/export` | Admin | CSV export of all session_events for research analysis (admin JWT) |

---

## 6. Claude AI Integration

The Claude API (`claude-sonnet-4-20250514`) is the intelligence layer for all chat interactions. All API calls are made exclusively server-side. The Anthropic API key is stored as an Azure App Service environment variable and is never transmitted to the client.

### 6.1 Dynamic System Prompt Architecture

Rather than a static system prompt, U-Wick assembles a fresh context block on every request by querying the database for the student's current state.

```
SYSTEM PROMPT STRUCTURE (assembled per request)
────────────────────────────────────────────────
1. Role:        U-Wick AI assistant for UW students; concise, warm, practical
2. Date/Time:   Current timestamp + student's local timezone
3. Student:     Name, major, enrollment status, current quarter
4. Courses:     Active courses this quarter from ICS sync
5. Tasks:       Incomplete tasks due in next 14 days (title, course, due date, weight)
6. Schedule:    Existing blocks for next 7 days (to avoid scheduling conflicts)
7. Syllabi:     Full extracted text for current quarter courses (RAG injection)
8. Major Goals: All active goals — target major, deadline, checklist progress for each
9. Flow Mode:   Active instructions for current conversation mode
10. Side-Effect Schema: JSON format Claude must use when taking actions
11. Guardrails: Stay academic; no medical/legal advice; flag mental health resources
```

> ⚠️ Syllabus text injection means system prompts can be large. Monitor token usage. If a student has 5 courses with dense syllabi, consider injecting only the top 3 most relevant syllabi based on which courses have tasks due soonest. Similarly, for students with multiple active major goals, inject only the checklist steps not yet marked complete in `checklist_progress` rather than the full step list.

### 6.2 Flow Modes

| Flow Mode | Trigger | Claude Behavior | Expected Side-Effects |
|-----------|---------|-----------------|----------------------|
| `planning` | Default on Chat tab | Builds or refines the student's weekly study schedule. Asks about commitments, preferred study times, urgency. | `add_study_blocks`, `breakdown_task` |
| `proactive` | Home alert 'Let's Chat' button | Surfaces upcoming risks: overloaded weeks, missing study blocks for big assignments, major app deadlines. | `schedule_alert`, `update_checklist` |
| `advising` | Student asks about major, prereqs, syllabus policy | Answers questions about capacity-constrained major requirements or syllabus content using injected RAG data. | (none typically) |
| `quarter_planning` | Start of quarter trigger or student request | Maps out the full quarter: identifies heavy weeks, suggests when to start major assignments, builds a master schedule. | `add_study_blocks` (bulk), `schedule_alert` (bulk) |
| `free` | General questions | Open-ended. Handles 'am I on track?', 'what should I study tonight?', workload check-ins. | `complete_task`, `add_task` |

### 6.3 Structured Side-Effects

Claude is instructed via the system prompt to append a JSON block at the end of responses that require real-world actions. The server parses this block after streaming completes and applies the corresponding database mutations.

| Action | DB Mutation | Frontend Effect |
|--------|-------------|-----------------|
| `add_study_blocks` | INSERT into `schedule_blocks` (source = `ai_generated`) | Calendar UI refreshes; heat map score recalculates |
| `breakdown_task` | INSERT into `task_subtasks` for given `task_id` | Task row expands to show subtask checklist |
| `complete_task` | UPDATE `tasks SET done = true` | Task moves to completed section |
| `add_task` | INSERT into `tasks` (source = `ai`) | New task appears in pending list |
| `schedule_alert` | INSERT into `notifications` (type, scheduled_for) | Notification queued for background delivery |
| `update_checklist` | UPDATE `student_major_goals` `checklist_progress` WHERE `id = goal_id` | Major advising checklist updates in UI (`goal_id` required in payload) |
| `set_notif_active` | UPDATE `users SET notif_active = true` | Notification permission flow triggered on client |

**Side-Effect Envelope Example:**
```json
{
  "action": "add_study_blocks",
  "payload": [
    {
      "title": "Study: MATH 126 Midterm",
      "start": "2026-04-23T14:00:00-07:00",
      "end": "2026-04-23T16:00:00-07:00",
      "block_type": "study",
      "color": "#6AF7C8"
    }
  ]
}
```

### 6.4 Streaming Response (SSE)

`POST /api/chat` streams Claude's response back to the client via Server-Sent Events. A final SSE event of type `side_effects` delivers the parsed action block so the client can apply optimistic local state updates before the server confirms persistence.

```
data: { type: 'token',        content: '...' }   -- streamed text chunk
data: { type: 'side_effects', actions: [...] }   -- parsed action block
data: { type: 'done' }                           -- stream complete
```

### 6.5 Syllabus RAG (Q&A Memory)

When a student uploads a syllabus, the full extracted text is stored in the `syllabi` table for that course and quarter. On every chat request, the server retrieves all syllabus texts for the student's current quarter courses and injects them into the Claude system prompt — enabling questions like 'What's the late policy for INFO 201?' without the student needing to re-explain.

> ✅ Current quarter only. Past syllabi are not injected. This keeps token usage manageable and focuses Claude on what's immediately relevant.

---

## 7. Workload Heat Map

### 7.1 Purpose

The heat map gives students a visual signal of which weeks in the quarter are going to be most demanding. It appears as a thin colored bar above the weekly calendar view and can be toggled off.

### 7.2 Heat Score Calculation

```sql
-- Raw score for a week:
SELECT SUM(weight) AS raw_score
FROM tasks
WHERE user_id = $1
  AND done = false
  AND due_date >= week_start
  AND due_date <  week_start + INTERVAL '7 days'

-- Normalize: score / MAX(score across all weeks)
-- Map to label:
--   0.00 – 0.25  →  'light'     (#6AF7C8 teal)
--   0.25 – 0.55  →  'moderate'  (#F7D06A yellow)
--   0.55 – 0.80  →  'heavy'     (#F7A06A orange)
--   0.80 – 1.00  →  'intense'   (#F76A6A red)
```

### 7.3 Task Weight Reference

| Task Type (Claude-assigned) | Weight |
|-----------------------------|--------|
| Final exam / final project | 3.0 |
| Midterm exam | 2.5 |
| Major paper / large project (>5 pages) | 2.5 |
| Lab report / medium assignment | 1.5 |
| Quiz / short assignment | 1.0 |
| Weekly reading / participation | 0.5 |
| Default (unclassified) | 1.0 |

Claude assigns weight during syllabus parsing and task creation side-effects. The `weight` field can also be manually overridden via `PATCH /tasks/:id`.

### 7.4 API Response

```
GET /api/schedule/heat?start=2026-03-30&weeks=10
```

```json
[
  { "week_start": "2026-03-30", "raw_score": 1.5,  "normalized": 0.12, "label": "light",    "color": "#6AF7C8" },
  { "week_start": "2026-04-06", "raw_score": 7.0,  "normalized": 0.54, "label": "moderate", "color": "#F7D06A" },
  { "week_start": "2026-04-13", "raw_score": 12.5, "normalized": 0.96, "label": "intense",  "color": "#F76A6A" }
]
```

---

## 8. Capacity-Constrained Major Advising

### 8.1 Overview

Students applying to competitive majors at UW face strict prerequisites, GPA requirements, and application deadlines that are easy to miss. U-Wick stores this information in a curated database and uses Claude to guide students proactively through the application process.

### 8.2 Data Collection Strategy

Targeted one-time web scrape of known UW department pages using Cheerio + Axios. Scraped data is stored in `major_requirements` and manually reviewed before deployment. The scraper is a setup step run once, updated manually each academic year.

| Major | Source URL to Scrape |
|-------|---------------------|
| Informatics (iSchool) | ischool.uw.edu/programs/informatics/admission |
| Computer Science (Allen School) | cs.washington.edu/academics/ugrad/admissions |
| Electrical & Computer Engineering | ece.uw.edu/undergraduate/admissions |
| Foster School of Business | foster.uw.edu/academics/degree-programs/undergraduate/admission |
| Human Centered Design & Eng. | hcde.washington.edu/bs/admissions |
| Communication | com.uw.edu/undergraduate/application-information |

> ⚠️ UW department pages change without notice. Manually verify all scraped data before the user study. The `last_scraped` and `notes` fields exist to flag entries that need review.

### 8.3 Student Major Goal Flow

1. During onboarding (or any time via chat), student indicates they are applying to a capacity-constrained major
2. `POST /api/goals/major` creates a `student_major_goals` row (`status = 'active'`) linked to the matching `major_requirements` entry. Multiple active goals are supported. Server guards against duplicate active goals for the same major before inserting.
3. Claude injects all active major goal checklists into the system prompt, and can reason across them (e.g. 'MATH 126 satisfies a prereq for both CS and Informatics')
4. As the student completes steps, Claude's `update_checklist` side-effect calls `PATCH /goals/major/:id/checklist`
5. To abandon a goal: `PATCH /goals/major/:id` with `{ status: 'dropped' }`. Row retained for research history.
6. Background cron checks deadlines for each active goal independently and triggers push notifications

### 8.4 Proactive Reminder Logic

```
-- node-cron job runs daily at 9:00am
-- For each student_major_goals row WHERE status = 'active':

IF application_deadline - NOW() <= 30 days AND reminder_30d_sent = false:
   send push: '30 days until your [Major] application deadline'
   set reminder_30d_sent = true

IF application_deadline - NOW() <= 7 days AND reminder_7d_sent = false:
   send push: '1 week left — here are your remaining checklist steps'
   set reminder_7d_sent = true

IF application_deadline - NOW() <= 1 day AND reminder_1d_sent = false:
   send push: 'Tomorrow is your [Major] application deadline!'
   set reminder_1d_sent = true
```

---

## 9. Proactive Features

### 9.1 'Start This Now' Nudge

Triggers when: a task with `weight >= 2.0` has a `due_date` within 72 hours AND there are no study blocks before that deadline for the same course.

```sql
-- Runs every 6 hours via node-cron
SELECT t.* FROM tasks t
WHERE t.user_id = $1
  AND t.done = false
  AND t.weight >= 2.0
  AND t.due_date BETWEEN NOW() AND NOW() + INTERVAL '72 hours'
  AND NOT EXISTS (
    SELECT 1 FROM schedule_blocks sb
    WHERE sb.user_id = t.user_id
      AND sb.course_id = t.course_id
      AND sb.block_type = 'study'
      AND sb.start_time < t.due_date
  )
```

### 9.2 'Am I On Track?' Check

Claude reasoning feature — not a cron job. The server injects the student's task completion rate for the current week (tasks completed / tasks due) alongside schedule density. Claude responds conversationally and may suggest adding study blocks as a side-effect.

### 9.3 Morning Digest

Daily push notification at 8:00am in the student's local timezone. Server queries tasks due today and tomorrow, formats a brief summary (e.g., '3 things due today · MATH midterm tomorrow'), and delivers via Expo Push Notification Service. No Claude call needed.

### 9.4 Quarter Planning Mode

Triggered at the start of a new quarter or when the student asks Claude to 'plan my quarter.' Claude receives all tasks for the quarter, identifies heavy weeks from heat map data, and bulk-generates study blocks. Produces a large batch of `add_study_blocks` side-effects — the server handles array inserts.

---

## 10. User Study Session Logging

### 10.1 Purpose

The capstone study compares U-Wick against Wick with 20–50 UW student participants. Session logging provides objective behavioral data to complement post-session surveys.

### 10.2 What Gets Logged

| Event Type | metadata fields | Research Question |
|------------|-----------------|-------------------|
| `chat_turn` | `{ flow, message_length, response_time_ms, side_effects_triggered }` | How often do students use the chatbot? Which flows? |
| `task_completed` | `{ task_id, source, time_since_created_ms }` | Does U-Wick drive higher task completion rates? |
| `study_block_added` | `{ source: 'chat' \| 'manual', duration_min }` | Do students plan more via chat or manually? |
| `heat_map_toggled` | `{ new_state: bool }` | Is the heat map feature actually used? |
| `task_breakdown_requested` | `{ task_id, subtask_count_returned }` | Does smart breakdown reduce overwhelm? |
| `on_track_check` | `{ completion_rate, claude_verdict }` | How often do students self-check? |
| `nudge_dismissed` | `{ notification_type, time_to_dismiss_ms }` | Are proactive nudges annoying or useful? |
| `syllabus_uploaded` | `{ course_id, tasks_extracted }` | Adoption of syllabus feature |
| `ics_synced` | `{ tasks_imported, courses_found }` | Canvas integration usage |
| `major_goal_set` | `{ major_name }` | Major advising feature adoption |
| `session_start / end` | `{ platform, app_version, duration_s }` | Overall session length comparison |

### 10.3 Implementation

```js
// src/middleware/logger.js
async function logEvent(userId, sessionId, eventType, metadata = {}) {
  // Non-blocking — do not await this in route handlers
  db.query(
    'INSERT INTO session_events (session_id, user_id, event_type, metadata) VALUES ($1, $2, $3, $4)',
    [sessionId, userId, eventType, JSON.stringify(metadata)]
  ).catch(err => console.error('logEvent failed:', err));
}
```

### 10.4 Research Export

`GET /api/sessions/export` (admin JWT required) returns a CSV of all `session_events` joined with user metadata, anonymized to `participant_id` (no names or emails).

---

## 11. Syllabus Upload & Parsing Pipeline

1. Student selects PDF via Expo Document Picker → `POST /api/syllabus/upload` (multipart/form-data)
2. Server validates: PDF MIME type only, max 10 MB. Uploads to Azure Blob Storage. Returns `{ jobId }`.
3. Async job: Azure Document Intelligence extracts raw text from all PDF pages
4. Extracted text passed to Claude: extract all assignments, exams, quizzes, and due dates as `[{ title, due_date, type, weight_hint }]`. Also return full syllabus text verbatim.
5. Server validates date formats, normalizes to UTC. Job status set to `'ready'`.
6. Frontend polls `GET /api/syllabus/status/:jobId` until ready.
7. Student reviews extracted task list. `POST /api/syllabus/confirm/:jobId` → tasks inserted (source = `'syllabus'`); full text stored in `syllabi` table for RAG.

> ⚠️ Expo Document Picker and real file handling are not yet implemented in the frontend prototype. This is a required frontend addition before the syllabus pipeline can be tested end-to-end.

---

## 12. Frontend Integration Notes

### 12.1 Gap Resolution Table

| Frontend Gap | Backend Fix | Frontend Change Required |
|--------------|-------------|--------------------------|
| Onboarding not persisted on restart | `POST /users/me/onboarding/complete` sets DB flag | Call endpoint on wizard completion; write flag to AsyncStorage |
| Task state resets on restart | `GET /tasks` populates state on app launch | Replace mock-state.ts with API call in AppContext initializer |
| Study blocks session-only | `POST /schedule/blocks` persists after Claude side-effect | useChatEngine sends side-effects to server; refetch from API |
| Canvas connection simulated | `POST /ics/connect` stores URL + syncs real ICS data | Replace simulated OAuth UI with ICS URL paste input in onboarding step 3 |
| No auth layer | bcrypt + JWT; login screen before (onboarding) | Add login/register screen; store JWT in SecureStore |
| Chat is fully scripted | `POST /chat` streams real Claude responses via SSE | Update useChatEngine to consume SSE stream instead of script steps |
| No environment variable setup | API base URL as `EXPO_PUBLIC_API_URL` | Add `.env.local`; update all fetch calls to use env variable |
| No loading or error states | All endpoints return `{ error, message }` on failure | Add loading spinners + error toasts to each API-connected screen |
| Voice/attach buttons not wired | `POST /chat` accepts text only (MVP) | Mark buttons as coming-soon or hide for user study build |

### 12.2 AppContext Migration Plan

Split the current single AppContext into two concerns:
- **Server state** (tasks, schedule, courses, user profile, syllabus list) — fetched via API on launch and on screen focus; cached in context
- **UI state** (alert dismissed, active chat flow, heat map toggle, notification consent status) — remains in React Context or AsyncStorage

### 12.3 Environment Variables

```bash
# .env.local (frontend)
EXPO_PUBLIC_API_URL=https://u-wick-api-hxaketgeedg9cjcr.centralus-01.azurewebsites.net/api

# Azure App Service environment variables (backend — never in code)
DATABASE_URL              # PostgreSQL connection string
ANTHROPIC_API_KEY         # Claude API key
JWT_SECRET                # Secret key for signing/verifying JWTs (min 32 chars, random)
JWT_EXPIRES_IN            # e.g. '30d'
AZURE_BLOB_CONN_STR
AZURE_DOC_INTEL_ENDPOINT
AZURE_DOC_INTEL_KEY
CANVAS_TOKEN_ENCRYPT_KEY  # AES-256 key for any stored tokens
```

---

## 13. Security

| Concern | Mitigation |
|---------|------------|
| API key exposure | Anthropic + Azure keys in Azure App Service env vars only; never in client code or version control |
| JWT signing secret | `JWT_SECRET` stored as Azure App Service env var; min 32 random characters; rotated if compromised |
| JWT validation | All protected routes verify JWT signature and expiry on every request; 401 returned on failure |
| Password storage | bcrypt with saltRounds: 12; raw passwords never logged or stored |
| SQL injection | All queries use parameterized statements via node-postgres (`pg`); no raw string interpolation |
| ICS URL validation | Server-side: only `canvas.uw.edu` domain accepted; URL sanitized before fetch |
| File upload safety | PDF MIME type enforced; max 10 MB; stored in private Azure Blob container |
| Session logging privacy | No PII in `session_events` metadata; export anonymizes users to `participant_id` |
| HTTPS | Azure App Service enforces HTTPS; all HTTP redirected |
| CORS | Express `cors()` restricts origins to Expo app bundle in production |

---

## 14. Deployment & Build Timeline

### 14.1 Azure Infrastructure

| Resource | Configuration |
|----------|---------------|
| Azure App Service | B2 tier (2 vCPU, 3.5 GB RAM) — Node 20 runtime; GitHub Actions auto-deploy on push to main |
| Azure Database for PostgreSQL | Flexible Server, Burstable B1ms — sufficient for 20–50 user study load |
| Azure Blob Storage | Standard LRS — syllabi-uploads container, private access; SAS tokens for temporary read URLs |
| Azure Document Intelligence | F0 tier — sufficient for prototype syllabus parsing |
| Expo EAS Build | Required for push notifications on physical devices (Expo Go does not support push in SDK 54+) |

### 14.2 Build Sequence

| Week | Focus | Deliverables | Status |
|------|-------|--------------|--------|
| Week 1 Days 1–2 | Infrastructure | Azure provisioning, PostgreSQL schema, Express scaffold, health endpoint, CI/CD | ✅ Complete |
| Week 1 Days 3–5 | Auth + User | POST /auth/register, POST /auth/login, JWT middleware, GET/PATCH /users/me, onboarding endpoint | ✅ Complete |
| Week 2 Days 1–2 | ICS + Tasks | POST /ics/connect, ical.js parsing, task + course upsert, GET/PATCH/DELETE /tasks | ✅ Complete |
| Week 2 Days 3–5 | Schedule | All schedule routes + heat map + Jest test suite | ✅ Complete |
| Next | Session Logging | POST /sessions/start, POST /sessions/event, POST /sessions/end, GET /sessions/export | 🔲 Next |
| — | Major Advising | GET /majors, GET /majors/:id, goals routes | 🔲 Pending |
| — | Syllabus Pipeline | Upload → Doc Intelligence → Claude extract → confirm | 🔲 Pending |
| — | Cron + Push | ICS re-sync, start-this-now, morning digest, major reminders, push token route | 🔲 Pending |
| — | Chat | POST /chat SSE + system prompt assembly + side-effect parser | 🔲 Blocked (API key) |

---

## 15. U-Wick vs. Wick: Feature Comparison

| Feature | Wick (Production) | U-Wick (Capstone) | Parity? |
|---------|-------------------|-------------------|---------|
| Canvas / LMS sync | Canvas, Moodle, Blackboard, D2L | Canvas ICS feed (UW-specific) | Near |
| Assignment import | Auto-pull from LMS | ICS feed + syllabus PDF parse | Near |
| AI assistant | Max (proprietary AI, text + voice) | Claude (text only) | Different — primary variable |
| Study schedule planning | AI-generated daily plan | Claude via planning chat flow | Near |
| Proactive SMS reminders | Daily text digest + check-ins | Expo push notifications | Near for prototype |
| Syllabus parsing | Upload → auto-extract deadlines | Upload → Claude extract + confirm | Near — U-Wick adds Q&A memory |
| Workload visibility | Not documented | Heat map bar on calendar | U-Wick advantage |
| Major advising | Not documented | Capacity-constrained major DB + proactive reminders | U-Wick advantage |
| 'Am I on track?' | Not documented | Claude reasoning on task completion rate | U-Wick advantage |
| Smart task breakdown | Not documented | Claude-generated subtask checklist | U-Wick advantage |
| Focus / Pomodoro timer | Built-in | Not in MVP | Wick advantage |
| Google Calendar sync | Yes | Not in MVP | Wick advantage |
| Platform | iOS + Android native | React Native / Expo (iOS + Android) | Equivalent |

---

## 16. Open Questions & Risks

| Risk / Question | Status & Recommendation |
|-----------------|-------------------------|
| EAS Build for push notifications | Expo Go does not support push in SDK 54+. Must use EAS Build for physical device testing. Set this up early to avoid a late blocker. |
| Claude system prompt token budget | With 5 syllabi injected, system prompts may exceed 8K tokens. Monitor with Anthropic's token counting API. Mitigation: inject only syllabi for courses with tasks due in the next 14 days. |
| UW department page structure for scraping | Manually verify all target URLs before scraping. Some departments use PDFs instead of HTML — these require Document Intelligence extraction instead of Cheerio. |
| ICS feed update frequency | Canvas ICS feeds must be polled, not pushed. Every-6-hours cron is sufficient. Up to 6-hour lag on manually added assignments. |
| Canvas ICS URL privacy | The ICS URL is a secret token. Store it encrypted in the DB using `CANVAS_TOKEN_ENCRYPT_KEY` and never log it. |
| IRB approval for user study logging | Check with your capstone advisor whether logging student interaction data requires UW IRB approval. Can take 2–4 weeks. |
| Team size vs. scope | 2–3 people, 2–3 weeks is aggressive. A working chat + ICS + task persistence is a better user study than a broken feature-complete app. |
| Multiple active major goals — Claude prompt size | With 2–3 active goals this is manageable. If token budget is tight, inject only incomplete checklist steps rather than the full list. |
| JWT secret rotation | If `JWT_SECRET` is ever compromised, all existing tokens are immediately invalidated — all users will be logged out. Keep the secret out of version control. |

---

*U-Wick Backend Design Document v2.1 · FifthGear · UW Capstone 2026*  
*Built in partnership with Maximal Learning, Inc. · wick.app*
