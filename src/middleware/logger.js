const db = require('../db');

function logEvent(userId, sessionId, eventType, metadata = {}) {
  db.query(
    'INSERT INTO session_events (session_id, user_id, event_type, metadata) VALUES ($1, $2, $3, $4)',
    [sessionId, userId, eventType, JSON.stringify(metadata)]
  ).catch(err => console.error('logEvent failed:', err));
}

module.exports = { logEvent };
