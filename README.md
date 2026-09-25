# Meera Notes Bot

Meera texts a note to a Telegram bot. The bot sends the note to Gemini, along
with instructions describing how she writes, and replies in the same chat
with a drafted post.

Runs as a Vercel serverless function that Telegram calls via a webhook
(there's no long-running process to keep alive).

## How it works

```
Meera's Telegram message
        |
        v
Telegram calls  ->  api/webhook.js  (Vercel serverless function)
                          |
                          v
                 lib/gemini.js  (note + lib/voice-instructions.js -> Gemini)
                          |
                          v
                 lib/telegram.js  ->  reply sent back to the same chat
```

## Files

- `api/webhook.js` - the Telegram webhook endpoint. All the request handling
  logic lives here.
- `lib/gemini.js` - calls the Gemini API with the note + voice instructions.
- `lib/telegram.js` - small helpers for sending messages back to Telegram.
- `lib/voice-instructions.js` - **edit this** with a description of how Meera
  writes (tone, structure, example posts, etc). This is what makes drafts
  sound like her instead of a generic AI.
- `scripts/set-webhook.js` - one-time script to point Telegram at your
  deployed URL.
- `scripts/get-webhook-info.js` / `scripts/delete-webhook.js` - debugging
  helpers.

## Setup

### 1. Create the Telegram bot

1. Open Telegram, message [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts (pick a name and a username ending
   in `bot`).
3. BotFather gives you a **bot token** - looks like `123456789:AA...`. Save it.

### 2. Get a Gemini API key

Create one at [Google AI Studio](https://aistudio.google.com/apikey).

### 3. Fill in Meera's voice instructions

Edit [`lib/voice-instructions.js`](lib/voice-instructions.js) and replace the
placeholder with a real description of how Meera writes - tone, sentence
rhythm, words she does/doesn't use, formatting habits, and ideally 2-3 real
example posts pasted in full. The more concrete, the better the drafts.

### 4. Install dependencies

```bash
npm install
```

### 5. Deploy to Vercel

```bash
npx vercel
```

Follow the prompts to link/create a project. Then set your environment
variables (either via the Vercel dashboard under Project Settings ->
Environment Variables, or via the CLI):

```bash
npx vercel env add TELEGRAM_BOT_TOKEN
npx vercel env add GEMINI_API_KEY
npx vercel env add TELEGRAM_WEBHOOK_SECRET
```

See `.env.example` for all available variables. Then deploy to production:

```bash
npx vercel --prod
```

Note the production URL it gives you, e.g. `https://meera-notes-bot.vercel.app`.

### 6. Point Telegram at your deployment

Run this once, locally, using the same token and secret you set in Vercel:

```bash
TELEGRAM_BOT_TOKEN=your-token TELEGRAM_WEBHOOK_SECRET=your-secret \
  npm run set-webhook -- https://meera-notes-bot.vercel.app
```

Confirm it worked:

```bash
TELEGRAM_BOT_TOKEN=your-token npm run get-webhook-info
```

### 7. Try it

Open Telegram, find your bot, send `/start`, then send a real note. You
should get a drafted post back in the same chat within a few seconds.

## Securing the webhook

Anyone who guesses your `/api/webhook` URL could otherwise POST fake
Telegram updates to it. Setting `TELEGRAM_WEBHOOK_SECRET` (a random string of
your choosing) and registering it via `set-webhook.js` makes Telegram send
that secret back on every request, which `api/webhook.js` verifies before
doing anything.

For an extra layer, once you know Meera's Telegram chat ID (visible in the
logs after her first message, or via `getWebhookInfo`/`getUpdates`), set
`ALLOWED_CHAT_ID` so the bot only ever responds to her.

## Local testing

Vercel functions need a public HTTPS URL for Telegram to call, so local
testing isn't as simple as running the file directly. The easiest path is:

```bash
npx vercel dev
```

then use a tunnel (e.g. `ngrok http 3000`) and run `set-webhook.js` against
the tunnel's HTTPS URL while testing. Point it back at your real production
URL afterwards.

## Notes / things you may want to adjust

- **Model**: defaults to `gemini-3.1-flash-lite` (fast, cheap, verified
  working on this key). Change via the `GEMINI_MODEL` env var if you want a
  different model - list what your key has access to with:
  `curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY"`
- **Message length**: Telegram caps messages at 4096 characters;
  `lib/telegram.js` automatically splits longer drafts into multiple
  messages.
- **Errors**: if Gemini or Telegram fails, the bot tells Meera something
  went wrong instead of leaving her waiting. Check Vercel's function logs
  (`npx vercel logs`) for details.
