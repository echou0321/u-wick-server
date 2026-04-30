const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/schedule?start=ISO8601&end=ISO8601
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end query params are required' });
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate) || isNaN(endDate)) {
      return res.status(400).json({ error: 'start and end must be valid ISO8601 dates' });
    }
    if (endDate <= startDate) {
      return res.status(400).json({ error: 'end must be after start' });
    }

    const { rows } = await db.query(
      `SELECT id, course_id, title, start_time, end_time, block_type, source, color, created_at
       FROM schedule_blocks
       WHERE user_id = $1
         AND start_time >= $2
         AND start_time < $3
       ORDER BY start_time`,
      [req.user.id, startDate.toISOString(), endDate.toISOString()]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/schedule/blocks — accepts single object or array
router.post('/blocks', requireAuth, async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    if (items.length === 0) {
      return res.status(400).json({ error: 'Request body must not be empty' });
    }

    const ALLOWED = ['title', 'start_time', 'end_time', 'block_type', 'color', 'course_id'];

    const inserted = [];
    for (const item of items) {
      const { title, start_time, end_time, block_type, color, course_id } = item;

      if (!title || !start_time || !end_time) {
        return res.status(400).json({ error: 'title, start_time, and end_time are required for each block' });
      }

      const s = new Date(start_time);
      const e = new Date(end_time);
      if (isNaN(s) || isNaN(e)) {
        return res.status(400).json({ error: 'start_time and end_time must be valid ISO8601 dates' });
      }
      if (e <= s) {
        return res.status(400).json({ error: 'end_time must be after start_time' });
      }

      const { rows } = await db.query(
        `INSERT INTO schedule_blocks (user_id, course_id, title, start_time, end_time, block_type, source, color)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7)
         RETURNING id, course_id, title, start_time, end_time, block_type, source, color, created_at`,
        [req.user.id, course_id || null, title, s.toISOString(), e.toISOString(), block_type || 'study', color || null]
      );
      inserted.push(rows[0]);
    }

    res.status(201).json(Array.isArray(req.body) ? inserted : inserted[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/schedule/blocks/:id
router.patch('/blocks/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows: existing } = await db.query(
      'SELECT id, user_id FROM schedule_blocks WHERE id = $1',
      [req.params.id]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Block not found' });
    if (existing[0].user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const ALLOWED = ['title', 'start_time', 'end_time', 'color'];
    const updates = {};
    for (const key of ALLOWED) {
      if (key in req.body) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    if (updates.start_time && isNaN(new Date(updates.start_time))) {
      return res.status(400).json({ error: 'start_time must be a valid ISO8601 date' });
    }
    if (updates.end_time && isNaN(new Date(updates.end_time))) {
      return res.status(400).json({ error: 'end_time must be a valid ISO8601 date' });
    }

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
    const values = Object.values(updates);

    const { rows } = await db.query(
      `UPDATE schedule_blocks SET ${setClauses.join(', ')}
       WHERE id = $1
       RETURNING id, course_id, title, start_time, end_time, block_type, source, color, created_at`,
      [req.params.id, ...values]
    );

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/schedule/blocks/:id
router.delete('/blocks/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, user_id FROM schedule_blocks WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Block not found' });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    await db.query('DELETE FROM schedule_blocks WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/schedule/heat?start=ISO8601&weeks=N
router.get('/heat', requireAuth, async (req, res, next) => {
  try {
    const { start, weeks } = req.query;
    if (!start) return res.status(400).json({ error: 'start query param is required' });

    const startDate = new Date(start);
    if (isNaN(startDate)) return res.status(400).json({ error: 'start must be a valid ISO8601 date' });

    const numWeeks = parseInt(weeks, 10) || 8;
    if (numWeeks < 1 || numWeeks > 52) {
      return res.status(400).json({ error: 'weeks must be between 1 and 52' });
    }

    // Build week boundaries
    const weekStarts = [];
    for (let i = 0; i < numWeeks; i++) {
      const ws = new Date(startDate);
      ws.setDate(ws.getDate() + i * 7);
      weekStarts.push(ws);
    }

    // Query raw score per week
    const weekData = await Promise.all(
      weekStarts.map(async (ws) => {
        const we = new Date(ws);
        we.setDate(we.getDate() + 7);

        const { rows } = await db.query(
          `SELECT COALESCE(SUM(weight), 0) AS raw_score
           FROM tasks
           WHERE user_id = $1
             AND done = false
             AND due_date >= $2
             AND due_date < $3`,
          [req.user.id, ws.toISOString(), we.toISOString()]
        );

        return { week_start: ws.toISOString().split('T')[0], raw_score: parseFloat(rows[0].raw_score) };
      })
    );

    const maxScore = Math.max(...weekData.map((w) => w.raw_score), 0);

    const result = weekData.map((w) => {
      const normalized = maxScore > 0 ? w.raw_score / maxScore : 0;
      let label, color;
      if (normalized <= 0.25) { label = 'light';    color = '#6AF7C8'; }
      else if (normalized <= 0.55) { label = 'moderate'; color = '#F7D06A'; }
      else if (normalized <= 0.80) { label = 'heavy';    color = '#F7A06A'; }
      else                          { label = 'intense';  color = '#F76A6A'; }

      return { week_start: w.week_start, raw_score: w.raw_score, normalized: parseFloat(normalized.toFixed(4)), label, color };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
