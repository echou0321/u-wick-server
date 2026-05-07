const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

const anthropic = new Anthropic();

// GET /api/tasks
// Query params: ?done=true|false, ?course_id=, ?due_before=ISO8601, ?limit=
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const conditions = ['user_id = $1'];
    const values = [req.user.id];

    if (req.query.done !== undefined) {
      values.push(req.query.done === 'true');
      conditions.push(`done = $${values.length}`);
    }
    if (req.query.course_id) {
      values.push(req.query.course_id);
      conditions.push(`course_id = $${values.length}`);
    }
    if (req.query.due_before) {
      values.push(req.query.due_before);
      conditions.push(`due_date < $${values.length}`);
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const where = conditions.join(' AND ');

    const result = await db.query(
      `SELECT id, course_id, title, due_date, weight, source, ics_uid, done, highlighted, created_at
       FROM tasks
       WHERE ${where}
       ORDER BY due_date ASC NULLS LAST
       LIMIT ${limit}`,
      values
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { title, course_id, due_date, weight } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });

    if (course_id) {
      const { rows } = await db.query(
        'SELECT id FROM courses WHERE id = $1 AND user_id = $2',
        [course_id, req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Course not found' });
    }

    const { rows } = await db.query(
      `INSERT INTO tasks (user_id, course_id, title, due_date, weight, source)
       VALUES ($1, $2, $3, $4, $5, 'manual') RETURNING *`,
      [req.user.id, course_id || null, title.trim(), due_date || null, weight || 1.0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tasks/:id
const TASK_ALLOWLIST = ['done', 'title', 'due_date', 'weight', 'highlighted'];

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const updates = Object.keys(req.body).filter(k => TASK_ALLOWLIST.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

    const sets = updates.map((k, i) => `${k} = $${i + 2}`);
    const values = [req.params.id, ...updates.map(k => req.body[k])];

    const result = await db.query(
      `UPDATE tasks SET ${sets.join(', ')}
       WHERE id = $1 AND user_id = $${values.length + 1}
       RETURNING *`,
      [...values, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Task not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tasks/:id  (manual tasks only)
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const task = await db.query(
      'SELECT id, source FROM tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (!task.rows.length) return res.status(404).json({ error: 'Task not found' });
    if (task.rows[0].source !== 'manual') {
      return res.status(403).json({ error: 'Only manually-created tasks can be deleted' });
    }

    await db.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/:id/subtasks
router.get('/:id/subtasks', requireAuth, async (req, res, next) => {
  try {
    const { rows: task } = await db.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!task.length) return res.status(404).json({ error: 'Task not found' });

    const { rows } = await db.query(
      'SELECT * FROM task_subtasks WHERE task_id = $1 ORDER BY sort_order ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/:id/breakdown
router.post('/:id/breakdown', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT t.*, c.name AS course_name
       FROM tasks t
       LEFT JOIN courses c ON c.id = t.course_id
       WHERE t.id = $1 AND t.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `A student needs to complete: "${task.title}"${task.course_name ? ` for ${task.course_name}` : ''}.
${task.due_date ? `It is due ${new Date(task.due_date).toDateString()}.` : ''}

Generate 3–6 concrete, actionable subtasks to help them finish this.

Return ONLY a JSON array with no prose. Each element:
{ "title": "subtask description", "suggested_start": "ISO8601 datetime or null" }`,
      }],
    });

    const raw = msg.content[0].text.trim()
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '');
    const subtasks = JSON.parse(raw);

    await db.query('DELETE FROM task_subtasks WHERE task_id = $1', [task.id]);
    const inserted = [];
    for (let i = 0; i < subtasks.length; i++) {
      const { rows: sub } = await db.query(
        `INSERT INTO task_subtasks (task_id, title, suggested_start, sort_order)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [task.id, subtasks[i].title, subtasks[i].suggested_start || null, i]
      );
      inserted.push(sub[0]);
    }

    res.status(201).json(inserted);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
