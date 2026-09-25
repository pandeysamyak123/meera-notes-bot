# Meera Notes Bot

Meera texts a note to a Telegram bot. The pipeline scores it, optionally
finds a relevant news angle, drafts a post in her voice via Gemini, and
replies in the same chat. She can reply `APPROVE` or `REJECT` to record her
decision. Everything is logged to Supabase.

Runs as a Vercel serverless function that Telegram calls via a webhook
(there's no long-running process to keep alive).

## How it works

```
Meera's Telegram message
        |
        v
Telegram calls -> api/webhook.js  (Vercel serverless function)
                          |
                          v
              lib/scoring.js  (Gemini scores 0-10; below 6 -> reject & stop)
                          |
                          v
              lib/news.js  (Gemini picks search terms -> Google News RSS)
                          |
                          v
              lib/gemini.js  (note + news + voice skill -> drafted post)
                          |
                          v
              lib/telegram.js  ->  draft sent back to the same chat
                          |
                          v
              lib/supabase.js  ->  note + draft saved (status: pending)

Later: Meera replies APPROVE / REJECT
        -> lib/supabase.js updates that draft's status
```

The voice profile itself lives in the `meera_voice_skill` Supabase table
(seeded from `voice-skill.txt`), so it can be updated without a redeploy -
see "Updating Meera's voice" below.

## Files

- `api/webhook.js` - the Telegram webhook endpoint; orchestrates scoring ->
  news -> drafting -> saving -> sending, and handles APPROVE/REJECT replies.
- `lib/scoring.js` - asks Gemini to score a note 0-10 with a one-line reason;
  notes scoring below 6 never reach drafting.
- `lib/news.js` - asks Gemini for a short search phrase, then queries Google
  News' public RSS search (no API key needed) for the top matching article.
- `lib/gemini.js` - drafts the post from the note + voice profile + (if
  relevant) the news item. If the news item is actually used, appends a
  verify-flag block with the real headline/source/date/link - never a
  paraphrased one, since those fields are inserted in code, not by the model.
- `lib/gemini-client.js` - shared Gemini client/model setup used by scoring,
  news, and drafting.
- `lib/claude.js` - same drafting prompt, via Claude - used only by
  `scripts/compare-models.js`, not part of the live bot.
- `lib/telegram.js` - sends messages/typing indicator, returns the sent
  message's `message_id` so replies can be matched back to a specific draft.
- `lib/supabase.js` - reads the voice profile and persists notes/drafts.
- `lib/linkedin.js` - LinkedIn OAuth (authorize URL, token exchange) and
  posting to Meera's personal feed. Tokens are stored in the
  `meera_linkedin_auth` Supabase table.
- `api/linkedin/connect.js` - visit this URL to (re)authorize the bot to post
  as Meera.
- `api/linkedin/callback.js` - LinkedIn's OAuth redirect target; exchanges
  the code for a token and saves it.
- `lib/voice.js` - local fallback voice profile (`voice-skill.txt`), used only
  if Supabase is unreachable.
- `voice-skill.txt` - the voice profile as originally seeded into Supabase.
  Edit `meera_voice_skill.content` in Supabase to change it live (see below).
- `scripts/set-webhook.js` - one-time script to point Telegram at your
  deployed URL.
- `scripts/get-webhook-info.js` / `scripts/delete-webhook.js` - debugging
  helpers.
- `scripts/compare-models.js` - runs one note through both Gemini and Claude
  side by side, for comparing voice fidelity.

## Database (Supabase)

Three tables:

- **`meera_notes`** - every note received, with its score and score reason.
- **`meera_drafts`** - every draft produced, linked to its note, with
  `status` (`pending` / `approved` / `rejected`) and the news fields if a
  news item was used.
- **`meera_voice_skill`** - single row (`id = 1`) holding the current voice
  profile text.
- **`meera_linkedin_auth`** - single row (`id = 1`) holding the current
  LinkedIn access token, refresh token (if any), and expiry.
- **`meera_oauth_state`** - short-lived CSRF state values for the LinkedIn
  OAuth handshake; rows are deleted as soon as they're used.

RLS is left disabled on these tables (default) - only the server holds the
Supabase key, so nothing public can read or write them directly. If you'd
rather enable RLS, add a policy that allows the service role and nothing
else.

### Updating Meera's voice

Update the live copy directly:

```sql
update meera_voice_skill set content = '...' , updated_at = now() where id = 1;
```

Run that in the Supabase SQL editor. No redeploy needed - the next note
picks up the new profile immediately.

## Setup

### 1. Create the Telegram bot

1. Open Telegram, message [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts (pick a name and a username ending
   in `bot`).
3. BotFather gives you a **bot token** - looks like `123456789:AA...`. Save it.

### 2. Get a Gemini API key

Create one at [Google AI Studio](https://aistudio.google.com/apikey). Check
which models your key actually has access to:

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY"
```

### 3. Create a Supabase project and the tables

Create a project at [supabase.com](https://supabase.com), then run this in
its SQL editor:

```sql
create table if not exists meera_notes (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null,
  telegram_message_id bigint,
  text text not null,
  score int,
  score_reason text,
  created_at timestamptz not null default now()
);

create table if not exists meera_drafts (
  id uuid primary key default gen_random_uuid(),
  note_id uuid references meera_notes(id) on delete cascade,
  draft_text text not null,
  news_headline text,
  news_source text,
  news_date text,
  news_link text,
  telegram_message_id bigint,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meera_voice_skill (
  id int primary key default 1,
  content text not null,
  updated_at timestamptz not null default now(),
  constraint meera_voice_skill_singleton check (id = 1)
);

create table if not exists meera_linkedin_auth (
  id int primary key default 1,
  person_urn text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meera_linkedin_auth_singleton check (id = 1)
);

create table if not exists meera_oauth_state (
  state text primary key,
  created_at timestamptz not null default now()
);
```

Then seed the voice profile (paste your real one in place of the text):

```sql
insert into meera_voice_skill (id, content) values (1, 'PASTE VOICE PROFILE HERE');
```

Grab `SUPABASE_URL` and the `anon` / publishable key from Project Settings ->
API.

### 4. Fill in Meera's voice instructions (local fallback)

`voice-skill.txt` is only used if Supabase is unreachable - keep it in sync
with what's in the `meera_voice_skill` table as a backup.

### 5. Install dependencies

```bash
npm install
```

### 6. Deploy to Vercel

```bash
npx vercel
```

Follow the prompts to link/create a project. Then set your environment
variables (either via the Vercel dashboard under Project Settings ->
Environment Variables, or via the CLI):

```bash
npx vercel env add TELEGRAM_BOT_TOKEN
npx vercel env add GEMINI_API_KEY
npx vercel env add SUPABASE_URL
npx vercel env add SUPABASE_KEY
npx vercel env add TELEGRAM_WEBHOOK_SECRET
```

**Important**: new Vercel projects default to Vercel Authentication
(deployment protection), which would block Telegram's webhook calls. Turn it
off under Project Settings -> Deployment Protection, or via the API
(`ssoProtection: null`).

See `.env.example` for all available variables. Then deploy to production:

```bash
npx vercel --prod
```

Note the production URL it gives you, e.g. `https://meera-notes-bot.vercel.app`.

### 7. Point Telegram at your deployment

Run this once, locally, using the same token and secret you set in Vercel:

```bash
TELEGRAM_BOT_TOKEN=your-token TELEGRAM_WEBHOOK_SECRET=your-secret \
  npm run set-webhook -- https://meera-notes-bot.vercel.app
```

Confirm it worked:

```bash
TELEGRAM_BOT_TOKEN=your-token npm run get-webhook-info
```

### 8. Try it

Open Telegram, find your bot, send `/start`, then send a real note. You
should get either a drafted post, or a short message saying why the note
scored too low to draft. Reply `APPROVE` or `REJECT` to a draft (a plain
reply to that message, or just typing the word) to record your decision.

## Securing the webhook

Anyone who guesses your `/api/webhook` URL could otherwise POST fake
Telegram updates to it. Setting `TELEGRAM_WEBHOOK_SECRET` (a random string of
your choosing) and registering it via `set-webhook.js` makes Telegram send
that secret back on every request, which `api/webhook.js` verifies before
doing anything.

For an extra layer, once you know Meera's Telegram chat ID (visible in the
logs after her first message, or via `getWebhookInfo`/`getUpdates`), set
`ALLOWED_CHAT_ID` so the bot only ever responds to her.

## Connect LinkedIn

Replying `APPROVE` to a draft posts it directly to Meera's personal LinkedIn
feed. That needs a one-time OAuth connection:

### 1. Create a LinkedIn Developer App

1. Go to [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps)
   and create an app (needs an associated LinkedIn Company Page - a personal
   "test" page is fine if you don't have one).
2. Under the app's **Products** tab, request/add:
   - **Sign In with LinkedIn using OpenID Connect** (instant, self-serve)
   - **Share on LinkedIn** (instant, self-serve)
3. Under **Auth**, add this exact redirect URL (replace with your real
   deployed URL):
   `https://meera-notes-bot.vercel.app/api/linkedin/callback`
4. Copy the **Client ID** and **Client Secret** from the Auth tab.

### 2. Set environment variables

```bash
npx vercel env add LINKEDIN_CLIENT_ID
npx vercel env add LINKEDIN_CLIENT_SECRET
npx vercel env add APP_BASE_URL   # e.g. https://meera-notes-bot.vercel.app
```

Redeploy so these take effect.

### 3. Authorize as Meera

Open `https://your-deployed-url/api/linkedin/connect` in a browser **while
logged into Meera's LinkedIn account**, and approve access. You'll land on a
plain "LinkedIn connected" page when it works.

LinkedIn access tokens last about 60 days. When one expires, `APPROVE` will
reply with a fresh link to this same `/api/linkedin/connect` URL - just
repeat this step and then reply `APPROVE` again.

**Note**: this posts to Meera's *personal* profile. Posting to a LinkedIn
Company Page instead requires LinkedIn's Community Management API, which
needs their Marketing Partner review/approval - a materially bigger lift, not
covered here.

## Comparing Gemini vs Claude

```bash
ANTHROPIC_API_KEY=your-key node scripts/compare-models.js "the note text"
```

Prints both drafts side by side. Useful for deciding whether to switch
`lib/gemini.js`'s drafting call over to `lib/claude.js` - the scoring step
stays on Gemini Flash either way (fast, cheap; doesn't need to hold a full
voice across a post the way drafting does).

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
  working on this key). Change via the `GEMINI_MODEL` env var.
- **Score threshold**: hardcoded at 6 in `lib/scoring.js`
  (`SCORE_PASS_THRESHOLD`). If everything passes, the scoring prompt is too
  lenient - tighten the prompt or raise the threshold.
- **Message length**: Telegram caps messages at 4096 characters;
  `lib/telegram.js` automatically splits longer drafts into multiple
  messages.
- **Errors**: if any step fails, the bot tells Meera something went wrong
  instead of leaving her waiting. Check Vercel's function logs
  (`npx vercel logs`) for details.
