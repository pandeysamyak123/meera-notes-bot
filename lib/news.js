import { getGenerativeModel } from './gemini-client.js';

function buildKeywordPrompt(note) {
  return [
    'Read this note and produce a short news-search phrase (3-5 words) that',
    'would find a relevant, currently-published news article related to its',
    'topic. Reply with ONLY the search phrase, nothing else - no quotes, no',
    'explanation.',
    '',
    'Note:',
    '"""',
    note.trim(),
    '"""',
  ].join('\n');
}

export async function extractSearchQuery(note) {
  const model = getGenerativeModel();
  const result = await model.generateContent(buildKeywordPrompt(note));
  return result.response.text().trim().replace(/^["']|["']$/g, '');
}

function decodeXmlEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1');
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 's'));
  return match ? decodeXmlEntities(match[1]).trim() : null;
}

function extractSourceName(xml) {
  const match = xml.match(/<source[^>]*>(.*?)<\/source>/s);
  return match ? decodeXmlEntities(match[1]).trim() : null;
}

// Google News RSS search - no API key required. Returns the single most
// relevant/recent result, or null if nothing came back.
export async function fetchTopNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error('Google News fetch failed:', res.status);
    return null;
  }
  const xml = await res.text();

  const firstItemMatch = xml.match(/<item>(.*?)<\/item>/s);
  if (!firstItemMatch) {
    return null;
  }
  const itemXml = firstItemMatch[1];

  const headline = extractTag(itemXml, 'title');
  const link = extractTag(itemXml, 'link');
  const pubDate = extractTag(itemXml, 'pubDate');
  const source = extractSourceName(itemXml);

  if (!headline) {
    return null;
  }

  return {
    headline,
    link,
    date: pubDate ? new Date(pubDate).toISOString().slice(0, 10) : null,
    source: source || 'Google News',
  };
}
