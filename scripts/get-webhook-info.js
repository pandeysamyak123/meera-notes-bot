// Prints Telegram's current webhook config for this bot - useful for
// confirming setup worked, or debugging delivery errors.
//
// Usage: TELEGRAM_BOT_TOKEN=xxxx node scripts/get-webhook-info.js

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('Set TELEGRAM_BOT_TOKEN in your environment first.');
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
