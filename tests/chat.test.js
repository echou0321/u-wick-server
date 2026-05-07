require('dotenv').config();

// Mock Anthropic SDK before any imports
let mockResponseText = 'Here is your study plan for the week.';

const mockStream = {
  on: jest.fn().mockImplementation(function (event, cb) {
    if (event === 'text') cb(mockResponseText);
    return this;
  }),
  finalMessage: jest.fn().mockResolvedValue({}),
};

jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({
    messages: { stream: jest.fn().mockReturnValue(mockStream) },
  }))
);

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const TEST_EMAIL = 'test@uw.edu';
const TEST_PASSWORD = 'password123';

let token;
let userId;
let createdTaskId;
let createdGoalId;
let createdNotificationIds = [];
let createdSubtaskTaskId;
let createdAiTaskIds = [];

function parseSSEEvents(text) {
  return text
    .split('\n\n')
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice('data: '.length)));
}

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  token = res.body.token;
  userId = res.body.user.id;

  // Seed a task for breakdown_task + complete_task side-effect tests
  const taskRes = await db.query(
    `INSERT INTO tasks (user_id, title, source) VALUES ($1, 'Test Task for Side Effects', 'manual') RETURNING id`,
    [userId]
  );
  createdTaskId = taskRes.rows[0].id;
  createdSubtaskTaskId = createdTaskId;

  // Seed a major goal for update_checklist side-effect test
  const majorRes = await db.query(
    `SELECT id FROM major_requirements LIMIT 1`
  );
  if (majorRes.rows.length) {
    const goalRes = await db.query(
      `INSERT INTO student_major_goals (user_id, major_req_id, checklist_progress)
       VALUES ($1, $2, '{}') RETURNING id`,
      [userId, majorRes.rows[0].id]
    );
    createdGoalId = goalRes.rows[0].id;
  }
});

afterAll(async () => {
  await db.query('DELETE FROM chat_messages WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM task_subtasks WHERE task_id = $1', [createdSubtaskTaskId]);
  if (createdAiTaskIds.length) {
    await db.query('DELETE FROM tasks WHERE id = ANY($1)', [createdAiTaskIds]);
  }
  if (createdNotificationIds.length) {
    await db.query('DELETE FROM notifications WHERE id = ANY($1)', [createdNotificationIds]);
  }
  if (createdGoalId) {
    await db.query('DELETE FROM student_major_goals WHERE id = $1', [createdGoalId]);
  }
  await db.query('DELETE FROM tasks WHERE id = $1', [createdTaskId]);
  await db.end();
});

beforeEach(() => {
  mockResponseText = 'Here is your study plan for the week.';
});

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------
describe('POST /api/chat', () => {
  it('401 with no auth', async () => {
    const res = await request(app).post('/api/chat').send({ message: 'hi' });
    expect(res.status).toBe(401);
  });

  it('400 when message is missing', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ flow: 'free' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/i);
  });

  it('400 for invalid flow', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'hello', flow: 'invalid_flow' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/flow/i);
  });

  it('200 streams SSE with token and done events', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'What should I study tonight?', flow: 'free' })
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const events = parseSSEEvents(res.text);
    expect(events.some(e => e.type === 'token')).toBe(true);
    expect(events[events.length - 1].type).toBe('done');
  });

  it('saves user and assistant messages to DB', async () => {
    const { rows } = await db.query(
      `SELECT role, content FROM chat_messages
       WHERE user_id = $1 AND flow = 'free'
       ORDER BY created_at DESC LIMIT 2`,
      [userId]
    );
    const roles = rows.map(r => r.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
  });

  it('defaults to free flow when flow is omitted', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Am I on track?' })
      .buffer(true);
    expect(res.status).toBe(200);
    const events = parseSSEEvents(res.text);
    expect(events[events.length - 1].type).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// GET /api/chat/history
// ---------------------------------------------------------------------------
describe('GET /api/chat/history', () => {
  it('401 with no auth', async () => {
    const res = await request(app).get('/api/chat/history');
    expect(res.status).toBe(401);
  });

  it('400 for invalid flow', async () => {
    const res = await request(app)
      .get('/api/chat/history?flow=bad_flow')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/flow/i);
  });

  it('200 returns messages in chronological order', async () => {
    const res = await request(app)
      .get('/api/chat/history?flow=free')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    // Verify chronological order
    const timestamps = res.body.map(m => new Date(m.created_at).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it('200 returns all flows when flow omitted', async () => {
    const res = await request(app)
      .get('/api/chat/history')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/chat/history
// ---------------------------------------------------------------------------
describe('DELETE /api/chat/history', () => {
  it('401 with no auth', async () => {
    const res = await request(app).delete('/api/chat/history?flow=free');
    expect(res.status).toBe(401);
  });

  it('400 when flow is missing', async () => {
    const res = await request(app)
      .delete('/api/chat/history')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/flow/i);
  });

  it('400 for invalid flow', async () => {
    const res = await request(app)
      .delete('/api/chat/history?flow=bad_flow')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('200 deletes messages and returns count', async () => {
    const res = await request(app)
      .delete('/api/chat/history?flow=free')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.deleted).toBe('number');
    expect(res.body.deleted).toBeGreaterThan(0);
  });

  it('history is empty after delete', async () => {
    const res = await request(app)
      .get('/api/chat/history?flow=free')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Side-effect: breakdown_task
// ---------------------------------------------------------------------------
describe('side-effect: breakdown_task', () => {
  it('inserts subtasks into task_subtasks', async () => {
    mockResponseText = `Sure! Here is a breakdown. <side_effects>${JSON.stringify({
      action: 'breakdown_task',
      payload: {
        task_id: createdTaskId,
        subtasks: [
          { title: 'Read chapter 1' },
          { title: 'Write outline', suggested_start: '2026-05-10T10:00:00Z' },
        ],
      },
    })}</side_effects>`;

    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Break down my task', flow: 'planning' })
      .buffer(true);
    expect(res.status).toBe(200);

    const { rows } = await db.query(
      'SELECT * FROM task_subtasks WHERE task_id = $1 ORDER BY sort_order',
      [createdTaskId]
    );
    expect(rows.length).toBe(2);
    expect(rows[0].title).toBe('Read chapter 1');
    expect(rows[1].title).toBe('Write outline');
    expect(rows[1].suggested_start).toBeTruthy();
  });

  it('ignores breakdown_task with unknown task_id', async () => {
    mockResponseText = `<side_effects>${JSON.stringify({
      action: 'breakdown_task',
      payload: { task_id: '00000000-0000-0000-0000-000000000000', subtasks: [{ title: 'Ghost' }] },
    })}</side_effects>`;

    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Break down ghost task', flow: 'planning' })
      .buffer(true);
    expect(res.status).toBe(200);
    // No subtasks inserted for ghost task
    const { rows } = await db.query(
      "SELECT * FROM task_subtasks WHERE task_id = '00000000-0000-0000-0000-000000000000'"
    );
    expect(rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Side-effect: add_task
// ---------------------------------------------------------------------------
describe('side-effect: add_task', () => {
  it('inserts a new task with source=ai', async () => {
    mockResponseText = `Added! <side_effects>${JSON.stringify({
      action: 'add_task',
      payload: { title: 'Review lecture slides', due_date: '2026-05-15T23:59:00Z', weight: 1.0 },
    })}</side_effects>`;

    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Add a review task for me', flow: 'free' })
      .buffer(true);
    expect(res.status).toBe(200);

    const { rows } = await db.query(
      `SELECT * FROM tasks WHERE user_id = $1 AND title = 'Review lecture slides' AND source = 'ai'`,
      [userId]
    );
    expect(rows.length).toBe(1);
    createdAiTaskIds.push(rows[0].id);
  });

  it('skips add_task when title is missing', async () => {
    mockResponseText = `<side_effects>${JSON.stringify({
      action: 'add_task',
      payload: { due_date: '2026-05-15T23:59:00Z' },
    })}</side_effects>`;

    const before = await db.query(
      `SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND source = 'ai'`,
      [userId]
    );
    await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Add nothing', flow: 'free' })
      .buffer(true);
    const after = await db.query(
      `SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND source = 'ai'`,
      [userId]
    );
    expect(parseInt(after.rows[0].count)).toBe(parseInt(before.rows[0].count));
  });
});

// ---------------------------------------------------------------------------
// Side-effect: schedule_alert
// ---------------------------------------------------------------------------
describe('side-effect: schedule_alert', () => {
  it('inserts a notification row', async () => {
    mockResponseText = `Alert set! <side_effects>${JSON.stringify({
      action: 'schedule_alert',
      payload: {
        type: 'deadline_reminder',
        title: 'MATH midterm in 3 days',
        body: "Don't forget to study!",
        scheduled_for: '2026-05-12T08:00:00Z',
      },
    })}</side_effects>`;

    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Remind me about my midterm', flow: 'proactive' })
      .buffer(true);
    expect(res.status).toBe(200);

    const { rows } = await db.query(
      `SELECT * FROM notifications WHERE user_id = $1 AND title = 'MATH midterm in 3 days'`,
      [userId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe('deadline_reminder');
    createdNotificationIds.push(rows[0].id);
  });

  it('skips schedule_alert when required fields are missing', async () => {
    mockResponseText = `<side_effects>${JSON.stringify({
      action: 'schedule_alert',
      payload: { title: 'Missing body and scheduled_for' },
    })}</side_effects>`;

    const before = await db.query(
      `SELECT COUNT(*) FROM notifications WHERE user_id = $1`,
      [userId]
    );
    await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Bad alert', flow: 'proactive' })
      .buffer(true);
    const after = await db.query(
      `SELECT COUNT(*) FROM notifications WHERE user_id = $1`,
      [userId]
    );
    expect(parseInt(after.rows[0].count)).toBe(parseInt(before.rows[0].count));
  });
});

// ---------------------------------------------------------------------------
// Side-effect: update_checklist
// ---------------------------------------------------------------------------
describe('side-effect: update_checklist', () => {
  it('updates checklist_progress on a major goal', async () => {
    if (!createdGoalId) return; // skip if no major_requirements seeded

    mockResponseText = `Step marked complete! <side_effects>${JSON.stringify({
      action: 'update_checklist',
      payload: { goal_id: createdGoalId, step_id: 'step_1', done: true },
    })}</side_effects>`;

    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Mark step 1 complete', flow: 'advising' })
      .buffer(true);
    expect(res.status).toBe(200);

    const { rows } = await db.query(
      'SELECT checklist_progress FROM student_major_goals WHERE id = $1',
      [createdGoalId]
    );
    expect(rows[0].checklist_progress.step_1).toBe(true);
  });

  it('skips update_checklist when goal_id is missing', async () => {
    mockResponseText = `<side_effects>${JSON.stringify({
      action: 'update_checklist',
      payload: { step_id: 'step_1', done: true },
    })}</side_effects>`;

    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Update checklist no goal', flow: 'advising' })
      .buffer(true);
    expect(res.status).toBe(200);
    // Just verify it didn't crash — no assertion on DB state needed
  });
});

// ---------------------------------------------------------------------------
// Side-effect: set_notif_active
// ---------------------------------------------------------------------------
describe('side-effect: set_notif_active', () => {
  it('sets notif_active = true on the user', async () => {
    // Reset to false first
    await db.query('UPDATE users SET notif_active = false WHERE id = $1', [userId]);

    mockResponseText = `Notifications enabled! <side_effects>${JSON.stringify({
      action: 'set_notif_active',
    })}</side_effects>`;

    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Enable my notifications', flow: 'free' })
      .buffer(true);
    expect(res.status).toBe(200);

    const { rows } = await db.query(
      'SELECT notif_active FROM users WHERE id = $1',
      [userId]
    );
    expect(rows[0].notif_active).toBe(true);
  });
});
