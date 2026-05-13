const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const taskRoutes = require('./routes/tasks');
const scheduleRoutes = require('./routes/schedule');
const chatRoutes = require('./routes/chat');
const icsRoutes = require('./routes/ics');
const syllabusRoutes = require('./routes/syllabus');
const majorRoutes = require('./routes/majors');
const goalRoutes = require('./routes/goals');
const sessionRoutes = require('./routes/sessions');
const courseRoutes = require('./routes/courses');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/ics', icsRoutes);
app.use('/api/syllabus', syllabusRoutes);
app.use('/api/majors', majorRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/courses', courseRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
