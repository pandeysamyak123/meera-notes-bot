import { consumeState, completeAuthorization } from '../../lib/linkedin.js';

function htmlPage(title, body) {
  return `<!doctype html><html><head><title>${title}</title></head><body style="font-family: sans-serif; max-width: 480px; margin: 80px auto; text-align: center;">${body}</body></html>`;
}

export default async function handler(req, res) {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    res.status(400).send(htmlPage('LinkedIn - Error', `<h2>LinkedIn declined the request</h2><p>${errorDescription || error}</p>`));
    return;
  }

  if (!code || !state) {
    res.status(400).send(htmlPage('LinkedIn - Error', '<h2>Missing code or state</h2>'));
    return;
  }

  const stateValid = await consumeState(state);
  if (!stateValid) {
    res.status(400).send(htmlPage('LinkedIn - Error', '<h2>Invalid or expired request</h2><p>Start over from /api/linkedin/connect.</p>'));
    return;
  }

  try {
    await completeAuthorization(code);
    res.status(200).send(
      htmlPage(
        'LinkedIn Connected',
        '<h2>✅ LinkedIn connected</h2><p>You can close this tab and go back to Telegram.</p>'
      )
    );
  } catch (err) {
    console.error('LinkedIn authorization failed:', err);
    res.status(500).send(htmlPage('LinkedIn - Error', '<h2>Something went wrong</h2><p>Check server logs.</p>'));
  }
}
