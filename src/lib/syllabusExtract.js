const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

async function extractTasksWithClaude(text, courseName) {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Extract all assignments, exams, quizzes, and graded work from this syllabus for "${courseName}".

Return ONLY a JSON array with no prose before or after. Each element:
{
  "title": "assignment name",
  "due_date": "YYYY-MM-DD or null if not specified",
  "type": "exam|quiz|paper|lab|reading|other",
  "weight": <number>
}

Weight guide: 3.0=final exam/project, 2.5=midterm/major paper, 1.5=lab report, 1.0=quiz/short assignment, 0.5=reading/participation

Syllabus text:
${text}`,
    }],
  });

  const raw = msg.content[0].text.trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '');
  return JSON.parse(raw);
}

module.exports = { extractTasksWithClaude };
