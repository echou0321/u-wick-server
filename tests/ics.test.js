require('dotenv').config();

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const TEST_EMAIL = 'test@uw.edu';
const TEST_PASSWORD = 'password123';

let token;
let userId;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  // Ensure ics_url is cleared after tests
  await db.query('UPDATE users SET ics_url = null, ics_last_synced = null WHERE id = $1', [userId]);
  await db.end();
});

// ---------------------------------------------------------------------------
// POST /api/ics/connect
// ---------------------------------------------------------------------------
describe('POST /api/ics/connect', () => {
  it('401 with no auth', async () => {
    const res = await request(app).post('/api/ics/connect').send({ icsUrl: 'https://canvas.uw.edu/feeds/calendars/user_abc.ics' });
    expect(res.status).toBe(401);
  });

  it('400 when icsUrl is missing', async () => {
    const res = await request(app)
      .post('/api/ics/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/icsUrl/i);
  });

  it('400 when icsUrl is not from canvas.uw.edu', async () => {
    const res = await request(app)
      .post('/api/ics/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ icsUrl: 'https://evil.com/calendar.ics' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/canvas\.uw\.edu/i);
  });

  it('400 when icsUrl is malformed', async () => {
    const res = await request(app)
      .post('/api/ics/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ icsUrl: 'not-a-url' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/ics/sync
// ---------------------------------------------------------------------------
describe('POST /api/ics/sync', () => {
  it('401 with no auth', async () => {
    const res = await request(app).post('/api/ics/sync');
    expect(res.status).toBe(401);
  });

  it('400 when no ICS URL is connected', async () => {
    // Ensure no ICS URL on the user
    await db.query('UPDATE users SET ics_url = null WHERE id = $1', [userId]);

    const res = await request(app)
      .post('/api/ics/sync')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no ics url/i);
  });
});

// ---------------------------------------------------------------------------
// GET /api/ics/status
// ---------------------------------------------------------------------------
describe('GET /api/ics/status', () => {
  it('401 with no auth', async () => {
    const res = await request(app).get('/api/ics/status');
    expect(res.status).toBe(401);
  });

  it('200 returns status object', async () => {
    const res = await request(app)
      .get('/api/ics/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('connected');
    expect(res.body).toHaveProperty('last_synced');
    expect(res.body).toHaveProperty('course_count');
    expect(res.body).toHaveProperty('task_count');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/ics/disconnect
// ---------------------------------------------------------------------------
describe('DELETE /api/ics/disconnect', () => {
  it('401 with no auth', async () => {
    const res = await request(app).delete('/api/ics/disconnect');
    expect(res.status).toBe(401);
  });

  it('200 clears ICS URL and returns tasks_removed count', async () => {
    const res = await request(app)
      .delete('/api/ics/disconnect')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.tasks_removed).toBe('number');

    // Verify ics_url is now null
    const { rows } = await db.query('SELECT ics_url FROM users WHERE id = $1', [userId]);
    expect(rows[0].ics_url).toBeNull();
  });
});
