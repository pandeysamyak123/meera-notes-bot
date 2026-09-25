import { GoogleGenerativeAI } from '@google/generative-ai';
import { loadVoiceInstructions } from './voice.js';

let cachedClient = null;

function getClient() {
  if (!cachedClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    cachedClient = new GoogleGenerativeAI(apiKey);
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

export async function generateDraft(note) {
  const genAI = getClient();
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const model = genAI.getGenerativeModel({ model: modelName });

  const voiceInstructions = loadVoiceInstructions();
  const prompt = buildPrompt(note, voiceInstructions);
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return text.trim();
}
