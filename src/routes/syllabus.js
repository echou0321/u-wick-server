const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { extractTasksWithClaude } = require('../lib/syllabusExtract');

// POST /api/syllabus
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { course_id, quarter, text } = req.body;
    if (!course_id) return res.status(400).json({ error: 'course_id is required' });
    if (!quarter) return res.status(400).json({ error: 'quarter is required' });
    if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });

    const { rows: courses } = await db.query(
      'SELECT id, name FROM courses WHERE id = $1 AND user_id = $2',
      [course_id, req.user.id]
    );
    if (courses.length === 0) return res.status(404).json({ error: 'Course not found' });

    let tasks;
    try {
      tasks = await extractTasksWithClaude(text.trim(), courses[0].name);
    } catch (err) {
      console.error('Claude extraction failed:', err);
      return res.status(502).json({ error: 'Failed to extract tasks from syllabus text' });
    }

    const { rows } = await db.query(
      `INSERT INTO syllabi (user_id, course_id, quarter, extracted_text, pending_tasks, parse_status, parsed_at)
       VALUES ($1, $2, $3, $4, $5, 'ready', now())
       ON CONFLICT (user_id, course_id, quarter)
       DO UPDATE SET extracted_text = $4, pending_tasks = $5, parse_status = 'ready', parsed_at = now()
       RETURNING id`,
      [req.user.id, course_id, quarter, text.trim(), JSON.stringify(tasks)]
    );

    res.status(201).json({ jobId: rows[0].id, tasks });
  } catch (err) {
    next(err);
  }
});

// GET /api/syllabus/status/:jobId
router.get('/status/:jobId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, parse_status, pending_tasks, parsed_at FROM syllabi WHERE id = $1 AND user_id = $2',
      [req.params.jobId, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Syllabus not found' });

    const row = rows[0];
    res.json({ jobId: row.id, status: row.parse_status, tasks: row.pending_tasks, parsed_at: row.parsed_at });
  } catch (err) {
    next(err);
  }
});

// POST /api/syllabus/confirm/:jobId
router.post('/confirm/:jobId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, course_id, pending_tasks, parse_status FROM syllabi WHERE id = $1 AND user_id = $2',
      [req.params.jobId, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Syllabus not found' });

    const syl = rows[0];
    if (syl.parse_status !== 'ready') {
      return res.status(400).json({ error: `Syllabus is not ready (status: ${syl.parse_status})` });
    }

    const tasks = syl.pending_tasks || [];
    let inserted = 0;
    for (const task of tasks) {
      if (!task.title) continue;
      await db.query(
        `INSERT INTO tasks (user_id, course_id, title, due_date, weight, source)
         VALUES ($1, $2, $3, $4, $5, 'syllabus')`,
        [req.user.id, syl.course_id, task.title, task.due_date || null, task.weight || 1.0]
      );
      inserted++;
    }

    res.json({ inserted, jobId: syl.id });
  } catch (err) {
    next(err);
  }
});

// GET /api/syllabus
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.course_id, s.quarter, s.parse_status, s.parsed_at,
              c.name AS course_name, c.code AS course_code
       FROM syllabi s
       JOIN courses c ON c.id = s.course_id
       WHERE s.user_id = $1
       ORDER BY s.parsed_at DESC NULLS LAST`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
