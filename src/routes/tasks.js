const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

// GET /api/tasks
// Query params: ?done=true|false, ?course_id=, ?due_before=ISO8601, ?limit=
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const conditions = ['user_id = $1'];
    const values = [req.user.userId];

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
      [...values, req.user.userId]
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
      [req.params.id, req.user.userId]
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

module.exports = router;
