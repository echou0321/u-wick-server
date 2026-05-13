require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const TEST_EMAIL = 'test@uw.edu';
const TEST_PASSWORD = 'password123';

let token;
let userId;
let testCourseId;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  token = res.body.token;
  userId = res.body.user.id;

  const { rows } = await db.query(
    `INSERT INTO courses (user_id, name, code, quarter, color, source)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, 'Test Course 101', 'TEST 101', 'Spring 2026', '#AABBCC', 'manual']
  );
  testCourseId = rows[0].id;
});

afterAll(async () => {
  await db.query('DELETE FROM courses WHERE id = $1', [testCourseId]);
  await db.end();
});

// ---------------------------------------------------------------------------
// GET /api/courses
// ---------------------------------------------------------------------------
describe('GET /api/courses', () => {
  it('401 with no auth', async () => {
    const res = await request(app).get('/api/courses');
    expect(res.status).toBe(401);
  });

  it('200 returns array', async () => {
    const res = await request(app)
      .get('/api/courses')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('200 includes test course with expected fields', async () => {
    const res = await request(app)
      .get('/api/courses')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const course = res.body.find((c) => c.id === testCourseId);
    expect(course).toBeDefined();
    expect(course.name).toBe('Test Course 101');
    expect(course.code).toBe('TEST 101');
    expect(course.quarter).toBe('Spring 2026');
    expect(course.color).toBe('#AABBCC');
    expect(course.source).toBe('manual');
  });

  it('200 does not return courses belonging to other users', async () => {
    const { rows: otherUser } = await db.query(
      `SELECT id FROM users WHERE email != $1 LIMIT 1`,
      [TEST_EMAIL]
    );
    if (otherUser.length === 0) return;

    const { rows: otherCourse } = await db.query(
      `SELECT id FROM courses WHERE user_id = $1 LIMIT 1`,
      [otherUser[0].id]
    );
    if (otherCourse.length === 0) return;

    const res = await request(app)
      .get('/api/courses')
      .set('Authorization', `Bearer ${token}`);
    const found = res.body.find((c) => c.id === otherCourse[0].id);
    expect(found).toBeUndefined();
  });
});
