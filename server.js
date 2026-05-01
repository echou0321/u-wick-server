require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`u-wick-api listening on port ${PORT}`);
  require('./src/jobs');
});
