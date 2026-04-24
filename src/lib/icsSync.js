const axios = require('axios');
const ICAL = require('ical.js');
const db = require('../db');

// Find or create a course row for this user. Returns the course id.
async function findOrCreateCourse(userId, name, quarter) {
  const existing = await db.query(
    'SELECT id FROM courses WHERE user_id = $1 AND name = $2',
    [userId, name]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const res = await db.query(
    `INSERT INTO courses (user_id, name, quarter, source)
     VALUES ($1, $2, $3, 'ics')
     RETURNING id`,
    [userId, name, quarter || null]
  );
  return res.rows[0].id;
}

// Upsert a single task identified by ics_uid + user_id.
async function upsertTask(userId, courseId, summary, dueDate, uid) {
  const existing = await db.query(
    'SELECT id FROM tasks WHERE user_id = $1 AND ics_uid = $2',
    [userId, uid]
  );
  if (existing.rows.length) {
    await db.query(
      `UPDATE tasks SET title = $1, due_date = $2, course_id = $3
       WHERE id = $4`,
      [summary, dueDate, courseId, existing.rows[0].id]
    );
  } else {
    await db.query(
      `INSERT INTO tasks (user_id, course_id, title, due_date, source, ics_uid)
       VALUES ($1, $2, $3, $4, 'ics', $5)`,
      [userId, courseId, summary, dueDate, uid]
    );
  }
}

// Parse raw .ics text and upsert courses + tasks. Returns { synced, courses }.
async function parseAndUpsert(userId, icsText, userQuarter) {
  const jcal = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents('vevent');

  const courseCache = {}; // name -> course_id
  let synced = 0;

  for (const vevent of vevents) {
    const uid = vevent.getFirstPropertyValue('uid');
    if (!uid) continue;

    const summary = vevent.getFirstPropertyValue('summary') || 'Untitled';
    const dtstart = vevent.getFirstPropertyValue('dtstart');
    const dueDate = dtstart ? dtstart.toJSDate() : null;

    // Try to derive a course name from CATEGORIES or summary prefix
    let courseName = null;
    const categories = vevent.getFirstPropertyValue('categories');
    if (categories) {
      courseName = Array.isArray(categories) ? categories[0] : String(categories);
    }
    if (!courseName) {
      // Canvas puts "COURSE 123 - Assignment Title"
      const match = summary.match(/^([A-Z]+ \d+[A-Z]?)\s*[-–]/);
      if (match) courseName = match[1];
    }

    let courseId = null;
    if (courseName) {
      if (!courseCache[courseName]) {
        courseCache[courseName] = await findOrCreateCourse(userId, courseName, userQuarter);
      }
      courseId = courseCache[courseName];
    }

    await upsertTask(userId, courseId, summary, dueDate, uid);
    synced++;
  }

  return { synced, courses: Object.keys(courseCache) };
}

// Fetch the ICS URL, parse it, upsert into DB, and update the user's record.
async function fetchAndSync(userId, icsUrl, userQuarter) {
  const response = await axios.get(icsUrl, {
    timeout: 10000,
    headers: { 'User-Agent': 'u-wick-api/0.1' },
  });
  const { synced, courses } = await parseAndUpsert(userId, response.data, userQuarter);

  await db.query(
    'UPDATE users SET ics_url = $1, ics_last_synced = NOW() WHERE id = $2',
    [icsUrl, userId]
  );

  return { synced, courses };
}

module.exports = { fetchAndSync, parseAndUpsert };
