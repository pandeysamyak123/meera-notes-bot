const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

function getBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set');
  }
  return token;
}

async function callTelegram(method, payload) {
  const token = getBotToken();
  const url = `${TELEGRAM_API_BASE}${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Telegram ${method} failed:`, data);
  }
  return data;
}

// Telegram messages are capped at 4096 characters. Split long drafts so
// nothing silently gets truncated.
function chunkText(text, size = 4000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length ? chunks : [text];
}

function approveRejectKeyboard(draftId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Post to LinkedIn', callback_data: `approve:${draftId}` },
        { text: '❌ Reject', callback_data: `reject:${draftId}` },
      ],
    ],
  };
}

// Returns the Telegram message_id of the last chunk sent, so callers can
// record which message a reply (e.g. APPROVE/REJECT) refers back to.
export async function sendTelegramMessage(chatId, text) {
  const chunks = chunkText(text);
  let lastMessageId = null;
  for (const chunk of chunks) {
    const data = await callTelegram('sendMessage', { chat_id: chatId, text: chunk });
    if (data.ok) {
      lastMessageId = data.result.message_id;
    }
  }
  return lastMessageId;
}

// Same as sendTelegramMessage, but attaches Approve/Reject buttons to the
// final chunk (the one worth acting on). draftId is embedded in the
// button's callback_data so the click can be traced straight back to it.
export async function sendDraftMessage(chatId, text, draftId) {
  const chunks = chunkText(text);
  let lastMessageId = null;
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const payload = { chat_id: chatId, text: chunks[i] };
    if (isLast) {
      payload.reply_markup = approveRejectKeyboard(draftId);
    }
    const data = await callTelegram('sendMessage', payload);
    if (data.ok) {
      lastMessageId = data.result.message_id;
    }
  }
  return lastMessageId;
}

export async function sendTypingAction(chatId) {
  await callTelegram('sendChatAction', { chat_id: chatId, action: 'typing' });
}

// Must be called for every callback_query update, or Telegram leaves the
// button's tap spinner running. `text` (optional) shows as a brief toast.
export async function answerCallbackQuery(callbackQueryId, text) {
  await callTelegram('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

// Strips the inline keyboard from a message after it's been acted on, so
// the buttons can't be tapped twice.
export async function clearMessageButtons(chatId, messageId) {
  await callTelegram('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}
