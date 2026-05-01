const cron = require('node-cron');
const db = require('../db');
const { fetchAndSync } = require('../lib/icsSync');

cron.schedule('0 */6 * * *', async () => {
  console.log('[cron] icsResync starting');
  let success = 0, failed = 0;
  try {
    const { rows } = await db.query(
      'SELECT id, ics_url, current_quarter FROM users WHERE ics_url IS NOT NULL'
    );
    for (const user of rows) {
      try {
        await fetchAndSync(user.id, user.ics_url, user.current_quarter);
        success++;
      } catch (err) {
        console.error(`[cron] icsResync failed for user ${user.id}:`, err.message);
        failed++;
      }
    }
  } catch (err) {
    console.error('[cron] icsResync query failed:', err.message);
  }
  console.log(`[cron] icsResync done — success: ${success}, failed: ${failed}`);
});
