/* Kharait privacy hardening.
 * Local drafts/history and provider credentials must never cross account boundaries
 * on a shared browser profile.
 */
(() => {
  if (!window.cloudClient || !window.cloudClient.auth) return;

  let initialized = false;
  let currentUserId = null;

  function clearAccountPrivateState() {
    try {
      window.aiKeyMemory = '';
      const keyInput = document.getElementById('aiKey');
      if (keyInput) keyInput.value = '';

      // These keys contain generated lesson content, not harmless preferences.
      try { localStorage.removeItem('gm_last'); } catch (_) {}
      try { localStorage.removeItem('gm_hist'); } catch (_) {}

      if (typeof window.DATA !== 'undefined') window.DATA = null;
      const map = document.getElementById('map');
      if (map) map.replaceChildren();

      if (typeof window.cleanupGeminiFiles === 'function') {
        window.cleanupGeminiFiles();
      }
    } catch (_) {
      // Fail closed: the authentication gate still controls application visibility.
    }
  }

  window.cloudClient.auth.onAuthStateChange((event, session) => {
    const nextUserId = session?.user?.id || null;

    if (initialized && nextUserId !== currentUserId) {
      clearAccountPrivateState();
    } else if (!initialized && !nextUserId) {
      clearAccountPrivateState();
    }

    currentUserId = nextUserId;
    initialized = true;
  });
})();
