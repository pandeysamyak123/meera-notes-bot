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
