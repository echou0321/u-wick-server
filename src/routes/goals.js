const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const VALID_STATUSES = ['active', 'dropped', 'achieved'];

// POST /api/goals/major
router.post('/major', requireAuth, async (req, res, next) => {
  try {
    const { major_req_id, application_deadline } = req.body;

    if (!major_req_id) return res.status(400).json({ error: 'major_req_id is required' });

    const { rows: majors } = await db.query(
      'SELECT id FROM major_requirements WHERE id = $1',
      [major_req_id]
    );
    if (majors.length === 0) return res.status(404).json({ error: 'Major not found' });

    const { rows: existing } = await db.query(
      `SELECT id FROM student_major_goals
       WHERE user_id = $1 AND major_req_id = $2 AND status = 'active'`,
      [req.user.id, major_req_id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An active goal for this major already exists' });
    }

    const { rows } = await db.query(
      `INSERT INTO student_major_goals (user_id, major_req_id, application_deadline, checklist_progress)
       VALUES ($1, $2, $3, '{}')
       RETURNING id, user_id, major_req_id, status, declared_at, updated_at,
                 application_deadline, checklist_progress`,
      [req.user.id, major_req_id, application_deadline || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/goals/major
router.get('/major', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.query;

    if (status && status !== 'all' && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}, or 'all'` });
    }

    const params = [req.user.id];
    let statusClause = `AND g.status = 'active'`;
    if (status === 'all') {
      statusClause = '';
    } else if (status && status !== 'active') {
      statusClause = `AND g.status = $2`;
      params.push(status);
    }

    const { rows } = await db.query(
      `SELECT g.id, g.major_req_id, g.status, g.declared_at, g.updated_at,
              g.application_deadline, g.checklist_progress,
              g.reminder_30d_sent, g.reminder_7d_sent, g.reminder_1d_sent,
              m.major_name, m.department, m.min_gpa
       FROM student_major_goals g
       JOIN major_requirements m ON m.id = g.major_req_id
       WHERE g.user_id = $1 ${statusClause}
       ORDER BY g.declared_at DESC`,
      params
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/goals/major/:id
router.patch('/major/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows: existing } = await db.query(
      'SELECT id FROM student_major_goals WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Goal not found' });

    const { status, application_deadline } = req.body;
    const updates = {};

    if (status !== undefined) {
      if (!['dropped', 'achieved'].includes(status)) {
        return res.status(400).json({ error: "status must be 'dropped' or 'achieved'" });
      }
      updates.status = status;
    }
    if (application_deadline !== undefined) updates.application_deadline = application_deadline;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`);
    setClauses.push('updated_at = now()');

    const { rows } = await db.query(
      `UPDATE student_major_goals
       SET ${setClauses.join(', ')}
       WHERE id = $${fields.length + 1} AND user_id = $${fields.length + 2}
       RETURNING id, major_req_id, status, declared_at, updated_at,
                 application_deadline, checklist_progress`,
      [...values, req.params.id, req.user.id]
    );

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/goals/major/:id/checklist
router.patch('/major/:id/checklist', requireAuth, async (req, res, next) => {
  try {
    const { step_id, completed } = req.body;

    if (!step_id) return res.status(400).json({ error: 'step_id is required' });
    if (completed === undefined) return res.status(400).json({ error: 'completed is required' });

    const { rows: existing } = await db.query(
      'SELECT id FROM student_major_goals WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Goal not found' });

    const { rows } = await db.query(
      `UPDATE student_major_goals
       SET checklist_progress = checklist_progress || jsonb_build_object($1::text, $2::boolean),
           updated_at = now()
       WHERE id = $3 AND user_id = $4
       RETURNING id, major_req_id, status, updated_at, checklist_progress`,
      [step_id, completed, req.params.id, req.user.id]
    );

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
