import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const POSTS_URL = 'https://api.linkedin.com/rest/posts';
const LINKEDIN_API_VERSION = process.env.LINKEDIN_API_VERSION || '202405';
const SCOPES = 'openid profile w_member_social';

let cachedClient = null;
function getSupabase() {
  if (!cachedClient) {
    cachedClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  }
  return cachedClient;
}

function getEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function getRedirectUri() {
  return process.env.LINKEDIN_REDIRECT_URI || `${getEnv('APP_BASE_URL')}/api/linkedin/callback`;
}

// Step 1 of OAuth: build the URL Meera visits to grant access. A random
// `state` is stored in Supabase (not a cookie - simpler across the
// redirect-to-LinkedIn-and-back hop on serverless) and checked on callback
// to guard against CSRF.
export async function buildAuthorizeUrl() {
  const state = crypto.randomBytes(16).toString('hex');
  const { error } = await getSupabase().from('meera_oauth_state').insert({ state });
  if (error) throw error;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getEnv('LINKEDIN_CLIENT_ID'),
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function consumeState(state) {
  const client = getSupabase();
  const { data } = await client.from('meera_oauth_state').select('state').eq('state', state).maybeSingle();
  if (!data) return false;
  await client.from('meera_oauth_state').delete().eq('state', state);
  return true;
}

// Step 2: exchange the authorization code for an access token, fetch the
// member's URN, and persist both.
export async function completeAuthorization(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    client_id: getEnv('LINKEDIN_CLIENT_ID'),
    client_secret: getEnv('LINKEDIN_CLIENT_SECRET'),
  });

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(`LinkedIn token exchange failed: ${JSON.stringify(tokenData)}`);
  }

  const userRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userData = await userRes.json();
  if (!userRes.ok) {
    throw new Error(`LinkedIn userinfo fetch failed: ${JSON.stringify(userData)}`);
  }

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  const { error } = await getSupabase().from('meera_linkedin_auth').upsert({
    id: 1,
    person_urn: `urn:li:person:${userData.sub}`,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  return { name: userData.name || null };
}

async function getStoredAuth() {
  const { data, error } = await getSupabase()
    .from('meera_linkedin_auth')
    .select('person_urn, access_token, expires_at')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export class LinkedInNotConnectedError extends Error {}
export class LinkedInTokenExpiredError extends Error {}

// Publishes a text post to Meera's personal LinkedIn feed. Throws
// LinkedInNotConnectedError / LinkedInTokenExpiredError for the caller to
// turn into a "please reconnect" message; any other error is a genuine
// posting failure.
export async function postToLinkedIn(text) {
  const auth = await getStoredAuth();
  if (!auth) {
    throw new LinkedInNotConnectedError('LinkedIn is not connected yet');
  }
  if (new Date(auth.expires_at) <= new Date()) {
    throw new LinkedInTokenExpiredError('LinkedIn access token has expired');
  }

  const res = await fetch(POSTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.access_token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': LINKEDIN_API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: auth.person_urn,
      commentary: text,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LinkedIn post failed (${res.status}): ${errBody}`);
  }

  // LinkedIn returns the new post's URN in the x-restli-id / x-linkedin-id
  // response header, not the (empty) body.
  const postUrn = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id');
  return { postUrn };
}
