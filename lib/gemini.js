import { getGenerativeModel, generateContentWithRetry } from './gemini-client.js';
import { getVoiceInstructions } from './supabase.js';

function buildPrompt(note, voiceInstructions, newsItem) {
  const lines = [
    voiceInstructions.trim(),
    '',
    '---',
    '',
    "Here is Meera's raw note, exactly as she sent it:",
    '"""',
    note.trim(),
    '"""',
  ];

  if (newsItem) {
    lines.push(
      '',
      'Here is a news item that may be related:',
      `Headline: ${newsItem.headline}`,
      `Source: ${newsItem.source}${newsItem.date ? ` (${newsItem.date})` : ''}`,
      '',
      'If this news item is genuinely relevant, use it to make the post timely.',
      "If it doesn't fit naturally, ignore it completely and don't mention it."
    );
  }

  lines.push(
    '',
    "Turn this into a polished draft post in Meera's voice, following the",
    'instructions above. Keep her intent and key facts intact - do not invent',
    'details that were not in the note. Output ONLY the draft post text',
    '(no preamble like "Here is a draft:", no explanations, no quotation marks',
    'around the whole thing).'
  );

  if (newsItem) {
    lines.push(
      '',
      'On the very last line of your reply, after the draft, add exactly one',
      'of these two lines (nothing else):',
      'NEWS_USED: yes',
      'NEWS_USED: no',
      '(yes only if you actually referenced the news item in the draft above)'
    );
  }

  return lines.join('\n');
}

function formatVerifyBlock(newsItem) {
  return [
    '---',
    `NEWS SOURCE: ${newsItem.headline}`,
    `FROM: ${newsItem.source}${newsItem.date ? ` · ${newsItem.date}` : ''}`,
    `LINK: ${newsItem.link || 'n/a'}`,
    '⚠️ Check this before publishing - you are the author of this claim',
    '---',
  ].join('\n');
}

// Returns { draft, usedNews }. When newsItem is used, the exact source
// fields are appended in code (not left to the model) so the link and date
// shown to Meera are always the real fetched values, never paraphrased.
export async function generateDraft(note, newsItem = null) {
  const model = getGenerativeModel();
  const voiceInstructions = await getVoiceInstructions();
  const prompt = buildPrompt(note, voiceInstructions, newsItem);
  const result = await generateContentWithRetry(model, prompt);
  let text = result.response.text().trim();

  let usedNews = false;
  if (newsItem) {
    const usedMatch = text.match(/NEWS_USED:\s*(yes|no)\s*$/i);
    if (usedMatch) {
      usedNews = usedMatch[1].toLowerCase() === 'yes';
      text = text.slice(0, usedMatch.index).trim();
    }
  }

  const draft = usedNews ? `${text}\n\n${formatVerifyBlock(newsItem)}` : text;
  return { draft, usedNews };
}
