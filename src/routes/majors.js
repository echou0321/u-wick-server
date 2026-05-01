const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/majors
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, major_name, department, application_deadline, min_gpa, source_url
       FROM major_requirements
       ORDER BY major_name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/majors/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, major_name, department, source_url, application_deadline,
              min_gpa, prereqs, checklist_steps, last_scraped, notes
       FROM major_requirements
       WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Major not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
