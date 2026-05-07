const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { buildSystemPrompt } = require('../lib/chatContext');

const anthropic = new Anthropic();

const VALID_FLOWS = ['planning', 'proactive', 'advising', 'quarter_planning', 'free'];
const SIDE_EFFECT_RE = /<side_effects>\s*([\s\S]*?)\s*<\/side_effects>/;

async function applySideEffect(userId, effect) {
  if (!effect || !effect.action) return;

  if (effect.action === 'add_study_blocks') {
    for (const block of effect.payload || []) {
      await db.query(
        `INSERT INTO schedule_blocks (user_id, title, start_time, end_time, block_type, source, color)
         VALUES ($1, $2, $3, $4, $5, 'ai_generated', $6)`,
        [userId, block.title, block.start, block.end, block.block_type || 'study', block.color || null]
      );
    }
  }

  if (effect.action === 'complete_task') {
    await db.query(
      'UPDATE tasks SET done = true WHERE id = $1 AND user_id = $2',
      [effect.payload.task_id, userId]
    );
  }
}

// POST /api/chat
router.post('/', requireAuth, async (req, res, next) => {
  const { message, flow = 'free' } = req.body;

  if (!message || !message.trim()) return res.status(400).json({ error: 'message is required' });
  if (!VALID_FLOWS.includes(flow)) {
    return res.status(400).json({ error: `flow must be one of: ${VALID_FLOWS.join(', ')}` });
  }

  // Do all DB work before switching to SSE mode so errors return proper HTTP codes
  let systemPrompt, conversationHistory;
  try {
    await db.query(
      'INSERT INTO chat_messages (user_id, flow, role, content) VALUES ($1, $2, $3, $4)',
      [req.user.id, flow, 'user', message.trim()]
    );

    [systemPrompt, conversationHistory] = await Promise.all([
      buildSystemPrompt(req.user.id, flow),
      db.query(
        `SELECT role, content FROM chat_messages
         WHERE user_id = $1 AND flow = $2
         ORDER BY created_at DESC LIMIT 20`,
        [req.user.id, flow]
      ).then(r => r.rows.reverse().map(row => ({ role: row.role, content: row.content }))),
    ]);
  } catch (err) {
    return next(err);
  }

  // Switch to SSE — no more JSON error responses past this point
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: conversationHistory,
    });

    let fullText = '';
    stream.on('text', (delta) => {
      fullText += delta;
      sendEvent({ type: 'token', content: delta });
    });

    await stream.finalMessage();

    // Parse and apply side-effects
    let sideEffect = null;
    const match = fullText.match(SIDE_EFFECT_RE);
    if (match) {
      try {
        sideEffect = JSON.parse(match[1]);
        await applySideEffect(req.user.id, sideEffect);
      } catch (e) {
        console.error('Side-effect parse/apply error:', e);
      }
    }

    // Store clean assistant text (strip side_effects block)
    const cleanText = fullText.replace(SIDE_EFFECT_RE, '').trim();
    await db.query(
      'INSERT INTO chat_messages (user_id, flow, role, content) VALUES ($1, $2, $3, $4)',
      [req.user.id, flow, 'assistant', cleanText]
    );

    if (sideEffect) sendEvent({ type: 'side_effects', actions: sideEffect });
    sendEvent({ type: 'done' });
    res.end();
  } catch (err) {
    console.error('Claude stream error:', err);
    sendEvent({ type: 'error', message: 'Failed to get response from Claude' });
    res.end();
  }
});

// GET /api/chat/history
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const { flow, limit = '50' } = req.query;
    const cap = Math.min(parseInt(limit) || 50, 200);

    const params = [req.user.id];
    let query = 'SELECT id, role, content, flow, created_at FROM chat_messages WHERE user_id = $1';
    if (flow) {
      if (!VALID_FLOWS.includes(flow)) {
        return res.status(400).json({ error: `flow must be one of: ${VALID_FLOWS.join(', ')}` });
      }
      params.push(flow);
      query += ` AND flow = $${params.length}`;
    }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(cap);

    const { rows } = await db.query(query, params);
    res.json(rows.reverse());
  } catch (err) {
    next(err);
  }
});

// DELETE /api/chat/history
router.delete('/history', requireAuth, async (req, res, next) => {
  try {
    const { flow } = req.query;
    if (!flow) return res.status(400).json({ error: 'flow query param is required' });
    if (!VALID_FLOWS.includes(flow)) {
      return res.status(400).json({ error: `flow must be one of: ${VALID_FLOWS.join(', ')}` });
    }

    const { rowCount } = await db.query(
      'DELETE FROM chat_messages WHERE user_id = $1 AND flow = $2',
      [req.user.id, flow]
    );
    res.json({ deleted: rowCount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
