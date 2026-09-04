// FocusGuard Background Service Worker
// Monitors navigation and syncs boundary status

chrome.runtime.onInstalled.addListener(() => {
  console.log('FocusGuard Extension initialized.');
});

// Intercept navigations to YouTube Shorts directly
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const url = new URL(details.url);
  if (url.hostname.includes('youtube.com') && url.pathname.startsWith('/shorts')) {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/status/');
      if (res.ok) {
        const state = await res.json();
        if (state.mode === 'FOCUS') {
          chrome.tabs.update(details.tabId, { url: 'http://127.0.0.1:8000/blocked/?app=YouTube' });
        } else if (state.mode === 'BREAK') {
          // Log shorts blocked
          fetch('http://127.0.0.1:8000/api/events/log/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event_type: 'SHORTS_BLOCKED_BREAK',
              app_name: 'YouTube',
              target_url: details.url,
              note: 'Direct Shorts URL navigation intercepted.'
            })
          });
          // Redirect to YouTube homepage
          chrome.tabs.update(details.tabId, { url: 'https://www.youtube.com' });
        }
      }
    } catch (e) {
      console.debug('FocusGuard backend check error:', e);
    }
  }
});
