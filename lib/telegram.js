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

export async function sendTelegramMessage(chatId, text) {
  const chunks = chunkText(text);
  for (const chunk of chunks) {
    await callTelegram('sendMessage', { chat_id: chatId, text: chunk });
  }
}

export async function sendTypingAction(chatId) {
  await callTelegram('sendChatAction', { chat_id: chatId, action: 'typing' });
}
