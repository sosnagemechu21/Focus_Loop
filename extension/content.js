// FocusGuard YouTube Boundary Content Script
// Controls YouTube access according to FocusGuard Django API state

const BACKEND_URL = 'http://127.0.0.1:8000';

async function checkBoundaryState() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/status/`);
    if (!response.ok) return;
    const data = await response.json();

    if (data.mode === 'FOCUS') {
      // YouTube is BLOCKED during focus mode!
      // 1. Log temptation event
      await fetch(`${BACKEND_URL}/api/events/log/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'YOUTUBE_ATTEMPT_FOCUS',
          app_name: 'YouTube',
          target_url: window.location.href,
          note: 'Blocked YouTube access attempt during active focus session.'
        })
      });

      // 2. Redirect to blocked view
      window.location.replace(`${BACKEND_URL}/blocked/?app=YouTube&reason=focus_session`);
      return;
    }

    if (data.mode === 'BREAK') {
      // YouTube is ALLOWED, but Shorts are strictly BLOCKED!
      if (window.location.pathname.startsWith('/shorts')) {
        // Intercept and block Shorts video viewer
        await fetch(`${BACKEND_URL}/api/events/log/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: 'SHORTS_BLOCKED_BREAK',
            app_name: 'YouTube',
            target_url: window.location.href,
            note: 'Intercepted YouTube Shorts tap during break mode.'
          })
        });

        alert('⚡ FocusGuard: Shorts are strictly blocked during breaks. Redirecting to intentional long-form videos.');
        window.location.replace('https://www.youtube.com');
        return;
      }

      // If user clicks into a creator's /shorts tab, redirect to their /videos long-form tab
      if (window.location.pathname.endsWith('/shorts') || window.location.pathname.endsWith('/shorts/')) {
        const channelVideosUrl = window.location.href.replace(/\/shorts\/?$/, '/videos');
        window.location.replace(channelVideosUrl);
        return;
      }

      // Strip Shorts elements from DOM to avoid autopilot temptation
      stripShortsElements();
      injectBreakBanner(data.remaining_seconds);
    }
  } catch (err) {
    // If backend is not currently running, fail open
    console.debug('FocusGuard daemon not responding:', err);
  }
}

function stripShortsElements() {
  const shortsSelectors = [
    'ytd-rich-section-renderer',                    // Shorts shelf on homepage
    'ytd-reel-shelf-renderer',                      // Shorts reel shelf on homepage and channels
    'a[title="Shorts"]',                            // Shorts link in sidebar
    'ytd-guide-entry-renderer a[href^="/shorts"]',  // Sidebar Shorts
    'ytd-mini-guide-entry-renderer a[href^="/shorts"]',
    'yt-tab-shape[tab-title="Shorts"]',             // Channel profile "Shorts" tab
    'tp-yt-paper-tab:has([title="Shorts"])',        // Classic channel profile "Shorts" tab
    'a[href*="/shorts"]',                           // Any link pointing to shorts
    'ytd-rich-item-renderer:has(a[href*="/shorts"])', // Channel video grid items that are shorts
    'ytd-grid-video-renderer:has(a[href*="/shorts"])' // Channel video grid items that are shorts
  ];

  const hideCSS = `
    ${shortsSelectors.join(', ')} {
      display: none !important;
    }
  `;

  const style = document.createElement('style');
  style.id = 'focusguard-hide-shorts';
  style.textContent = hideCSS;
  if (!document.getElementById('focusguard-hide-shorts')) {
    (document.head || document.documentElement).appendChild(style);
  }
}

function injectBreakBanner(remainingSec) {
  if (document.getElementById('focusguard-break-banner')) return;

  const mins = Math.floor(remainingSec / 60);
  const banner = document.createElement('div');
  banner.id = 'focusguard-break-banner';
  banner.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 36px;
      background: #0f172a;
      color: #34d399;
      border-bottom: 2px solid #10b981;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 600;
      z-index: 9999999;
      box-shadow: 0 4px 15px rgba(0,0,0,0.5);
    ">
      <span>🌿 FocusGuard: Intentional Break Active</span>
      <span style="color: #94a3b8;">|</span>
      <span>Long-form only (Shorts blocked ❌)</span>
      <span style="color: #94a3b8;">|</span>
      <span style="background: rgba(16, 185, 129, 0.2); padding: 2px 8px; border-radius: 4px; font-family: monospace;">${mins} min remaining</span>
    </div>
  `;

  document.body.appendChild(banner);
  document.body.style.marginTop = '36px';
}

// Run immediately and recheck periodically
checkBoundaryState();
setInterval(checkBoundaryState, 4000);
