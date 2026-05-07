require('dotenv').config();

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const TEST_EMAIL = 'test@uw.edu';
const TEST_PASSWORD = 'password123';
const REG_EMAIL = `auth-test-${Date.now()}@uw.edu`;

let token;
let registeredUserId;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  token = res.body.token;
});

afterAll(async () => {
  if (registeredUserId) {
    await db.query('DELETE FROM users WHERE id = $1', [registeredUserId]);
  }
  await db.end();
});

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
describe('POST /api/auth/register', () => {
  it('400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: REG_EMAIL });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('201 creates account and returns token + user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: REG_EMAIL, password: 'TestPass123', display_name: 'Auth Tester' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.email).toBe(REG_EMAIL);
    expect(res.body.user).not.toHaveProperty('password_hash');
    registeredUserId = res.body.user.id;
  });

  it('409 when email already exists', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL, password: 'anything', display_name: 'Dup' });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
describe('POST /api/auth/login', () => {
  it('400 when email or password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL });
    expect(res.status).toBe(400);
  });

  it('401 with wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('200 returns token and user on valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.email).toBe(TEST_EMAIL);
    expect(res.body.user).not.toHaveProperty('password_hash');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/auth/logout
// ---------------------------------------------------------------------------
describe('DELETE /api/auth/logout', () => {
  it('401 with no auth', async () => {
    const res = await request(app).delete('/api/auth/logout');
    expect(res.status).toBe(401);
  });

  it('200 on valid token', async () => {
    const res = await request(app)
      .delete('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
