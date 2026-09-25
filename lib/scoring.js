import { getGenerativeModel } from './gemini-client.js';

const SCORE_PASS_THRESHOLD = 6;

function buildScoringPrompt(note) {
  return [
    "You are screening raw text notes sent by a founder to decide which ones",
    'are worth turning into a social post, and which are just logistics,',
    'reminders, or abandoned half-thoughts with nothing to say.',
    '',
    'Note:',
    '"""',
    note.trim(),
    '"""',
    '',
    'Score how much substance this note has for a real post, from 0-10:',
    '- 0-3: a task, reminder, or fragment with no real point',
    '- 4-5: a partial idea, missing the specific detail that would make it worth posting',
    '- 6-10: a concrete claim, story, or opinion with enough substance for a post',
    '',
    'Reply in EXACTLY this format, nothing else:',
    'SCORE: <integer 0-10>',
    'REASON: <one sentence>',
  ].join('\n');
}

function parseScoreResponse(text) {
  const scoreMatch = text.match(/SCORE:\s*(\d+)/i);
  const reasonMatch = text.match(/REASON:\s*(.+)/i);
  if (!scoreMatch) {
    return null;
  }
  return {
    score: Math.max(0, Math.min(10, parseInt(scoreMatch[1], 10))),
    reason: reasonMatch ? reasonMatch[1].trim() : '',
  };
}

export async function scoreNote(note) {
  const model = getGenerativeModel();
  const result = await model.generateContent(buildScoringPrompt(note));
  const text = result.response.text();

  const parsed = parseScoreResponse(text);
  if (!parsed) {
    console.error('Could not parse scoring response, defaulting to a pass:', text);
    return { score: 7, reason: 'Scoring response was unparseable; defaulted to pass.' };
  }
  return parsed;
}

export function passesScore(score) {
  return score >= SCORE_PASS_THRESHOLD;
}
