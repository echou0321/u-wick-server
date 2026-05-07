require('dotenv').config();

// Mock Anthropic SDK before any imports
const mockStreamText = 'Here is your study plan for the week.';

const mockStream = {
  on: jest.fn().mockImplementation(function (event, cb) {
    if (event === 'text') cb(mockStreamText);
    return this;
  }),
  finalMessage: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: mockStreamText }],
  }),
};

jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({
    messages: { stream: jest.fn().mockReturnValue(mockStream) },
  }))
);

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const TEST_EMAIL = 'test@uw.edu';
const TEST_PASSWORD = 'password123';

let token;
let userId;

function parseSSEEvents(text) {
  return text
    .split('\n\n')
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice('data: '.length)));
}

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  token = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await db.query('DELETE FROM chat_messages WHERE user_id = $1', [userId]);
  await db.end();
});

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------
describe('POST /api/chat', () => {
  it('401 with no auth', async () => {
    const res = await request(app).post('/api/chat').send({ message: 'hi' });
    expect(res.status).toBe(401);
  });

  it('400 when message is missing', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ flow: 'free' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/i);
  });

  it('400 for invalid flow', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'hello', flow: 'invalid_flow' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/flow/i);
  });

  it('200 streams SSE with token and done events', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'What should I study tonight?', flow: 'free' })
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const events = parseSSEEvents(res.text);
    expect(events.some(e => e.type === 'token')).toBe(true);
    expect(events[events.length - 1].type).toBe('done');
  });

  it('saves user and assistant messages to DB', async () => {
    const { rows } = await db.query(
      `SELECT role, content FROM chat_messages
       WHERE user_id = $1 AND flow = 'free'
       ORDER BY created_at DESC LIMIT 2`,
      [userId]
    );
    const roles = rows.map(r => r.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
  });

  it('defaults to free flow when flow is omitted', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Am I on track?' })
      .buffer(true);
    expect(res.status).toBe(200);
    const events = parseSSEEvents(res.text);
    expect(events[events.length - 1].type).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// GET /api/chat/history
// ---------------------------------------------------------------------------
describe('GET /api/chat/history', () => {
  it('401 with no auth', async () => {
    const res = await request(app).get('/api/chat/history');
    expect(res.status).toBe(401);
  });

  it('400 for invalid flow', async () => {
    const res = await request(app)
      .get('/api/chat/history?flow=bad_flow')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/flow/i);
  });

  it('200 returns messages in chronological order', async () => {
    const res = await request(app)
      .get('/api/chat/history?flow=free')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    // Verify chronological order
    const timestamps = res.body.map(m => new Date(m.created_at).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it('200 returns all flows when flow omitted', async () => {
    const res = await request(app)
      .get('/api/chat/history')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/chat/history
// ---------------------------------------------------------------------------
describe('DELETE /api/chat/history', () => {
  it('401 with no auth', async () => {
    const res = await request(app).delete('/api/chat/history?flow=free');
    expect(res.status).toBe(401);
  });

  it('400 when flow is missing', async () => {
    const res = await request(app)
      .delete('/api/chat/history')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/flow/i);
  });

  it('400 for invalid flow', async () => {
    const res = await request(app)
      .delete('/api/chat/history?flow=bad_flow')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('200 deletes messages and returns count', async () => {
    const res = await request(app)
      .delete('/api/chat/history?flow=free')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.deleted).toBe('number');
    expect(res.body.deleted).toBeGreaterThan(0);
  });

  it('history is empty after delete', async () => {
    const res = await request(app)
      .get('/api/chat/history?flow=free')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });
});
