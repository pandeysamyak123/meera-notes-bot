import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOICE_SKILL_PATH = path.join(__dirname, '..', 'voice-skill.txt');

// Reads voice-skill.txt fresh on every call so editing that file (e.g.
// re-uploading a new version) takes effect without a code change.
export function loadVoiceInstructions() {
  return readFileSync(VOICE_SKILL_PATH, 'utf-8');
}
