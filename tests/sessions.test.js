require('dotenv').config();
process.env.ADMIN_EMAIL = 'test@uw.edu';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const TEST_EMAIL = 'test@uw.edu';
const TEST_PASSWORD = 'password123';

let token;
let sessionId;
const createdSessionIds = [];

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  token = res.body.token;
});

afterAll(async () => {
  if (createdSessionIds.length > 0) {
    // session_events cascade on chat_sessions delete
    await db.query(
      'DELETE FROM chat_sessions WHERE id = ANY($1::uuid[])',
      [createdSessionIds]
    );
  }
  await db.end();
});

// ---------------------------------------------------------------------------
// POST /api/sessions/start
// ---------------------------------------------------------------------------
describe('POST /api/sessions/start', () => {
  it('401 with no auth', async () => {
    const res = await request(app).post('/api/sessions/start').send({});
    expect(res.status).toBe(401);
  });

  it('400 for invalid flow value', async () => {
    const res = await request(app)
      .post('/api/sessions/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ flow: 'not_a_real_flow' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/flow/i);
  });

  it('201 with no body creates session', async () => {
    const res = await request(app)
      .post('/api/sessions/start')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.session_id).toBeDefined();
    expect(res.body.started_at).toBeDefined();
    createdSessionIds.push(res.body.session_id);
  });

  it('201 with valid flow, platform, app_version', async () => {
    const res = await request(app)
      .post('/api/sessions/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ flow: 'planning', platform: 'ios', app_version: '1.0.0' });
    expect(res.status).toBe(201);
    expect(res.body.session_id).toBeDefined();
    sessionId = res.body.session_id;
    createdSessionIds.push(sessionId);
  });
});

// ---------------------------------------------------------------------------
// POST /api/sessions/event
// ---------------------------------------------------------------------------
describe('POST /api/sessions/event', () => {
  it('401 with no auth', async () => {
    const res = await request(app).post('/api/sessions/event').send({});
    expect(res.status).toBe(401);
  });

  it('400 when session_id is missing', async () => {
    const res = await request(app)
      .post('/api/sessions/event')
      .set('Authorization', `Bearer ${token}`)
      .send({ event_type: 'chat_turn' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/session_id/i);
  });

  it('400 when event_type is missing', async () => {
    const res = await request(app)
      .post('/api/sessions/event')
      .set('Authorization', `Bearer ${token}`)
      .send({ session_id: sessionId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/event_type/i);
  });

  it('400 for invalid event_type', async () => {
    const res = await request(app)
      .post('/api/sessions/event')
      .set('Authorization', `Bearer ${token}`)
      .send({ session_id: sessionId, event_type: 'not_valid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/event_type/i);
  });

  it('404 for session_id that does not exist', async () => {
    const res = await request(app)
      .post('/api/sessions/event')
      .set('Authorization', `Bearer ${token}`)
      .send({ session_id: '00000000-0000-0000-0000-000000000000', event_type: 'chat_turn' });
    expect(res.status).toBe(404);
  });

  it('201 logs event with metadata', async () => {
    const res = await request(app)
      .post('/api/sessions/event')
      .set('Authorization', `Bearer ${token}`)
      .send({
        session_id: sessionId,
        event_type: 'chat_turn',
        metadata: { flow: 'planning', message_length: 42 },
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.event_type).toBe('chat_turn');
    expect(res.body.occurred_at).toBeDefined();
  });

  it('201 logs event without metadata', async () => {
    const res = await request(app)
      .post('/api/sessions/event')
      .set('Authorization', `Bearer ${token}`)
      .send({ session_id: sessionId, event_type: 'heat_map_toggled' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/sessions/end
// ---------------------------------------------------------------------------
describe('POST /api/sessions/end', () => {
  let endableSessionId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/sessions/start')
      .set('Authorization', `Bearer ${token}`)
      .send({ flow: 'free' });
    endableSessionId = res.body.session_id;
    createdSessionIds.push(endableSessionId);
  });

  it('401 with no auth', async () => {
    const res = await request(app).post('/api/sessions/end').send({});
    expect(res.status).toBe(401);
  });

  it('400 when session_id is missing', async () => {
    const res = await request(app)
      .post('/api/sessions/end')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/session_id/i);
  });

  it('404 for session_id that does not exist', async () => {
    const res = await request(app)
      .post('/api/sessions/end')
      .set('Authorization', `Bearer ${token}`)
      .send({ session_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('200 ends session and returns duration_s', async () => {
    const res = await request(app)
      .post('/api/sessions/end')
      .set('Authorization', `Bearer ${token}`)
      .send({ session_id: endableSessionId });
    expect(res.status).toBe(200);
    expect(res.body.session_id).toBe(endableSessionId);
    expect(res.body.ended_at).toBeDefined();
    expect(typeof res.body.duration_s).toBe('number');
    expect(res.body.duration_s).toBeGreaterThanOrEqual(0);
  });

  it('409 on second end of same session', async () => {
    const res = await request(app)
      .post('/api/sessions/end')
      .set('Authorization', `Bearer ${token}`)
      .send({ session_id: endableSessionId });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// GET /api/sessions/export
// ---------------------------------------------------------------------------
describe('GET /api/sessions/export', () => {
  it('401 with no auth', async () => {
    const res = await request(app).get('/api/sessions/export');
    expect(res.status).toBe(401);
  });

  it('403 for non-admin user', async () => {
    const orig = process.env.ADMIN_EMAIL;
    process.env.ADMIN_EMAIL = 'other-admin@uw.edu';
    const res = await request(app)
      .get('/api/sessions/export')
      .set('Authorization', `Bearer ${token}`);
    process.env.ADMIN_EMAIL = orig;
    expect(res.status).toBe(403);
  });

  it('200 admin receives CSV with correct headers', async () => {
    const res = await request(app)
      .get('/api/sessions/export')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.split('\n');
    expect(lines[0]).toBe(
      'event_id,occurred_at,event_type,metadata,flow,platform,app_version,session_started_at,duration_s,participant_id'
    );
  });

  it('CSV rows contain participant_id not raw email', async () => {
    const res = await request(app)
      .get('/api/sessions/export')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(TEST_EMAIL);
    expect(res.text).toMatch(/P-[a-f0-9]{8}/);
  });
});
