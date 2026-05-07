const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/users/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, email, display_name, major, enrollment_status,
              ics_url, ics_last_synced, onboarding_complete,
              notif_active, expo_push_token, current_quarter,
              created_at, last_active
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/users/me
router.patch('/me', requireAuth, async (req, res, next) => {
  const allowed = ['display_name', 'major', 'enrollment_status', 'current_quarter'];
  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  const fields = Object.keys(updates);
  const values = Object.values(updates);
  const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

  try {
    const result = await db.query(
      `UPDATE users SET ${setClause}
       WHERE id = $${fields.length + 1}
       RETURNING id, email, display_name, major, enrollment_status,
                 ics_url, ics_last_synced, onboarding_complete,
                 notif_active, expo_push_token, current_quarter,
                 created_at, last_active`,
      [...values, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/users/me/onboarding/complete
router.post('/me/onboarding/complete', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `UPDATE users SET onboarding_complete = true
       WHERE id = $1
       RETURNING id, email, display_name, onboarding_complete`,
      [req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/users/me/dashboard
router.get('/me/dashboard', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [tasksDueSoon, weekHeat, scheduleToday, nudges] = await Promise.all([
      db.query(
        `SELECT id, course_id, title, due_date, weight, source, done, highlighted
         FROM tasks
         WHERE user_id = $1 AND done = false AND due_date BETWEEN NOW() AND NOW() + INTERVAL '48 hours'
         ORDER BY due_date ASC`,
        [userId]
      ),
      db.query(
        `SELECT COALESCE(SUM(weight), 0) AS raw_score
         FROM tasks
         WHERE user_id = $1 AND done = false
           AND due_date >= date_trunc('week', NOW())
           AND due_date < date_trunc('week', NOW()) + INTERVAL '7 days'`,
        [userId]
      ),
      db.query(
        `SELECT id, course_id, title, start_time, end_time, block_type, color
         FROM schedule_blocks
         WHERE user_id = $1
           AND start_time >= date_trunc('day', NOW())
           AND start_time < date_trunc('day', NOW()) + INTERVAL '1 day'
         ORDER BY start_time ASC`,
        [userId]
      ),
      db.query(
        `SELECT id, type, title, body, scheduled_for, related_task_id
         FROM notifications
         WHERE user_id = $1 AND delivered_at IS NULL AND scheduled_for <= NOW()
         ORDER BY scheduled_for ASC`,
        [userId]
      ),
    ]);

    const raw = parseFloat(weekHeat.rows[0].raw_score);
    let label = 'light', color = '#6AF7C8';
    if (raw >= 8) { label = 'intense'; color = '#F76A6A'; }
    else if (raw >= 5) { label = 'heavy'; color = '#F7A06A'; }
    else if (raw >= 2) { label = 'moderate'; color = '#F7D06A'; }

    res.json({
      tasks_due_soon: tasksDueSoon.rows,
      schedule_today: scheduleToday.rows,
      nudges: nudges.rows,
      heat_this_week: { raw_score: raw, label, color },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/users/me/push-token
router.patch('/me/push-token', requireAuth, async (req, res, next) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  try {
    await db.query(
      'UPDATE users SET expo_push_token = $1, notif_active = true WHERE id = $2',
      [token, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
