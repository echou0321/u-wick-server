require('dotenv').config();

jest.mock('../src/lib/syllabusExtract', () => ({
  extractTasksWithClaude: jest.fn().mockResolvedValue([
    { title: 'Midterm Exam', due_date: '2026-05-15', type: 'exam', weight: 2.5 },
    { title: 'Final Paper', due_date: '2026-06-07', type: 'paper', weight: 2.5 },
  ]),
}));

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const TEST_EMAIL = 'test@uw.edu';
const TEST_PASSWORD = 'password123';

let token;
let userId;
let courseId;
let jobId;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  token = res.body.token;
  userId = res.body.user.id;

  const { rows } = await db.query(
    `INSERT INTO courses (user_id, name, code, quarter, source)
     VALUES ($1, 'Test Syllabus Course', 'TSC 101', 'Spring 2026', 'manual')
     RETURNING id`,
    [userId]
  );
  courseId = rows[0].id;
});

afterAll(async () => {
  await db.query('DELETE FROM tasks WHERE source = $1 AND course_id = $2', ['syllabus', courseId]);
  await db.query('DELETE FROM syllabi WHERE user_id = $1 AND course_id = $2', [userId, courseId]);
  await db.query('DELETE FROM courses WHERE id = $1', [courseId]);
  await db.end();
});

// ---------------------------------------------------------------------------
// POST /api/syllabus
// ---------------------------------------------------------------------------
describe('POST /api/syllabus', () => {
  it('401 with no auth', async () => {
    const res = await request(app).post('/api/syllabus').send({});
    expect(res.status).toBe(401);
  });

  it('400 when course_id is missing', async () => {
    const res = await request(app)
      .post('/api/syllabus')
      .set('Authorization', `Bearer ${token}`)
      .send({ quarter: 'Spring 2026', text: 'syllabus content' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/course_id/i);
  });

  it('400 when quarter is missing', async () => {
    const res = await request(app)
      .post('/api/syllabus')
      .set('Authorization', `Bearer ${token}`)
      .send({ course_id: courseId, text: 'syllabus content' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/quarter/i);
  });

  it('400 when text is missing', async () => {
    const res = await request(app)
      .post('/api/syllabus')
      .set('Authorization', `Bearer ${token}`)
      .send({ course_id: courseId, quarter: 'Spring 2026' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/text/i);
  });

  it('404 for course not belonging to user', async () => {
    const res = await request(app)
      .post('/api/syllabus')
      .set('Authorization', `Bearer ${token}`)
      .send({ course_id: '00000000-0000-0000-0000-000000000000', quarter: 'Spring 2026', text: 'syllabus' });
    expect(res.status).toBe(404);
  });

  it('201 returns jobId and extracted tasks', async () => {
    const res = await request(app)
      .post('/api/syllabus')
      .set('Authorization', `Bearer ${token}`)
      .send({ course_id: courseId, quarter: 'Spring 2026', text: 'Full syllabus text here...' });
    expect(res.status).toBe(201);
    expect(res.body.jobId).toBeDefined();
    expect(Array.isArray(res.body.tasks)).toBe(true);
    expect(res.body.tasks.length).toBe(2);
    expect(res.body.tasks[0].title).toBe('Midterm Exam');
    jobId = res.body.jobId;
  });

  it('201 re-uploading same course+quarter upserts same row', async () => {
    const res = await request(app)
      .post('/api/syllabus')
      .set('Authorization', `Bearer ${token}`)
      .send({ course_id: courseId, quarter: 'Spring 2026', text: 'Updated syllabus text...' });
    expect(res.status).toBe(201);
    expect(res.body.jobId).toBe(jobId);
  });
});

// ---------------------------------------------------------------------------
// GET /api/syllabus/status/:jobId
// ---------------------------------------------------------------------------
describe('GET /api/syllabus/status/:jobId', () => {
  it('401 with no auth', async () => {
    const res = await request(app).get(`/api/syllabus/status/${jobId}`);
    expect(res.status).toBe(401);
  });

  it('404 for unknown jobId', async () => {
    const res = await request(app)
      .get('/api/syllabus/status/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('200 returns status and tasks', async () => {
    const res = await request(app)
      .get(`/api/syllabus/status/${jobId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(Array.isArray(res.body.tasks)).toBe(true);
    expect(res.body.parsed_at).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GET /api/syllabus
// ---------------------------------------------------------------------------
describe('GET /api/syllabus', () => {
  it('401 with no auth', async () => {
    const res = await request(app).get('/api/syllabus');
    expect(res.status).toBe(401);
  });

  it('200 returns list with course info', async () => {
    const res = await request(app)
      .get('/api/syllabus')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const entry = res.body.find(s => s.id === jobId);
    expect(entry).toBeDefined();
    expect(entry.course_name).toBe('Test Syllabus Course');
    expect(entry.parse_status).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// POST /api/syllabus/confirm/:jobId
// ---------------------------------------------------------------------------
describe('POST /api/syllabus/confirm/:jobId', () => {
  it('401 with no auth', async () => {
    const res = await request(app).post(`/api/syllabus/confirm/${jobId}`);
    expect(res.status).toBe(401);
  });

  it('404 for unknown jobId', async () => {
    const res = await request(app)
      .post('/api/syllabus/confirm/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('200 inserts tasks and returns count', async () => {
    const res = await request(app)
      .post(`/api/syllabus/confirm/${jobId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(2);
    expect(res.body.jobId).toBe(jobId);
  });

  it('tasks are present in DB after confirm', async () => {
    const { rows } = await db.query(
      'SELECT title FROM tasks WHERE course_id = $1 AND source = $2 ORDER BY title',
      [courseId, 'syllabus']
    );
    expect(rows.length).toBe(2);
    expect(rows.map(r => r.title)).toContain('Midterm Exam');
  });
});
