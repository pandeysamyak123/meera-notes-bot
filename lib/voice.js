import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOICE_SKILL_PATH = path.join(__dirname, '..', 'voice-skill.txt');

// Fallback used when the database is unreachable, or as the seed value the
// first time meera_voice_skill is populated. The database (see
// lib/supabase.js -> getVoiceInstructions) is the source of truth in
// production so the voice profile can be updated without a redeploy.
export function loadVoiceInstructionsFromFile() {
  return readFileSync(VOICE_SKILL_PATH, 'utf-8');
}
