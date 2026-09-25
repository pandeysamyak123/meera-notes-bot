import { createClient } from '@supabase/supabase-js';

let cachedClient = null;

function getClient() {
  if (!cachedClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL / SUPABASE_KEY are not set');
    }
    cachedClient = createClient(url, key);
  }
  return cachedClient;
}

// Voice skill is stored in the database (single row, id=1) so it can be
// updated without a redeploy. Falls back to the bundled voice-skill.txt if
// the database is unreachable or hasn't been seeded yet.
export async function getVoiceInstructions() {
  try {
    const { data, error } = await getClient()
      .from('meera_voice_skill')
      .select('content')
      .eq('id', 1)
      .single();

    if (error || !data) {
      throw error || new Error('No voice skill row found');
    }
    return data.content;
  } catch (err) {
    console.error('Falling back to local voice-skill.txt:', err.message);
    const { loadVoiceInstructionsFromFile } = await import('./voice.js');
    return loadVoiceInstructionsFromFile();
  }
}

export async function saveNote({ chatId, telegramMessageId, text, score, scoreReason }) {
  const { data, error } = await getClient()
    .from('meera_notes')
    .insert({
      telegram_chat_id: chatId,
      telegram_message_id: telegramMessageId,
      text,
      score,
      score_reason: scoreReason,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Failed to save note:', error);
    return null;
  }
  return data.id;
}

export async function saveDraft({ noteId, draftText, news, telegramMessageId }) {
  const { data, error } = await getClient()
    .from('meera_drafts')
    .insert({
      note_id: noteId,
      draft_text: draftText,
      news_headline: news?.headline ?? null,
      news_source: news?.source ?? null,
      news_date: news?.date ?? null,
      news_link: news?.link ?? null,
      telegram_message_id: telegramMessageId,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    console.error('Failed to save draft:', error);
    return null;
  }
  return data.id;
}

// Resolves which pending draft a Telegram reply refers to: prefer an exact
// match on the message being replied to, otherwise fall back to the most
// recent pending draft in that chat.
export async function findPendingDraft({ chatId, replyToTelegramMessageId }) {
  const client = getClient();

  if (replyToTelegramMessageId) {
    const { data } = await client
      .from('meera_drafts')
      .select('id, note_id, status, draft_text')
      .eq('telegram_message_id', replyToTelegramMessageId)
      .maybeSingle();
    if (data) return data;
  }

  const { data: notes } = await client
    .from('meera_notes')
    .select('id')
    .eq('telegram_chat_id', chatId);
  const noteIds = (notes || []).map((n) => n.id);
  if (noteIds.length === 0) return null;

  const { data } = await client
    .from('meera_drafts')
    .select('id, note_id, status, draft_text')
    .in('note_id', noteIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data || null;
}

export async function updateDraftStatus(draftId, status) {
  const { error } = await getClient()
    .from('meera_drafts')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', draftId);

  if (error) {
    console.error('Failed to update draft status:', error);
    return false;
  }
  return true;
}

export async function markDraftPosted(draftId, linkedinPostUrn) {
  const { error } = await getClient()
    .from('meera_drafts')
    .update({
      status: 'approved',
      linkedin_post_urn: linkedinPostUrn,
      linkedin_posted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', draftId);

  if (error) {
    console.error('Failed to mark draft as posted:', error);
    return false;
  }
  return true;
}
