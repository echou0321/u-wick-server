require('dotenv').config();

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const TEST_EMAIL = 'test@uw.edu';
const TEST_PASSWORD = 'password123';

let token;
let originalPushToken;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  token = res.body.token;

  // Capture current push token so we can restore it after tests
  const { rows } = await db.query(
    'SELECT expo_push_token FROM users WHERE email = $1',
    [TEST_EMAIL]
  );
  originalPushToken = rows[0].expo_push_token;
});

afterAll(async () => {
  // Restore push token to original value
  await db.query(
    'UPDATE users SET expo_push_token = $1 WHERE email = $2',
    [originalPushToken, TEST_EMAIL]
  );
  await db.end();
});

// GET /api/users/me
describe('GET /api/users/me', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });

  it('returns user profile', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(TEST_EMAIL);
    expect(res.body).toHaveProperty('onboarding_complete');
    expect(res.body).toHaveProperty('current_quarter');
  });
});

// PATCH /api/users/me
describe('PATCH /api/users/me', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).patch('/api/users/me').send({ major: 'Informatics' });
    expect(res.status).toBe(401);
  });

  it('returns 400 with no updatable fields', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ unknown_field: 'value' });
    expect(res.status).toBe(400);
  });

  it('updates display_name', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ display_name: 'Test User' });
    expect(res.status).toBe(200);
    expect(res.body.display_name).toBe('Test User');
  });
});

// POST /api/users/me/onboarding/complete
describe('POST /api/users/me/onboarding/complete', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).post('/api/users/me/onboarding/complete');
    expect(res.status).toBe(401);
  });

  it('sets onboarding_complete to true', async () => {
    const res = await request(app)
      .post('/api/users/me/onboarding/complete')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.onboarding_complete).toBe(true);
  });
});

// GET /api/users/me/dashboard
describe('GET /api/users/me/dashboard', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/users/me/dashboard');
    expect(res.status).toBe(401);
  });

  it('returns dashboard aggregate shape', async () => {
    const res = await request(app)
      .get('/api/users/me/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tasks_due_soon)).toBe(true);
    expect(Array.isArray(res.body.schedule_today)).toBe(true);
    expect(Array.isArray(res.body.nudges)).toBe(true);
    expect(res.body.heat_this_week).toHaveProperty('raw_score');
    expect(res.body.heat_this_week).toHaveProperty('label');
    expect(res.body.heat_this_week).toHaveProperty('color');
  });

  it('heat label is one of the four valid values', async () => {
    const res = await request(app)
      .get('/api/users/me/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(['light', 'moderate', 'heavy', 'intense']).toContain(res.body.heat_this_week.label);
  });
});

// PATCH /api/users/me/push-token
describe('PATCH /api/users/me/push-token', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app)
      .patch('/api/users/me/push-token')
      .send({ token: 'ExponentPushToken[test123]' });
    expect(res.status).toBe(401);
  });

  it('returns 400 with missing token', async () => {
    const res = await request(app)
      .patch('/api/users/me/push-token')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('stores push token and sets notif_active', async () => {
    const pushToken = 'ExponentPushToken[testtoken123]';
    const res = await request(app)
      .patch('/api/users/me/push-token')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: pushToken });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const { rows } = await db.query(
      'SELECT expo_push_token, notif_active FROM users WHERE email = $1',
      [TEST_EMAIL]
    );
    expect(rows[0].expo_push_token).toBe(pushToken);
    expect(rows[0].notif_active).toBe(true);
  });
});
