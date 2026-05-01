const cron = require('node-cron');
const db = require('../db');
const { sendPush } = require('../lib/expoPush');

// 9am Pacific (UTC-7 spring) = 16:00 UTC — hardcoded for UW user study
cron.schedule('0 16 * * *', async () => {
  try {
    const { rows: goals } = await db.query(`
      SELECT g.id, g.application_deadline,
             g.reminder_30d_sent, g.reminder_7d_sent, g.reminder_1d_sent,
             m.major_name, u.expo_push_token
      FROM student_major_goals g
      JOIN major_requirements m ON m.id = g.major_req_id
      JOIN users u ON u.id = g.user_id
      WHERE g.status = 'active'
        AND g.application_deadline IS NOT NULL
        AND u.expo_push_token IS NOT NULL
    `);
    for (const goal of goals) {
      const daysLeft = (new Date(goal.application_deadline) - new Date()) / (1000 * 60 * 60 * 24);
      try {
        if (daysLeft <= 1 && !goal.reminder_1d_sent) {
          await sendPush(
            goal.expo_push_token,
            'Application deadline tomorrow!',
            `Your ${goal.major_name} application is due tomorrow.\nTap to view your checklist.`,
            { screen: 'advising' }
          );
          await db.query('UPDATE student_major_goals SET reminder_1d_sent = true WHERE id = $1', [goal.id]);
        } else if (daysLeft <= 7 && !goal.reminder_7d_sent) {
          await sendPush(
            goal.expo_push_token,
            '1 week until your deadline',
            `Your ${goal.major_name} application is due in 7 days.\nTap to view your checklist.`,
            { screen: 'advising' }
          );
          await db.query('UPDATE student_major_goals SET reminder_7d_sent = true WHERE id = $1', [goal.id]);
        } else if (daysLeft <= 30 && !goal.reminder_30d_sent) {
          await sendPush(
            goal.expo_push_token,
            '30 days until your deadline',
            `Your ${goal.major_name} application deadline is coming up.\nTap to view your checklist.`,
            { screen: 'advising' }
          );
          await db.query('UPDATE student_major_goals SET reminder_30d_sent = true WHERE id = $1', [goal.id]);
        }
      } catch (err) {
        console.error(`[cron] majorReminders failed for goal ${goal.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[cron] majorReminders query failed:', err.message);
  }
});
