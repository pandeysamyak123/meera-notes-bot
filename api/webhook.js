import { generateDraft } from '../lib/gemini.js';
import { scoreNote, passesScore } from '../lib/scoring.js';
import { extractSearchQuery, fetchTopNews } from '../lib/news.js';
import { sendTelegramMessage, sendTypingAction } from '../lib/telegram.js';
import {
  saveNote,
  saveDraft,
  findPendingDraft,
  updateDraftStatus,
} from '../lib/supabase.js';

async function handleApproval(chatId, replyToMessageId, decision) {
  const draft = await findPendingDraft({ chatId, replyToTelegramMessageId: replyToMessageId });

  if (!draft) {
    await sendTelegramMessage(chatId, "I don't have a pending draft to update. Send a note first.");
    return;
  }
  if (draft.status !== 'pending') {
    await sendTelegramMessage(chatId, `That draft was already marked ${draft.status}.`);
    return;
  }

  await updateDraftStatus(draft.id, decision);
  await sendTelegramMessage(
    chatId,
    decision === 'approved' ? 'Marked as approved.' : 'Marked as rejected - noted for later.'
  );
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

  const sentMessageId = await sendTelegramMessage(chatId, draft);

  await saveDraft({
    noteId,
    draftText: draft,
    news: usedNews ? newsItem : null,
    telegramMessageId: sentMessageId,
  });
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
        "Hi! Send me a note and I'll turn it into a draft post in your voice. Reply APPROVE or REJECT to a draft to record your decision."
      );
      res.status(200).send('ok');
      return;
    }

    if (/^approve$/i.test(trimmed)) {
      await handleApproval(chatId, replyToMessageId, 'approved');
      res.status(200).send('ok');
      return;
    }

    if (/^reject$/i.test(trimmed)) {
      await handleApproval(chatId, replyToMessageId, 'rejected');
      res.status(200).send('ok');
      return;
    }

    await handleNote(chatId, messageId, text);
    res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook error:', err);
    try {
      const chatId = req.body?.message?.chat?.id;
      if (chatId) {
        await sendTelegramMessage(
          chatId,
          'Sorry, something went wrong generating that draft. Please try again.'
        );
      }
    } catch (notifyErr) {
      console.error('Failed to notify user of error:', notifyErr);
    }
    res.status(200).send('ok');
  }
}
