// Auth / sign-in modal.
const signinModalOverlay = document.getElementById('signinModalOverlay');
const signinModalBtn = document.getElementById('signinModalBtn');

function showSigninModal() {
  if (signinModalOverlay) {
    signinModalOverlay.classList.remove('is-hidden');
  }
  // Reset the button to its idle state whenever the modal appears. handleSignIn
  // leaves it disabled/"Signing in…" after a successful sign-in (it just hides the
  // modal), so re-showing it later—e.g. after Sign Out—would otherwise surface that
  // stale, unclickable state.
  if (signinModalBtn) {
    signinModalBtn.disabled = false;
    signinModalBtn.textContent = 'Sign in with Google';
  }
}

function hideSigninModal() {
  if (signinModalOverlay) {
    signinModalOverlay.classList.add('is-hidden');
  }
}

async function initGoogleTasks() {
  // Check auth status on app startup. If config is missing, show error message.
  let signedIn;
  try {
    ({ signedIn } = await window.googleTasks.getAuthStatus());
  } catch {
    renderSidebarMessage('Google Tasks is not configured. Add google-client-secret.json and restart the app.');
    return;
  }

  if (signedIn) {
    hideSigninModal();
    await loadTaskLists();
  } else {
    // User not signed in; show signin modal.
    showSigninModal();
  }
}

async function handleSignIn() {
  // Disable the button during signin to prevent multiple clicks
  if (signinModalBtn) {
    signinModalBtn.disabled = true;
    signinModalBtn.textContent = 'Signing in…';
  }

  const result = await window.googleTasks.signIn();
  if (result.ok) {
    // Signin succeeded; load task lists from Google Tasks.
    hideSigninModal();
    await loadTaskLists();
  } else {
    // Signin failed or cancelled; show error and re-enable button.
    let reason;
    if (result.reason === 'access_denied') {
      reason = 'Sign-in was cancelled.';
    } else if (result.reason === 'missing_scope') {
      reason = 'Please allow access to Google Tasks.';
    } else if (result.reason === 'timeout') {
      reason = 'Sign-in timed out.';
    } else {
      reason = 'Sign-in failed.';
    }
    if (signinModalBtn) {
      signinModalBtn.disabled = false;
      signinModalBtn.textContent = `Try again: ${reason}`;
    }
  }
}

function setupAuthEventListeners() {
  if (signinModalBtn) {
    signinModalBtn.addEventListener('click', handleSignIn);
  }
}
