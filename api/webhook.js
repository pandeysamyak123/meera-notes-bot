import { generateDraft } from '../lib/gemini.js';
import { scoreNote, passesScore } from '../lib/scoring.js';
import { extractSearchQuery, fetchTopNews } from '../lib/news.js';
import {
  sendTelegramMessage,
  sendDraftMessage,
  sendTypingAction,
  answerCallbackQuery,
  clearMessageButtons,
} from '../lib/telegram.js';
import {
  saveNote,
  saveDraft,
  setDraftTelegramMessageId,
  getDraftById,
  findPendingDraft,
  updateDraftStatus,
  markDraftPosted,
} from '../lib/supabase.js';
import {
  postToLinkedIn,
  LinkedInNotConnectedError,
  LinkedInTokenExpiredError,
} from '../lib/linkedin.js';

function connectUrl() {
  const base = process.env.APP_BASE_URL || '';
  return `${base}/api/linkedin/connect`;
}

// Shared by both the button-click and the type-the-word-REJECT paths.
// Returns a short result the caller renders as either a chat message or a
// callback-query toast.
async function rejectDraft(draft) {
  if (draft.status !== 'pending') {
    return { ok: false, text: `Already marked ${draft.status}.` };
  }
  await updateDraftStatus(draft.id, 'rejected');
  return { ok: true, text: 'Marked as rejected - noted for later.' };
}

// Shared by both the button-click and the type-the-word-APPROVE paths.
// Posts to LinkedIn and, on success, marks the draft approved+posted.
async function approveDraft(draft) {
  if (draft.status !== 'pending') {
    return { ok: false, text: `Already marked ${draft.status}.` };
  }

  try {
    const { postUrn } = await postToLinkedIn(draft.draft_text);
    await markDraftPosted(draft.id, postUrn || null);
    return { ok: true, text: '✅ Posted to LinkedIn.' };
  } catch (err) {
    if (err instanceof LinkedInNotConnectedError) {
      return {
        ok: false,
        text: `LinkedIn isn't connected yet. Open this link, log in, and approve access, then try again:\n${connectUrl()}`,
      };
    }
    if (err instanceof LinkedInTokenExpiredError) {
      return {
        ok: false,
        text: `Your LinkedIn connection expired. Reconnect here, then try again:\n${connectUrl()}`,
      };
    }
    console.error('LinkedIn post failed:', err);
    return {
      ok: false,
      text: "Couldn't post to LinkedIn (something went wrong on LinkedIn's end). The draft is still pending - try again in a bit.",
    };
  }
}

async function handleCallbackQuery(callbackQuery) {
  const [action, draftId] = (callbackQuery.data || '').split(':');
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  const draft = draftId ? await getDraftById(draftId) : null;

  if (!draft) {
    await answerCallbackQuery(callbackQuery.id, 'Draft not found.');
    return;
  }

  if (action !== 'approve' && action !== 'reject') {
    await answerCallbackQuery(callbackQuery.id, 'Unknown action.');
    return;
  }

  if (draft.status !== 'pending') {
    await answerCallbackQuery(callbackQuery.id, `Already marked ${draft.status}.`);
    if (chatId && messageId) await clearMessageButtons(chatId, messageId);
    return;
  }

  if (action === 'reject') {
    const result = await rejectDraft(draft);
    await answerCallbackQuery(callbackQuery.id, result.text);
    if (chatId && messageId) await clearMessageButtons(chatId, messageId);
    return;
  }

  // Approve can take a few seconds (LinkedIn API call) - acknowledge the tap
  // immediately so the button stops spinning, full result follows as a
  // regular message.
  await answerCallbackQuery(callbackQuery.id, 'Posting to LinkedIn...');
  const result = await approveDraft(draft);
  if (chatId) {
    await sendTelegramMessage(chatId, result.text);
    if (result.ok && messageId) await clearMessageButtons(chatId, messageId);
  }
}

async function handleTextDecision(chatId, replyToMessageId, action) {
  const draft = await findPendingDraft({ chatId, replyToTelegramMessageId: replyToMessageId });
  if (!draft) {
    await sendTelegramMessage(chatId, "I don't have a pending draft to update. Send a note first.");
    return;
  }

  const result = action === 'approve' ? await approveDraft(draft) : await rejectDraft(draft);
  await sendTelegramMessage(chatId, result.text);
}

async function handleNote(chatId, incomingMessageId, note) {
  await sendTypingAction(chatId);

  const { score, reason } = await scoreNote(note);

  if (!passesScore(score)) {
    await saveNote({ chatId, telegramMessageId: incomingMessageId, text: note, score, scoreReason: reason });
    await sendTelegramMessage(chatId, `No draft made (score ${score}/10): ${reason}`);
    return;
  }

  let newsItem = null;
  try {
    const query = await extractSearchQuery(note);
    newsItem = await fetchTopNews(query);
  } catch (err) {
    console.error('News lookup failed, continuing without it:', err);
  }

  const { draft, usedNews } = await generateDraft(note, newsItem);

  const noteId = await saveNote({
    chatId,
    telegramMessageId: incomingMessageId,
    text: note,
    score,
    scoreReason: reason,
  });

  // Saved before sending so the draft's id can be embedded in the
  // Approve/Reject buttons' callback_data.
  const draftId = await saveDraft({
    noteId,
    draftText: draft,
    news: usedNews ? newsItem : null,
    telegramMessageId: null,
  });

  const sentMessageId = await sendDraftMessage(chatId, draft, draftId);
  if (sentMessageId) {
    await setDraftTelegramMessageId(draftId, sentMessageId);
  }
}

export default async function handler(req, res) {
  // Telegram only ever sends POST. Respond 200 to anything else (e.g. a
  // browser hitting the URL directly) so it doesn't look broken.
  if (req.method !== 'POST') {
    res.status(200).send('Meera notes bot is running.');
    return;
  }

  // If TELEGRAM_WEBHOOK_SECRET is set, only accept requests carrying the
  // matching header - this is how you verify a request actually came from
  // Telegram and not some random caller who found the URL.
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (receivedSecret !== expectedSecret) {
      res.status(401).send('unauthorized');
      return;
    }
  }

  // Always resolve with 200 after this point - if we return an error status,
  // Telegram will keep retrying the same update, which usually just leads to
  // duplicate messages rather than any recovery.
  try {
    const update = req.body;

    if (update?.callback_query) {
      const chatId = update.callback_query.message?.chat?.id;
      const allowedChatId = process.env.ALLOWED_CHAT_ID;
      if (!allowedChatId || String(chatId) === String(allowedChatId)) {
        await handleCallbackQuery(update.callback_query);
      }
      res.status(200).send('ok');
      return;
    }

    const message = update && update.message;
    const text = message && message.text;

    if (!message || typeof text !== 'string') {
      res.status(200).send('ok');
      return;
    }

    const chatId = message.chat.id;
    const messageId = message.message_id;
    const replyToMessageId = message.reply_to_message?.message_id ?? null;

    const allowedChatId = process.env.ALLOWED_CHAT_ID;
    if (allowedChatId && String(chatId) !== String(allowedChatId)) {
      res.status(200).send('ok');
      return;
    }

    const trimmed = text.trim();

    if (trimmed === '/start') {
      await sendTelegramMessage(
        chatId,
        "Hi! Send me a note and I'll turn it into a draft post in your voice. Tap the button on a draft to post it to LinkedIn or reject it."
      );
      res.status(200).send('ok');
      return;
    }

    if (/^approve$/i.test(trimmed)) {
      await handleTextDecision(chatId, replyToMessageId, 'approve');
      res.status(200).send('ok');
      return;
    }

    if (/^reject$/i.test(trimmed)) {
      await handleTextDecision(chatId, replyToMessageId, 'reject');
      res.status(200).send('ok');
      return;
    }

    await handleNote(chatId, messageId, text);
    res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook error:', err);
    try {
      const chatId = req.body?.message?.chat?.id || req.body?.callback_query?.message?.chat?.id;
      if (chatId) {
        await sendTelegramMessage(
          chatId,
          "Sorry, something went wrong (likely Gemini being briefly overloaded). Please send that again in a moment."
        );
      }
    } catch (notifyErr) {
      console.error('Failed to notify user of error:', notifyErr);
    }
    res.status(200).send('ok');
  }
}
