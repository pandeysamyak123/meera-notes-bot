// Runs the same note through Gemini and Claude so you can compare voice
// fidelity side by side. Requires GEMINI_API_KEY and ANTHROPIC_API_KEY.
//
// Usage: node scripts/compare-models.js "the note text goes here"

import 'dotenv/config';
import { generateDraft } from '../lib/gemini.js';
import { generateDraftClaude } from '../lib/claude.js';

const note = process.argv.slice(2).join(' ');

if (!note) {
  console.error('Usage: node scripts/compare-models.js "the note text goes here"');
  process.exit(1);
}

const [geminiResult, claudeText] = await Promise.all([
  generateDraft(note),
  generateDraftClaude(note),
]);

console.log('\n=== GEMINI ===\n');
console.log(geminiResult.draft);
console.log('\n=== CLAUDE ===\n');
console.log(claudeText);
console.log('');
