// Registers your deployed Vercel URL as the Telegram webhook for this bot.
//
// Usage:
//   TELEGRAM_BOT_TOKEN=xxxx TELEGRAM_WEBHOOK_SECRET=yyyy \
//     node scripts/set-webhook.js https://your-project.vercel.app

const [, , urlArg] = process.argv;
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token) {
  console.error('Set TELEGRAM_BOT_TOKEN in your environment first.');
  process.exit(1);
}

if (!urlArg) {
  console.error('Usage: node scripts/set-webhook.js https://your-project.vercel.app');
  process.exit(1);
}

const webhookUrl = `${urlArg.replace(/\/$/, '')}/api/webhook`;

const body = { url: webhookUrl };
if (secret) {
  body.secret_token = secret;
}

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));

if (!data.ok) {
  process.exit(1);
}
