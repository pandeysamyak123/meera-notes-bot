import Anthropic from '@anthropic-ai/sdk';
import { getVoiceInstructions } from './supabase.js';

let cachedClient = null;

function getClient() {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

function buildPrompt(note, voiceInstructions) {
  return [
    voiceInstructions.trim(),
    '',
    '---',
    '',
    "Here is Meera's raw note, exactly as she sent it:",
    '"""',
    note.trim(),
    '"""',
    '',
    "Turn this into a polished draft post in Meera's voice, following the",
    'instructions above. Keep her intent and key facts intact - do not invent',
    'details that were not in the note. Output ONLY the draft post text',
    '(no preamble like "Here is a draft:", no explanations, no quotation marks',
    'around the whole thing).',
  ].join('\n');
}

export async function generateDraftClaude(note) {
  const client = getClient();
  const voiceInstructions = await getVoiceInstructions();
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: buildPrompt(note, voiceInstructions) }],
  });

  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}
