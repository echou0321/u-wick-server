const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const VALID_FLOWS = ['planning', 'proactive', 'advising', 'quarter_planning', 'free'];

const VALID_EVENT_TYPES = [
  'chat_turn', 'task_completed', 'study_block_added', 'heat_map_toggled',
  'task_breakdown_requested', 'on_track_check', 'nudge_dismissed',
  'syllabus_uploaded', 'ics_synced', 'major_goal_set', 'notif_tapped',
  'session_start', 'session_end',
];

// POST /api/sessions/start
router.post('/start', requireAuth, async (req, res, next) => {
  try {
    const { flow, platform, app_version } = req.body;

    if (flow && !VALID_FLOWS.includes(flow)) {
      return res.status(400).json({ error: `flow must be one of: ${VALID_FLOWS.join(', ')}` });
    }

    const { rows } = await db.query(
      `INSERT INTO chat_sessions (user_id, flow, platform, app_version)
       VALUES ($1, $2, $3, $4)
       RETURNING id, flow, platform, app_version, started_at`,
      [req.user.id, flow || null, platform || null, app_version || null]
    );

    res.status(201).json({ session_id: rows[0].id, started_at: rows[0].started_at });
  } catch (err) {
    next(err);
  }
});

// POST /api/sessions/event
router.post('/event', requireAuth, async (req, res, next) => {
  try {
    const { session_id, event_type, metadata } = req.body;

    if (!session_id) return res.status(400).json({ error: 'session_id is required' });
    if (!event_type) return res.status(400).json({ error: 'event_type is required' });
    if (!VALID_EVENT_TYPES.includes(event_type)) {
      return res.status(400).json({ error: `event_type must be one of: ${VALID_EVENT_TYPES.join(', ')}` });
    }

    const { rows: sessions } = await db.query(
      'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [session_id, req.user.id]
    );
    if (sessions.length === 0) return res.status(404).json({ error: 'Session not found' });

    const { rows } = await db.query(
      `INSERT INTO session_events (session_id, user_id, event_type, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING id, event_type, metadata, occurred_at`,
      [session_id, req.user.id, event_type, JSON.stringify(metadata || {})]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/sessions/end
router.post('/end', requireAuth, async (req, res, next) => {
  try {
    const { session_id } = req.body;

    if (!session_id) return res.status(400).json({ error: 'session_id is required' });

    const { rows: sessions } = await db.query(
      'SELECT id, started_at, ended_at FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [session_id, req.user.id]
    );
    if (sessions.length === 0) return res.status(404).json({ error: 'Session not found' });
    if (sessions[0].ended_at) return res.status(409).json({ error: 'Session already ended' });

    const now = new Date();
    const duration_s = Math.round((now - new Date(sessions[0].started_at)) / 1000);

    const { rows } = await db.query(
      `UPDATE chat_sessions
       SET ended_at = $1, duration_s = $2
       WHERE id = $3
       RETURNING id, flow, started_at, ended_at, duration_s`,
      [now.toISOString(), duration_s, session_id]
    );

    res.json({ session_id: rows[0].id, ended_at: rows[0].ended_at, duration_s: rows[0].duration_s });
  } catch (err) {
    next(err);
  }
});

// GET /api/sessions/export — admin only
router.get('/export', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT
         se.id          AS event_id,
         se.occurred_at,
         se.event_type,
         se.metadata,
         cs.flow,
         cs.platform,
         cs.app_version,
         cs.started_at  AS session_started_at,
         cs.duration_s,
         'P-' || LEFT(u.id::text, 8) AS participant_id
       FROM session_events se
       JOIN chat_sessions cs ON cs.id = se.session_id
       JOIN users u ON u.id = se.user_id
       ORDER BY se.occurred_at`
    );

    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;

    const header = 'event_id,occurred_at,event_type,metadata,flow,platform,app_version,session_started_at,duration_s,participant_id';
    const csvRows = rows.map((r) =>
      [
        r.event_id,
        r.occurred_at,
        r.event_type,
        JSON.stringify(r.metadata || {}),
        r.flow,
        r.platform,
        r.app_version,
        r.session_started_at,
        r.duration_s,
        r.participant_id,
      ].map(escape).join(',')
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="session_export.csv"');
    res.send([header, ...csvRows].join('\n'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
