const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const { fetchAndSync } = require('../lib/icsSync');

const ALLOWED_ICS_HOST = 'canvas.uw.edu';

function validateIcsUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.hostname !== ALLOWED_ICS_HOST) return null;
  return url.toString();
}

// POST /api/ics/connect
router.post('/connect', requireAuth, async (req, res, next) => {
  try {
    const { icsUrl } = req.body;
    if (!icsUrl) return res.status(400).json({ error: 'icsUrl is required' });

    const safeUrl = validateIcsUrl(icsUrl);
    if (!safeUrl) {
      return res.status(400).json({ error: `ICS URL must be from ${ALLOWED_ICS_HOST}` });
    }

    // Fetch user's current_quarter to tag newly created courses
    const userRes = await db.query('SELECT current_quarter FROM users WHERE id = $1', [req.user.id]);
    const quarter = userRes.rows[0]?.current_quarter || null;

    const { synced, courses } = await fetchAndSync(req.user.id, safeUrl, quarter);

    res.status(200).json({ synced, courses });
  } catch (err) {
    next(err);
  }
});

// POST /api/ics/sync
router.post('/sync', requireAuth, async (req, res, next) => {
  try {
    const userRes = await db.query(
      'SELECT ics_url, current_quarter FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userRes.rows[0];
    if (!user?.ics_url) {
      return res.status(400).json({ error: 'No ICS URL connected. Use POST /ics/connect first.' });
    }

    const { synced, courses } = await fetchAndSync(req.user.id, user.ics_url, user.current_quarter);

    res.status(200).json({ synced, courses });
  } catch (err) {
    next(err);
  }
});

// GET /api/ics/status
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const userRes = await db.query(
      'SELECT ics_url, ics_last_synced FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userRes.rows[0];

    const [courseCount, taskCount] = await Promise.all([
      db.query("SELECT COUNT(*) FROM courses WHERE user_id = $1 AND source = 'ics'", [req.user.id]),
      db.query("SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND source = 'ics'", [req.user.id]),
    ]);

    res.json({
      connected: Boolean(user?.ics_url),
      last_synced: user?.ics_last_synced || null,
      course_count: parseInt(courseCount.rows[0].count, 10),
      task_count: parseInt(taskCount.rows[0].count, 10),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
