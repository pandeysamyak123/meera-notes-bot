import { generateDraft } from '../lib/gemini.js';
import { sendTelegramMessage, sendTypingAction } from '../lib/telegram.js';

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

    const allowedChatId = process.env.ALLOWED_CHAT_ID;
    if (allowedChatId && String(chatId) !== String(allowedChatId)) {
      res.status(200).send('ok');
      return;
    }

    if (text.trim() === '/start') {
      await sendTelegramMessage(
        chatId,
        "Hi! Send me a note and I'll turn it into a draft post in your voice."
      );
      res.status(200).send('ok');
      return;
    }

    await sendTypingAction(chatId);

    const draft = await generateDraft(text);

    await sendTelegramMessage(chatId, draft);

    res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook error:', err);
    try {
      const chatId = req.body && req.body.message && req.body.message.chat && req.body.message.chat.id;
      if (chatId) {
        await sendTelegramMessage(
          chatId,
          "Sorry, something went wrong generating that draft. Please try again."
        );
      }
    } catch (notifyErr) {
      console.error('Failed to notify user of error:', notifyErr);
    }
    res.status(200).send('ok');
  }
}
