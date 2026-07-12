# Tasks

A desktop task management app built with Electron that integrates with Google Tasks.

## Building

```bash
npm install
npm run package
```

This packages the app for your current platform into the `out/` directory.

### macOS: code signing (required for persistent sign-in)

When you package the app without signing it, you will need to re-authenticate to Google every time you launch the app. The reason:

- Saved Google OAuth tokens are encrypted with Electron's `safeStorage` API (`main/tokenStore.js`), which stores its encryption key in the macOS Keychain.
- macOS's Keychain only hands that key back to the exact same app that stored it. It recognizes "the same app" by code-signing (not by file name or file location).

To avoid the need to re-authenticate at each app launch, sign your packaged builds with a stable identity. `forge.config.js` is already set up to sign with a certificate named `Tasks Dev Cert` — you just need to create one locally and trust it:

1. Open **Keychain Access** → menu bar **Keychain Access → Certificate Assistant → Create a Certificate…**
2. Set **Identity Type** to `Self Signed Root`, **Certificate Type** to `Code Signing`, and name it exactly `Tasks Dev Cert` (must match `osxSign.identity` in `forge.config.js`).
3. In Keychain Access, find the new certificate and expand its **Trust** section. Set **both** of these to **Always Trust**:
   - The top **"When using this certificate:"** dropdown
   - The **Code Signing** row underneath it
   
   Both matter: Electron's automated signer looks up identities via `security find-identity -v` (no policy filter), which only lists identities trusted under the top-level/default policy. Trusting *only* the "Code Signing" row makes the cert usable for manual `codesign` commands, but invisible to the packaging pipeline — it'll silently fall back to an unsigned build with no error.
4. Close the trust panel (you'll be prompted for your login password), then verify: `security find-identity -v` should list `Tasks Dev Cert`.
5. Run `npm run make` (or `npm run package`). As long as you keep signing with the same certificate, the app's identity stays stable across rebuilds and Keychain-persisted tokens will survive relaunches.

A self-signed certificate is sufficient for this — it doesn't require an Apple Developer ID account. A paid Developer ID (and notarization) is only needed if you plan to distribute the app to other people without Gatekeeper warnings; it has no effect on this token-persistence issue.

**Note on `osxSign` config:** `@electron/osx-sign` (used internally by `electron-forge`) ignores top-level `hardenedRuntime`/`timestamp` options — they only take effect inside an `optionsForFile` callback, which is why `forge.config.js` sets them that way. Hardened runtime is disabled and timestamping is turned off because both are meaningless for a local self-signed cert (hardened runtime specifically requires all loaded frameworks to share the main executable's Team ID, which self-signed certs don't have, causing a crash at launch: `Library not loaded ... different Team IDs`) and timestamping just adds a slow, unnecessary network round-trip per file.
