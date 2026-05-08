require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const TEST_EMAIL = 'test@uw.edu';
const TEST_PASSWORD = 'password123';

let token;
let testMajorId;
let goalId;
const createdGoalIds = [];

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
      'Test CS',
      'Allen School',
      'February 15 of sophomore year',
      3.2,
      JSON.stringify([{ course: 'CSE 143', min_grade: '3.0' }]),
      JSON.stringify(['Complete CSE 143', 'Maintain GPA', 'Submit application']),
      'Test row — safe to delete',
    ]
  );
  testMajorId = rows[0].id;
});

afterAll(async () => {
  if (createdGoalIds.length > 0) {
    await db.query(
      'DELETE FROM student_major_goals WHERE id = ANY($1::uuid[])',
      [createdGoalIds]
    );
  }
  await db.query('DELETE FROM major_requirements WHERE id = $1', [testMajorId]);
  await db.end();
});

// ---------------------------------------------------------------------------
// POST /api/goals/major
// ---------------------------------------------------------------------------
describe('POST /api/goals/major', () => {
  it('401 with no auth', async () => {
    const res = await request(app).post('/api/goals/major').send({});
    expect(res.status).toBe(401);
  });

  it('400 when major_req_id is missing', async () => {
    const res = await request(app)
      .post('/api/goals/major')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/major_req_id/i);
  });

  it('404 when major does not exist', async () => {
    const res = await request(app)
      .post('/api/goals/major')
      .set('Authorization', `Bearer ${token}`)
      .send({ major_req_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('201 creates goal and returns row', async () => {
    const res = await request(app)
      .post('/api/goals/major')
      .set('Authorization', `Bearer ${token}`)
      .send({ major_req_id: testMajorId });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('active');
    expect(res.body.major_req_id).toBe(testMajorId);
    expect(res.body.checklist_progress).toEqual({});
    goalId = res.body.id;
    createdGoalIds.push(goalId);
  });

  it('409 on duplicate active goal for same major', async () => {
    const res = await request(app)
      .post('/api/goals/major')
      .set('Authorization', `Bearer ${token}`)
      .send({ major_req_id: testMajorId });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// GET /api/goals/major
// ---------------------------------------------------------------------------
describe('GET /api/goals/major', () => {
  it('401 with no auth', async () => {
    const res = await request(app).get('/api/goals/major');
    expect(res.status).toBe(401);
  });

  it('400 for invalid status param', async () => {
    const res = await request(app)
      .get('/api/goals/major?status=invalid')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status/i);
  });

  it('200 default returns active goals with major_name joined', async () => {
    const res = await request(app)
      .get('/api/goals/major')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const match = res.body.find((g) => g.id === goalId);
    expect(match).toBeDefined();
    expect(match.major_name).toBe('Test CS');
    expect(match.department).toBe('Allen School');
    expect(match.status).toBe('active');
    expect(Number(match.min_gpa)).toBeCloseTo(3.2, 5);
  });

  it('200 status=all includes all goals', async () => {
    const res = await request(app)
      .get('/api/goals/major?status=all')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('200 status=dropped returns empty array (none dropped yet)', async () => {
    const res = await request(app)
      .get('/api/goals/major?status=dropped')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const match = res.body.find((g) => g.id === goalId);
    expect(match).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/goals/major/:id
// ---------------------------------------------------------------------------
describe('PATCH /api/goals/major/:id', () => {
  it('401 with no auth', async () => {
    const res = await request(app).patch(`/api/goals/major/${goalId}`).send({});
    expect(res.status).toBe(401);
  });

  it('404 for nonexistent goal', async () => {
    const res = await request(app)
      .patch('/api/goals/major/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'dropped' });
    expect(res.status).toBe(404);
  });

  it('400 for invalid status value', async () => {
    const res = await request(app)
      .patch(`/api/goals/major/${goalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dropped.*achieved/i);
  });

  it('400 when no valid fields provided', async () => {
    const res = await request(app)
      .patch(`/api/goals/major/${goalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('200 updates application_deadline', async () => {
    const res = await request(app)
      .patch(`/api/goals/major/${goalId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ application_deadline: '2027-03-01T00:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body.application_deadline).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/goals/major/:id/checklist
// ---------------------------------------------------------------------------
describe('PATCH /api/goals/major/:id/checklist', () => {
  it('401 with no auth', async () => {
    const res = await request(app)
      .patch(`/api/goals/major/${goalId}/checklist`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('404 for nonexistent goal', async () => {
    const res = await request(app)
      .patch('/api/goals/major/00000000-0000-0000-0000-000000000000/checklist')
      .set('Authorization', `Bearer ${token}`)
      .send({ step_id: 'step_1', completed: true });
    expect(res.status).toBe(404);
  });

  it('400 when step_id is missing', async () => {
    const res = await request(app)
      .patch(`/api/goals/major/${goalId}/checklist`)
      .set('Authorization', `Bearer ${token}`)
      .send({ completed: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/step_id/i);
  });

  it('400 when completed is missing', async () => {
    const res = await request(app)
      .patch(`/api/goals/major/${goalId}/checklist`)
      .set('Authorization', `Bearer ${token}`)
      .send({ step_id: 'step_1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/completed/i);
  });

  it('200 sets a step to true', async () => {
    const res = await request(app)
      .patch(`/api/goals/major/${goalId}/checklist`)
      .set('Authorization', `Bearer ${token}`)
      .send({ step_id: 'step_1', completed: true });
    expect(res.status).toBe(200);
    expect(res.body.checklist_progress.step_1).toBe(true);
  });

  it('200 second update merges without overwriting other steps', async () => {
    const res = await request(app)
      .patch(`/api/goals/major/${goalId}/checklist`)
      .set('Authorization', `Bearer ${token}`)
      .send({ step_id: 'step_2', completed: true });
    expect(res.status).toBe(200);
    expect(res.body.checklist_progress.step_1).toBe(true);
    expect(res.body.checklist_progress.step_2).toBe(true);
  });

  it('200 can mark a step as false', async () => {
    const res = await request(app)
      .patch(`/api/goals/major/${goalId}/checklist`)
      .set('Authorization', `Bearer ${token}`)
      .send({ step_id: 'step_1', completed: false });
    expect(res.status).toBe(200);
    expect(res.body.checklist_progress.step_1).toBe(false);
    expect(res.body.checklist_progress.step_2).toBe(true);
  });
});
