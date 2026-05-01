require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const TEST_EMAIL = 'test@uw.edu';
const TEST_PASSWORD = 'password123';

let token;
let testMajorId;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  token = res.body.token;

  const { rows } = await db.query(
    `INSERT INTO major_requirements
       (major_name, department, application_deadline, min_gpa, prereqs, checklist_steps, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      'Test Informatics',
      'iSchool',
      'March 1 of sophomore year',
      3.0,
      JSON.stringify([{ course: 'INFO 200', min_grade: '2.7' }]),
      JSON.stringify(['Complete prereqs', 'Submit application']),
      'Test row — safe to delete',
    ]
  );
  testMajorId = rows[0].id;
});

afterAll(async () => {
  await db.query('DELETE FROM major_requirements WHERE id = $1', [testMajorId]);
  await db.end();
});

// ---------------------------------------------------------------------------
// GET /api/majors
// ---------------------------------------------------------------------------
describe('GET /api/majors', () => {
  it('401 with no auth', async () => {
    const res = await request(app).get('/api/majors');
    expect(res.status).toBe(401);
  });

  it('200 returns array of majors', async () => {
    const res = await request(app)
      .get('/api/majors')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('200 summary fields present, no prereqs/checklist_steps', async () => {
    const res = await request(app)
      .get('/api/majors')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const match = res.body.find((m) => m.id === testMajorId);
    expect(match).toBeDefined();
    expect(match.major_name).toBe('Test Informatics');
    expect(match.department).toBe('iSchool');
    expect(match.min_gpa).toBeDefined();
    expect(match.prereqs).toBeUndefined();
    expect(match.checklist_steps).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GET /api/majors/:id
// ---------------------------------------------------------------------------
describe('GET /api/majors/:id', () => {
  it('401 with no auth', async () => {
    const res = await request(app).get(`/api/majors/${testMajorId}`);
    expect(res.status).toBe(401);
  });

  it('404 for nonexistent major', async () => {
    const res = await request(app)
      .get('/api/majors/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('200 returns full detail including prereqs and checklist_steps', async () => {
    const res = await request(app)
      .get(`/api/majors/${testMajorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.major_name).toBe('Test Informatics');
    expect(res.body.prereqs).toBeDefined();
    expect(res.body.checklist_steps).toBeDefined();
    expect(Array.isArray(res.body.prereqs)).toBe(true);
    expect(res.body.prereqs[0].course).toBe('INFO 200');
  });
});
