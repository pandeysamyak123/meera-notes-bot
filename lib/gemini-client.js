import { GoogleGenerativeAI } from '@google/generative-ai';

let cachedClient = null;

function getClient() {
  if (!cachedClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    cachedClient = new GoogleGenerativeAI(apiKey);
  }
  return cachedClient;
}

export function getGenerativeModel() {
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  return getClient().getGenerativeModel({ model: modelName });
}

function isRetryable(err) {
  const status = err?.status || err?.httpStatus;
  const message = String(err?.message || '');
  return (
    status === 503 ||
    status === 429 ||
    /503|overloaded|rate limit|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand/i.test(message)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gemini occasionally returns transient 503 ("high demand")/429 errors that
// usually succeed a moment later. Scoring, news keyword extraction, and
// drafting all call this instead of model.generateContent() directly so a
// blip doesn't surface to Meera as a hard failure.
export async function generateContentWithRetry(model, prompt, { retries = 2, baseDelayMs = 800 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await model.generateContent(prompt);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === retries) {
        throw err;
      }
      console.error(`Gemini call failed (attempt ${attempt + 1}/${retries + 1}), retrying:`, err.message);
      await sleep(baseDelayMs * (attempt + 1));
    }
  }
  throw lastErr;
}
