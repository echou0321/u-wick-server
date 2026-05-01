const cron = require('node-cron');
const db = require('../db');
const { sendPush } = require('../lib/expoPush');

cron.schedule('0 */6 * * *', async () => {
  try {
    const { rows } = await db.query(`
      SELECT t.id, t.title, u.expo_push_token
      FROM tasks t
      JOIN users u ON u.id = t.user_id
      WHERE t.done = false
        AND t.weight >= 2.0
        AND t.due_date BETWEEN NOW() AND NOW() + INTERVAL '72 hours'
        AND u.expo_push_token IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM schedule_blocks sb
          WHERE sb.user_id = t.user_id
            AND sb.course_id = t.course_id
            AND sb.block_type = 'study'
            AND sb.start_time < t.due_date
        )
    `);
    for (const task of rows) {
      try {
        await sendPush(
          task.expo_push_token,
          'Start this now',
          `"${task.title}" is due soon — no study time blocked yet.\nTap to view tasks.`,
          { screen: 'tasks', taskId: task.id }
        );
      } catch (err) {
        console.error('[cron] startThisNow push failed:', err.message);
      }
    }
    if (rows.length) console.log(`[cron] startThisNow sent ${rows.length} nudge(s)`);
  } catch (err) {
    console.error('[cron] startThisNow query failed:', err.message);
  }
});
