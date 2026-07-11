const { shell } = require('electron');
const { auth } = require('@googleapis/tasks');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const tokenStore = require('./tokenStore');

// OAuth2 authentication flow for Google Tasks API.
// Strategy: start a local HTTP server, open user's browser to Google's auth endpoint,
// capture the callback on localhost, exchange auth code for tokens, then close the server.
// Tokens are cached to disk for persistence across app restarts.

const SCOPES = ['https://www.googleapis.com/auth/tasks'];
const CREDENTIALS_PATH = path.join(__dirname, '..', 'google-client-secret.json');
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

// Standalone page served to the OAuth callback tab (outside the app's renderer, so it
// can't load src/css/app.css)—inline a subset of the same theme variables so the tab
// still follows the OS light/dark preference instead of showing a plain white page.
function renderCallbackPage(message) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @media (prefers-color-scheme: dark) {
    :root {
      --color-bg-app: #1e1e1e;
      --color-text-primary: #e0e0e0;
    }
  }
  @media (prefers-color-scheme: light) {
    :root {
      --color-bg-app: #ffffff;
      --color-text-primary: #1e1e1e;
    }
  }
  body {
    margin: 0;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: var(--color-bg-app);
    color: var(--color-text-primary);
  }
</style>
</head>
<body>${message}</body>
</html>`;
}

let client = null;
// Prevents concurrent sign-in attempts and race conditions.
// signInInFlight is a Promise that resolves when the OAuth flow completes.
let signInInFlight = null;

function loadCredentials() {
  let raw;
  try {
    raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  } catch {
    throw new Error(
      `Google client credentials not found at ${CREDENTIALS_PATH}. ` +
      'Download an OAuth "Desktop app" client from Google Cloud Console and save it there.'
    );
  }
  const { installed, web } = JSON.parse(raw);
  const creds = installed || web;
  if (!creds) {
    throw new Error(`Unrecognized credentials format in ${CREDENTIALS_PATH}.`);
  }
  return creds;
}

function getClient() {
  if (client) return client;

  const { client_id, client_secret } = loadCredentials();
  client = new auth.OAuth2({ clientId: client_id, clientSecret: client_secret });

  // Listen for token refreshes (e.g., when access_token expires and refresh_token is used).
  // Save refreshed tokens immediately so the new access_token persists.
  client.on('tokens', (tokens) => {
    tokenStore.saveTokens({ ...client.credentials, ...tokens });
  });

  // Restore persisted credentials from disk if available.
  const persisted = tokenStore.loadTokens();
  if (persisted) {
    client.setCredentials(persisted);
  }

  return client;
}

async function getAuthStatus() {
  const c = getClient();
  return { signedIn: Boolean(c.credentials && c.credentials.refresh_token) };
}

function signIn() {
  // Return existing promise if sign-in is already in flight.
  // This prevents multiple concurrent OAuth flows and race conditions.
  if (signInInFlight) return signInInFlight;

  signInInFlight = runSignInFlow().finally(() => {
    signInInFlight = null;
  });
  return signInInFlight;
}

function runSignInFlow() {
  const c = getClient();
  // Random state parameter prevents CSRF attacks by ensuring the callback came from this flow.
  const state = crypto.randomBytes(16).toString('hex');

  return new Promise((resolve) => {
    let settled = false;
    let timeoutHandle;

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404).end();
        return;
      }
      // Validate state to prevent CSRF; must match the state sent to Google.
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400).end('Invalid state parameter.');
        return;
      }

      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
          .end(renderCallbackPage('Sign-in was cancelled. You can close this tab.'));
        finish({ ok: false, reason: 'access_denied' });
        return;
      }

      try {
        // Exchange authorization code for tokens (access_token + refresh_token).
        const { tokens } = await c.getToken({ code, redirect_uri: redirectUri });
        c.setCredentials(tokens);
        tokenStore.saveTokens(tokens);
        res.writeHead(200, { 'Content-Type': 'text/html' })
          .end(renderCallbackPage('Signed in. You can close this tab and return to the app.'));
        finish({ ok: true });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' })
          .end(renderCallbackPage('Sign-in failed. You can close this tab.'));
        finish({ ok: false, reason: 'other' });
      }
    });

    let redirectUri;

    // Ensures the promise resolves only once, even if multiple callbacks fire (e.g., timeout + request).
    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      server.close();
      resolve(result);
    }

    // Listen on localhost with a dynamic port (0 = OS picks an available port).
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      c.redirectUri = redirectUri;

      // Request offline access to obtain a refresh_token for long-lived sessions.
      // prompt: 'consent' forces the consent screen to show, ensuring a new refresh_token.
      const authUrl = c.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
        redirect_uri: redirectUri,
        state,
      });

      shell.openExternal(authUrl);
    });

    timeoutHandle = setTimeout(() => finish({ ok: false, reason: 'timeout' }), SIGN_IN_TIMEOUT_MS);
  });
}

async function signOut() {
  const c = getClient();
  try {
    // Revoke tokens with Google servers; best-effort since this may fail if offline or already revoked.
    await c.revokeCredentials();
  } catch {
    // Ignore revocation failures; clear local credentials regardless.
  }
  c.setCredentials({});
  tokenStore.clearTokens();
  return { ok: true };
}

module.exports = { getClient, getAuthStatus, signIn, signOut };
