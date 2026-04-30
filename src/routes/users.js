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

module.exports = router;
