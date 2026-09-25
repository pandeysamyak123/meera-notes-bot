import { buildAuthorizeUrl } from '../../lib/linkedin.js';

// Visit this URL in a browser (as Meera, logged into her own LinkedIn) to
// grant the bot permission to post on her behalf. One-time setup, and again
// whenever the access token expires (LinkedIn tokens are valid ~60 days).
export default async function handler(req, res) {
  try {
    const url = await buildAuthorizeUrl();
    res.writeHead(302, { Location: url });
    res.end();
  } catch (err) {
    console.error('Failed to start LinkedIn OAuth:', err);
    res.status(500).send('Could not start LinkedIn authorization. Check server logs.');
  }
}
