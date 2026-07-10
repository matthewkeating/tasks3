const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Persists and retrieves Google OAuth tokens with platform-native encryption.
// Uses Electron's safeStorage API to encrypt sensitive tokens before writing to disk,
// preventing credential theft if the app data directory is accessed.

function getTokenPath() {
  return path.join(app.getPath('userData'), 'google-tokens.bin');
}

function saveTokens(tokens) {
  // safeStorage may not be available on all platforms (e.g., headless Linux).
  // Warn and skip persistence rather than failing, so auth still works in the current session.
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('safeStorage encryption unavailable; Google tokens will not persist across restarts.');
    return;
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
  fs.writeFileSync(getTokenPath(), encrypted);
}

function loadTokens() {
  try {
    const encrypted = fs.readFileSync(getTokenPath());
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch {
    // File missing, corrupted, or decryption failed. Return null to trigger fresh auth flow.
    return null;
  }
}

function clearTokens() {
  fs.rmSync(getTokenPath(), { force: true });
}

module.exports = { saveTokens, loadTokens, clearTokens };
