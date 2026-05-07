const db = require('../db');

const FLOW_INSTRUCTIONS = {
  planning: 'You are in PLANNING mode. Help the student build or refine their weekly study schedule. Ask about commitments and preferred study times. Suggest adding study blocks when appropriate.',
  proactive: 'You are in PROACTIVE mode. Surface upcoming risks: overloaded weeks, missing study blocks for high-weight assignments, approaching deadlines.',
  advising: 'You are in ADVISING mode. Answer questions about major requirements, prerequisites, application deadlines, and syllabus content using the injected data above.',
  quarter_planning: 'You are in QUARTER PLANNING mode. Map out the full quarter, identify heavy weeks from the task list, and suggest when to start major assignments.',
  free: 'You are in FREE mode. Handle open-ended questions: am I on track, what should I study tonight, workload check-ins.',
};

const SIDE_EFFECT_SCHEMA = `When you want to add study blocks or mark a task complete, append this block at the very end of your response — after all conversational text:

<side_effects>
{ "action": "add_study_blocks", "payload": [{ "title": "Study: MATH 126", "start": "2026-05-10T14:00:00-07:00", "end": "2026-05-10T16:00:00-07:00", "block_type": "study", "color": "#6AF7C8" }] }
</side_effects>

OR

<side_effects>
{ "action": "complete_task", "payload": { "task_id": "<uuid>" } }
</side_effects>

Only include <side_effects> when you are actually scheduling a block or marking a task done. Omit it entirely for normal conversational responses.`;

const GUARDRAILS = `Guardrails: Stay focused on academic planning. Do not give medical or legal advice. If a student mentions mental health struggles, acknowledge warmly and suggest the UW Counseling Center.`;

async function buildSystemPrompt(userId, flow) {
  const now = new Date();

  const [userRes, coursesRes, tasksRes, blocksRes, syllabiRes, goalsRes] = await Promise.all([
    db.query(
      'SELECT display_name, major, enrollment_status, current_quarter FROM users WHERE id = $1',
      [userId]
    ),
    db.query(
      'SELECT name, code FROM courses WHERE user_id = $1 AND quarter = (SELECT current_quarter FROM users WHERE id = $1)',
      [userId]
    ),
    db.query(
      `SELECT t.title, t.due_date, t.weight, c.name AS course_name
       FROM tasks t LEFT JOIN courses c ON c.id = t.course_id
       WHERE t.user_id = $1 AND t.done = false
         AND t.due_date BETWEEN now() AND now() + INTERVAL '14 days'
       ORDER BY t.due_date`,
      [userId]
    ),
    db.query(
      `SELECT title, start_time, end_time, block_type
       FROM schedule_blocks
       WHERE user_id = $1 AND start_time BETWEEN now() AND now() + INTERVAL '7 days'
       ORDER BY start_time`,
      [userId]
    ),
    db.query(
      `SELECT c.name AS course_name, s.extracted_text
       FROM syllabi s JOIN courses c ON c.id = s.course_id
       WHERE s.user_id = $1
         AND s.quarter = (SELECT current_quarter FROM users WHERE id = $1)
         AND s.parse_status = 'ready'`,
      [userId]
    ),
    db.query(
      `SELECT g.id AS goal_id, g.application_deadline, g.checklist_progress,
              mr.major_name, mr.prereqs, mr.checklist_steps, mr.min_gpa
       FROM student_major_goals g JOIN major_requirements mr ON mr.id = g.major_req_id
       WHERE g.user_id = $1 AND g.status = 'active'`,
      [userId]
    ),
  ]);

  const user = userRes.rows[0];
  const quarter = user.current_quarter || 'current quarter';

  const parts = [
    `You are U-Wick, an AI academic planning assistant for University of Washington students. Be concise, warm, and practical.`,
    `Today is ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
    `Student: ${user.display_name}${user.major ? `, ${user.major}` : ''}${user.enrollment_status ? ` (${user.enrollment_status})` : ''}. Current quarter: ${quarter}.`,
  ];

  if (coursesRes.rows.length > 0) {
    parts.push(`Courses this quarter: ${coursesRes.rows.map(c => c.code ? `${c.name} (${c.code})` : c.name).join(', ')}.`);
  }

  if (tasksRes.rows.length > 0) {
    const taskLines = tasksRes.rows.map(t =>
      `- ${t.title}${t.course_name ? ` [${t.course_name}]` : ''} — due ${new Date(t.due_date).toLocaleDateString()} (weight: ${t.weight})`
    );
    parts.push(`Upcoming tasks (next 14 days):\n${taskLines.join('\n')}`);
  } else {
    parts.push('No upcoming tasks in the next 14 days.');
  }

  if (blocksRes.rows.length > 0) {
    const blockLines = blocksRes.rows.map(b =>
      `- ${b.title} (${b.block_type}): ${new Date(b.start_time).toLocaleString()} – ${new Date(b.end_time).toLocaleString()}`
    );
    parts.push(`Schedule (next 7 days):\n${blockLines.join('\n')}`);
  }

  for (const syl of syllabiRes.rows) {
    parts.push(`Syllabus — ${syl.course_name}:\n${syl.extracted_text}`);
  }

  for (const g of goalsRes.rows) {
    const steps = g.checklist_steps || [];
    const progress = g.checklist_progress || {};
    const remaining = steps.filter((_, i) => !progress[i]);
    const deadlineStr = g.application_deadline
      ? ` — deadline: ${new Date(g.application_deadline).toLocaleDateString()}`
      : '';
    const gpaStr = g.min_gpa ? ` — min GPA: ${g.min_gpa}` : '';
    const stepsStr = remaining.length > 0
      ? `\n  Remaining steps: ${remaining.join('; ')}`
      : '\n  All checklist steps complete!';
    parts.push(`Major goal: ${g.major_name}${deadlineStr}${gpaStr}${stepsStr}`);
  }

  if (FLOW_INSTRUCTIONS[flow]) parts.push(FLOW_INSTRUCTIONS[flow]);
  parts.push(SIDE_EFFECT_SCHEMA);
  parts.push(GUARDRAILS);

  return parts.join('\n\n');
}

module.exports = { buildSystemPrompt };
