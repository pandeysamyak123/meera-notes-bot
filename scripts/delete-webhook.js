// Removes the Telegram webhook - useful if you want to pause the bot or
// switch back to local testing.
//
// Usage: TELEGRAM_BOT_TOKEN=xxxx node scripts/delete-webhook.js

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('Set TELEGRAM_BOT_TOKEN in your environment first.');
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
