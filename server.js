const express = require('express');
const app = express();
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.listen(process.env.PORT || 3000, () => console.log('up'));