require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { parseAndUpsert } = require('../src/lib/icsSync');

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
  await db.query("DELETE FROM tasks WHERE user_id = $1 AND source = 'ics'", [userId]);
  await db.query("DELETE FROM courses WHERE user_id = $1 AND source = 'ics'", [userId]);
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

  it('200 includes ICS courses created by parseAndUpsert', async () => {
    const icsText = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      // Event 1: course code only in DESCRIPTION (Canvas personal feed format)
      'BEGIN:VEVENT',
      'UID:parse-test-001@canvas.uw.edu',
      'SUMMARY:Homework 3',
      'DESCRIPTION:CSE 123: Data Programming\\nDue: April 15 at 11:59pm',
      'DTSTART;VALUE=DATE:20260415',
      'CATEGORIES:assignment',
      'END:VEVENT',
      // Event 2: course code in SUMMARY prefix with colon
      'BEGIN:VEVENT',
      'UID:parse-test-002@canvas.uw.edu',
      'SUMMARY:INFO 201: Final Paper',
      'DESCRIPTION:Due at end of quarter',
      'DTSTART;VALUE=DATE:20260610',
      'END:VEVENT',
      // Event 3: no course code anywhere → task with course_id null
      'BEGIN:VEVENT',
      'UID:parse-test-003@canvas.uw.edu',
      'SUMMARY:Generic Event',
      'DESCRIPTION:No course code here',
      'DTSTART;VALUE=DATE:20260501',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const { synced, courses } = await parseAndUpsert(userId, icsText, 'Spring 2026');

    expect(synced).toBe(3);
    // Should have extracted exactly 2 distinct course names
    expect(courses).toHaveLength(2);
    expect(courses).toContain('CSE 123');
    expect(courses).toContain('INFO 201');

    // GET /courses should now include both ICS-derived courses
    const res = await request(app)
      .get('/api/courses')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const names = res.body.map((c) => c.name);
    expect(names).toContain('CSE 123');
    expect(names).toContain('INFO 201');

    // The no-course-code task should have course_id = null
    const { rows } = await db.query(
      "SELECT course_id FROM tasks WHERE user_id = $1 AND ics_uid = 'parse-test-003@canvas.uw.edu'",
      [userId],
    );
    expect(rows[0].course_id).toBeNull();
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
