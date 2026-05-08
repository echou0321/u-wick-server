require('dotenv').config();

// Mock Anthropic SDK before any imports (needed for POST /:id/breakdown)
const mockBreakdownSubtasks = [
  { title: 'Read the chapter', suggested_start: null },
  { title: 'Take notes', suggested_start: null },
  { title: 'Write summary', suggested_start: null },
];

jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockImplementation((params) => {
        if (params.max_tokens <= 16) {
          // tag generation call
          return Promise.resolve({ content: [{ type: 'text', text: 'Essay' }] });
        }
        // breakdown call
        return Promise.resolve({
          content: [{ type: 'text', text: JSON.stringify(mockBreakdownSubtasks) }],
        });
      }),
      stream: jest.fn(),
    },
  }))
);

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const TEST_EMAIL = 'test@uw.edu';
const TEST_PASSWORD = 'password123';

let token;
let userId;
let createdTaskIds = [];

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  if (createdTaskIds.length) {
    await db.query('DELETE FROM task_subtasks WHERE task_id = ANY($1)', [createdTaskIds]);
    await db.query('DELETE FROM tasks WHERE id = ANY($1)', [createdTaskIds]);
  }
  await db.end();
});

// ---------------------------------------------------------------------------
// GET /api/tasks
// ---------------------------------------------------------------------------
describe('GET /api/tasks', () => {
  it('401 with no auth', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  it('200 returns an array', async () => {
    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('filters by done=false', async () => {
    const res = await request(app)
      .get('/api/tasks?done=false')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.every(t => t.done === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks
// ---------------------------------------------------------------------------
describe('POST /api/tasks', () => {
  it('401 with no auth', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'Test' });
    expect(res.status).toBe(401);
  });

  it('400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ due_date: '2026-06-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('404 when course_id does not belong to user', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Task', course_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('201 creates a manual task with AI-generated tag', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Finish essay draft', due_date: '2026-06-15T23:59:00Z', weight: 2.5 });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Finish essay draft');
    expect(res.body.source).toBe('manual');
    expect(parseFloat(res.body.weight)).toBe(2.5);
    expect(res.body).toHaveProperty('tag');
    expect(typeof res.body.tag === 'string' || res.body.tag === null).toBe(true);
    createdTaskIds.push(res.body.id);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/:id
// ---------------------------------------------------------------------------
describe('PATCH /api/tasks/:id', () => {
  let taskId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Task to patch' });
    taskId = res.body.id;
    createdTaskIds.push(taskId);
  });

  it('401 with no auth', async () => {
    const res = await request(app).patch(`/api/tasks/${taskId}`).send({ done: true });
    expect(res.status).toBe(401);
  });

  it('400 with no valid fields', async () => {
    const res = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ unknown_field: true });
    expect(res.status).toBe(400);
  });

  it('200 toggles done', async () => {
    const res = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ done: true });
    expect(res.status).toBe(200);
    expect(res.body.done).toBe(true);
  });

  it('404 for unknown task', async () => {
    const res = await request(app)
      .patch('/api/tasks/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ done: true });
    expect(res.status).toBe(404);
  });

  it('200 updates tag field', async () => {
    const res = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tag: 'Reading' });
    expect(res.status).toBe(200);
    expect(res.body.tag).toBe('Reading');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/:id
// ---------------------------------------------------------------------------
describe('DELETE /api/tasks/:id', () => {
  let taskId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Task to delete' });
    taskId = res.body.id;
    // Don't add to createdTaskIds — this test deletes it
  });

  it('401 with no auth', async () => {
    const res = await request(app).delete(`/api/tasks/${taskId}`);
    expect(res.status).toBe(401);
  });

  it('204 deletes a manual task', async () => {
    const res = await request(app)
      .delete(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  it('404 after deletion', async () => {
    const res = await request(app)
      .delete(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/tasks/:id/subtasks
// ---------------------------------------------------------------------------
describe('GET /api/tasks/:id/subtasks', () => {
  let taskId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Task with subtasks' });
    taskId = res.body.id;
    createdTaskIds.push(taskId);
  });

  it('401 with no auth', async () => {
    const res = await request(app).get(`/api/tasks/${taskId}/subtasks`);
    expect(res.status).toBe(401);
  });

  it('404 for unknown task', async () => {
    const res = await request(app)
      .get('/api/tasks/00000000-0000-0000-0000-000000000000/subtasks')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('200 returns empty array before breakdown', async () => {
    const res = await request(app)
      .get(`/api/tasks/${taskId}/subtasks`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/breakdown
// ---------------------------------------------------------------------------
describe('POST /api/tasks/:id/breakdown', () => {
  let taskId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Research paper on climate change', due_date: '2026-06-20T23:59:00Z' });
    taskId = res.body.id;
    createdTaskIds.push(taskId);
  });

  it('401 with no auth', async () => {
    const res = await request(app).post(`/api/tasks/${taskId}/breakdown`);
    expect(res.status).toBe(401);
  });

  it('404 for unknown task', async () => {
    const res = await request(app)
      .post('/api/tasks/00000000-0000-0000-0000-000000000000/breakdown')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('201 returns subtask list from Claude', async () => {
    const res = await request(app)
      .post(`/api/tasks/${taskId}/breakdown`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(mockBreakdownSubtasks.length);
    expect(res.body[0].title).toBe('Read the chapter');
    expect(res.body[0]).toHaveProperty('sort_order');
  });

  it('GET subtasks returns persisted results after breakdown', async () => {
    const res = await request(app)
      .get(`/api/tasks/${taskId}/subtasks`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(mockBreakdownSubtasks.length);
  });

  it('201 re-running breakdown replaces existing subtasks', async () => {
    const res = await request(app)
      .post(`/api/tasks/${taskId}/breakdown`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);

    const subtasks = await request(app)
      .get(`/api/tasks/${taskId}/subtasks`)
      .set('Authorization', `Bearer ${token}`);
    // Still the same count (no duplicates from re-run)
    expect(subtasks.body.length).toBe(mockBreakdownSubtasks.length);
  });
});
