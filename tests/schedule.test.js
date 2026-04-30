require('dotenv').config();
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');

const TEST_EMAIL = 'test@uw.edu';
const TEST_PASSWORD = 'password123';

let token;
const createdBlockIds = [];

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  token = res.body.token;
});

afterAll(async () => {
  if (createdBlockIds.length > 0) {
    await db.query(
      `DELETE FROM schedule_blocks WHERE id = ANY($1::uuid[])`,
      [createdBlockIds]
    );
  }
  await db.end();
});

// ---------------------------------------------------------------------------
// GET /api/schedule
// ---------------------------------------------------------------------------
describe('GET /api/schedule', () => {
  it('401 with no auth', async () => {
    const res = await request(app)
      .get('/api/schedule?start=2026-05-01&end=2026-05-08');
    expect(res.status).toBe(401);
  });

  it('400 when start is missing', async () => {
    const res = await request(app)
      .get('/api/schedule?end=2026-05-08')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start/i);
  });

  it('400 when end is missing', async () => {
    const res = await request(app)
      .get('/api/schedule?start=2026-05-01')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/end/i);
  });

  it('400 when end is before start', async () => {
    const res = await request(app)
      .get('/api/schedule?start=2026-05-08&end=2026-05-01')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/end must be after/i);
  });

  it('200 valid range returns array', async () => {
    const res = await request(app)
      .get('/api/schedule?start=2026-05-01&end=2026-05-08')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/schedule/blocks
// ---------------------------------------------------------------------------
describe('POST /api/schedule/blocks', () => {
  it('401 with no auth', async () => {
    const res = await request(app)
      .post('/api/schedule/blocks')
      .send({ title: 'Test', start_time: '2026-05-02T14:00:00Z', end_time: '2026-05-02T16:00:00Z' });
    expect(res.status).toBe(401);
  });

  it('400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/schedule/blocks')
      .set('Authorization', `Bearer ${token}`)
      .send({ start_time: '2026-05-02T14:00:00Z', end_time: '2026-05-02T16:00:00Z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('400 when start_time is missing', async () => {
    const res = await request(app)
      .post('/api/schedule/blocks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Study', end_time: '2026-05-02T16:00:00Z' });
    expect(res.status).toBe(400);
  });

  it('400 when end_time is before start_time', async () => {
    const res = await request(app)
      .post('/api/schedule/blocks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Study', start_time: '2026-05-02T16:00:00Z', end_time: '2026-05-02T14:00:00Z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/end_time must be after/i);
  });

  it('201 single block insert returns block object', async () => {
    const res = await request(app)
      .post('/api/schedule/blocks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Study: MATH 126',
        start_time: '2026-05-02T14:00:00Z',
        end_time: '2026-05-02T16:00:00Z',
        block_type: 'study',
        color: '#6AF7C8',
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.title).toBe('Study: MATH 126');
    expect(res.body.source).toBe('manual');
    createdBlockIds.push(res.body.id);
  });

  it('201 array insert returns array of blocks', async () => {
    const res = await request(app)
      .post('/api/schedule/blocks')
      .set('Authorization', `Bearer ${token}`)
      .send([
        { title: 'Block A', start_time: '2026-05-03T09:00:00Z', end_time: '2026-05-03T10:00:00Z' },
        { title: 'Block B', start_time: '2026-05-03T11:00:00Z', end_time: '2026-05-03T12:00:00Z' },
      ]);
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    res.body.forEach((b) => {
      expect(b.source).toBe('manual');
      createdBlockIds.push(b.id);
    });
  });

  it('GET /api/schedule returns inserted blocks within range', async () => {
    const res = await request(app)
      .get('/api/schedule?start=2026-05-02&end=2026-05-04')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const titles = res.body.map((b) => b.title);
    expect(titles).toContain('Study: MATH 126');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/schedule/blocks/:id
// ---------------------------------------------------------------------------
describe('PATCH /api/schedule/blocks/:id', () => {
  let blockId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/schedule/blocks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Patch target', start_time: '2026-05-04T10:00:00Z', end_time: '2026-05-04T11:00:00Z' });
    blockId = res.body.id;
    createdBlockIds.push(blockId);
  });

  it('401 with no auth', async () => {
    const res = await request(app).patch(`/api/schedule/blocks/${blockId}`).send({ title: 'X' });
    expect(res.status).toBe(401);
  });

  it('404 for nonexistent block', async () => {
    const res = await request(app)
      .patch('/api/schedule/blocks/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  it('400 when no valid fields provided', async () => {
    const res = await request(app)
      .patch(`/api/schedule/blocks/${blockId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ source: 'hack', block_type: 'hack' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no valid fields/i);
  });

  it('200 updates allowed fields and returns updated block', async () => {
    const res = await request(app)
      .patch(`/api/schedule/blocks/${blockId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated title', color: '#F7D06A' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated title');
    expect(res.body.color).toBe('#F7D06A');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/schedule/blocks/:id
// ---------------------------------------------------------------------------
describe('DELETE /api/schedule/blocks/:id', () => {
  let blockId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/schedule/blocks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Delete target', start_time: '2026-05-05T10:00:00Z', end_time: '2026-05-05T11:00:00Z' });
    blockId = res.body.id;
    // Do NOT push to createdBlockIds — the test itself will delete it
  });

  it('401 with no auth', async () => {
    const res = await request(app).delete(`/api/schedule/blocks/${blockId}`);
    expect(res.status).toBe(401);
  });

  it('404 for nonexistent block', async () => {
    const res = await request(app)
      .delete('/api/schedule/blocks/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('204 hard deletes the block', async () => {
    const res = await request(app)
      .delete(`/api/schedule/blocks/${blockId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  it('404 on second delete of same block', async () => {
    const res = await request(app)
      .delete(`/api/schedule/blocks/${blockId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/schedule/heat
// ---------------------------------------------------------------------------
describe('GET /api/schedule/heat', () => {
  it('401 with no auth', async () => {
    const res = await request(app).get('/api/schedule/heat?start=2026-04-07');
    expect(res.status).toBe(401);
  });

  it('400 when start is missing', async () => {
    const res = await request(app)
      .get('/api/schedule/heat')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start/i);
  });

  it('400 when weeks is out of range', async () => {
    const res = await request(app)
      .get('/api/schedule/heat?start=2026-04-07&weeks=100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/weeks/i);
  });

  it('200 returns array with correct shape', async () => {
    const res = await request(app)
      .get('/api/schedule/heat?start=2026-04-07&weeks=3')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3);
    res.body.forEach((week) => {
      expect(week).toHaveProperty('week_start');
      expect(week).toHaveProperty('raw_score');
      expect(week).toHaveProperty('normalized');
      expect(week).toHaveProperty('label');
      expect(week).toHaveProperty('color');
      expect(['light', 'moderate', 'heavy', 'intense']).toContain(week.label);
    });
  });

  it('defaults to 8 weeks when weeks param omitted', async () => {
    const res = await request(app)
      .get('/api/schedule/heat?start=2026-04-07')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(8);
  });
});
