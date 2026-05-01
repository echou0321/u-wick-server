const axios = require('axios');

async function sendPush(token, title, body, data = {}) {
  if (!token) return;
  await axios.post(
    'https://exp.host/--/expo-push-notification/api/v2/push/send',
    { to: token, title, body, data },
    { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
  );
}

module.exports = { sendPush };
