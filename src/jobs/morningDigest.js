const cron = require('node-cron');
const db = require('../db');
const { sendPush } = require('../lib/expoPush');

// 8am Pacific (UTC-7 spring) = 15:00 UTC — hardcoded for UW user study
cron.schedule('0 15 * * *', async () => {
  try {
    const { rows: users } = await db.query(
      'SELECT id, expo_push_token FROM users WHERE expo_push_token IS NOT NULL'
    );
    for (const user of users) {
      try {
        const { rows: tasks } = await db.query(
          `SELECT title FROM tasks
           WHERE user_id = $1
             AND done = false
             AND due_date >= CURRENT_DATE
             AND due_date < CURRENT_DATE + INTERVAL '1 day'
           ORDER BY due_date`,
          [user.id]
        );
        if (tasks.length === 0) continue;
        const preview = tasks.length === 1
          ? tasks[0].title
          : `${tasks[0].title} + ${tasks.length - 1} more`;
        await sendPush(
          user.expo_push_token,
          'Good morning',
          `${tasks.length} thing${tasks.length > 1 ? 's' : ''} due today · ${preview}\nTap to view tasks.`,
          { screen: 'tasks' }
        );
      } catch (err) {
        console.error(`[cron] morningDigest push failed for user ${user.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[cron] morningDigest query failed:', err.message);
  }
});
