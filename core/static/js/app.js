// FocusLoop: Progressive Sequential Flow Engine
// Stage 1: Connect Account -> Stage 2: Choose Break Time -> Stage 3: YouTube (No Shorts) -> Stage 4: Ask Study Hours -> Stage 5: App Closed & Locked

document.addEventListener('DOMContentLoaded', () => {
  const state = {
    currentStage: 1, // 1: connect, 2: choose_break, 3: youtube_break, 4: ask_study, 5: app_locked
    isConnected: false,
    connectedEmail: '',
    breakDurationMinutes: 15,
    studyDurationHours: 2,
    studyTask: 'Deep Study Session',
    remainingSeconds: 0,
    elapsedSeconds: 0,
    timerInterval: null,
    videos: [],
    activeVideo: null
  };

  // Web Audio Synthesizer
  const audioCtx = (typeof window.AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined')
    ? new (window.AudioContext || window.webkitAudioContext)()
    : null;

  function playTone(freq, type = 'sine', duration = 0.3, delay = 0) {
    if (!audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      setTimeout(() => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
      }, delay * 1000);
    } catch (e) {
      console.debug('Audio error:', e);
    }
  }

  function playChimeStart() {
    playTone(523.25, 'sine', 0.2, 0);       // C5
    playTone(659.25, 'sine', 0.25, 0.12);   // E5
    playTone(783.99, 'sine', 0.4, 0.24);    // G5
  }

  function playAlertBreakEnd() {
    playTone(880, 'triangle', 0.2, 0);
    playTone(784, 'triangle', 0.2, 0.15);
    playTone(659, 'triangle', 0.4, 0.3);
  }

  function playWarningBuzzer() {
    playTone(220, 'sawtooth', 0.15, 0);
    playTone(196, 'sawtooth', 0.25, 0.12);
  }

  // Toast
  const brandToast = document.getElementById('brand-toast');
  function showToast(heading, text, isWarning = false) {
    const toastHeading = document.getElementById('toast-heading');
    const toastText = document.getElementById('toast-text');
    if (toastHeading) toastHeading.textContent = heading;
    if (toastText) toastText.textContent = text;
    if (brandToast) {
      brandToast.style.borderColor = isWarning ? '#ef4444' : 'var(--brand-dark)';
      brandToast.classList.add('show');
      setTimeout(() => brandToast.classList.remove('show'), 4200);
    }
  }

  document.getElementById('btn-toast-close')?.addEventListener('click', () => {
    brandToast?.classList.remove('show');
  });

  // Time formatters
  function formatClock(totalSec) {
    if (totalSec <= 0) return '00:00';
    const mins = Math.floor(totalSec / 60);
    const secs = Math.floor(totalSec % 60);
    const mm = mins < 10 ? '0' + mins : mins;
    const ss = secs < 10 ? '0' + secs : secs;
    return `${mm}:${ss}`;
  }

  function formatHoursClock(totalSec) {
    if (totalSec <= 0) return '00:00:00';
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = Math.floor(totalSec % 60);
    const hh = hours < 10 ? '0' + hours : hours;
    const mm = mins < 10 ? '0' + mins : mins;
    const ss = secs < 10 ? '0' + secs : secs;
    return `${hh}:${mm}:${ss}`;
  }

  // ========================================================
  // Progressive Stage Controller
  // ========================================================
  const stages = {
    1: document.getElementById('stage-connect'),
    2: document.getElementById('stage-choose-break'),
    3: document.getElementById('stage-youtube-break'),
    4: document.getElementById('stage-ask-study'),
    5: document.getElementById('stage-app-locked')
  };

  const stageBadges = {
    1: document.getElementById('badge-step-1'),
    2: document.getElementById('badge-step-2'),
    3: document.getElementById('badge-step-3'),
    4: document.getElementById('badge-step-4')
  };

  function goToStage(num) {
    state.currentStage = num;

    const pageContainer = document.querySelector('.page-container');
    if (num === 3) {
      pageContainer?.classList.add('wide-mode');
      showFeedView();
      loadVideos(state.currentSelectedCategory || 'All');
    } else {
      pageContainer?.classList.remove('wide-mode');
      if (typeof closeInlinePlayer === 'function') closeInlinePlayer();
    }

    // Hide all stages
    Object.values(stages).forEach(stageEl => {
      if (stageEl) stageEl.style.display = 'none';
    });

    // Show target stage
    if (stages[num]) {
      stages[num].style.display = 'block';
      stages[num].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Update Header Stepper Badges
    Object.keys(stageBadges).forEach(k => {
      const idx = parseInt(k, 10);
      const b = stageBadges[idx];
      if (!b) return;

      b.classList.remove('active', 'completed');
      if (idx === num || (num === 5 && idx === 4)) {
        b.classList.add('active');
      } else if (idx < num) {
        b.classList.add('completed');
      }
    });

    // Header Action Button Text
    const headerStatusBtn = document.getElementById('header-status-btn');
    if (headerStatusBtn) {
      if (num === 1) headerStatusBtn.textContent = '1. Connect 🔑';
      else if (num === 2) headerStatusBtn.textContent = '2. Choose Break 🌿';
      else if (num === 3) headerStatusBtn.textContent = '3. Break Active 🌿';
      else if (num === 4) headerStatusBtn.textContent = '4. Set Study 🔒';
      else if (num === 5) headerStatusBtn.textContent = 'Study Locked 🔒';
    }
  }

  // ========================================================
  // STAGE 1: Connect Account
  // ========================================================
  const accountUnconnectedBox = document.getElementById('account-unconnected-box');
  const accountConnectedBox = document.getElementById('account-connected-box');
  const accountNameText = document.getElementById('account-name-text');
  const accountAvatarChar = document.getElementById('account-avatar-char');
  const btnOpenConnectModal = document.getElementById('btn-open-connect-modal');
  const btnProceedToBreak = document.getElementById('btn-proceed-to-break');
  const modalConnectAccount = document.getElementById('modal-connect-account');
  const btnCloseConnectModal = document.getElementById('btn-close-connect-modal');
  const btnConfirmConnect = document.getElementById('btn-confirm-connect');
  const connectEmailInput = document.getElementById('connect-email-input');
  const btnPresetEmail1 = document.getElementById('btn-preset-email-1');
  const btnPresetEmail2 = document.getElementById('btn-preset-email-2');

  btnOpenConnectModal?.addEventListener('click', () => {
    modalConnectAccount?.classList.add('open');
  });

  btnCloseConnectModal?.addEventListener('click', () => {
    modalConnectAccount?.classList.remove('open');
  });

  btnPresetEmail1?.addEventListener('click', () => {
    connectEmailInput.value = 'student@gmail.com';
  });

  btnPresetEmail2?.addEventListener('click', () => {
    connectEmailInput.value = 'focus.engineer@gmail.com';
  });

  btnConfirmConnect?.addEventListener('click', async () => {
    const email = connectEmailInput.value.trim() || 'student@gmail.com';
    state.isConnected = true;
    state.connectedEmail = email;
    localStorage.setItem('fl_connected_email', email);

    accountUnconnectedBox.style.display = 'none';
    accountConnectedBox.style.display = 'flex';
    accountNameText.textContent = `Google Account: ${email}`;
    accountAvatarChar.textContent = email.charAt(0).toUpperCase();

    const ytAccountEmailLabel = document.getElementById('yt-account-email-label');
    const ytAccountAvatarChar = document.getElementById('yt-account-avatar-char');
    if (ytAccountEmailLabel) ytAccountEmailLabel.textContent = `Google Account: ${email}`;
    if (ytAccountAvatarChar) ytAccountAvatarChar.textContent = email.charAt(0).toUpperCase();

    modalConnectAccount?.classList.remove('open');
    playTone(587.33, 'sine', 0.2);
    showToast('Account Connected ✓', `Linked with ${email}. Proceeding to choose break time.`);

    // Automatically transition to Stage 2
    setTimeout(() => goToStage(2), 600);
  });

  btnProceedToBreak?.addEventListener('click', () => {
    goToStage(2);
  });

  // Check existing connection
  const savedEmail = localStorage.getItem('fl_connected_email');
  if (savedEmail) {
    state.isConnected = true;
    state.connectedEmail = savedEmail;
    accountUnconnectedBox.style.display = 'none';
    accountConnectedBox.style.display = 'flex';
    accountNameText.textContent = `Google Account: ${savedEmail}`;
    accountAvatarChar.textContent = savedEmail.charAt(0).toUpperCase();

    const ytAccountEmailLabel = document.getElementById('yt-account-email-label');
    const ytAccountAvatarChar = document.getElementById('yt-account-avatar-char');
    if (ytAccountEmailLabel) ytAccountEmailLabel.textContent = `Google Account: ${savedEmail}`;
    if (ytAccountAvatarChar) ytAccountAvatarChar.textContent = savedEmail.charAt(0).toUpperCase();
  }

  // ========================================================
  // STAGE 2: Choose Break Time
  // ========================================================
  const breakChoicePills = document.querySelectorAll('.break-choice-pill');
  const inputCustomBreak = document.getElementById('input-custom-break');
  const btnLaunchYoutubeBreak = document.getElementById('btn-launch-youtube-break');
  const btnStage2OpenReal = document.getElementById('btn-stage2-open-real');

  breakChoicePills.forEach(pill => {
    pill.addEventListener('click', () => {
      breakChoicePills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const mins = parseInt(pill.getAttribute('data-minutes'), 10) || 15;
      state.breakDurationMinutes = mins;
      if (inputCustomBreak) inputCustomBreak.value = mins;
    });
  });

  inputCustomBreak?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    if (val && val > 0) {
      state.breakDurationMinutes = val;
      breakChoicePills.forEach(p => {
        if (parseInt(p.getAttribute('data-minutes'), 10) === val) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });
    }
  });

  btnLaunchYoutubeBreak?.addEventListener('click', async () => {
    const mins = state.breakDurationMinutes || 15;

    try {
      await fetch('/api/break/start/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_minutes: mins })
      });

      state.remainingSeconds = mins * 60;
      playChimeStart();
      showToast('YouTube Break Unlocked 🌿', `${mins} min break started. Shorts are quarantined!`);
      refreshAnalytics();

      // Launch Stage 3 (Directly YouTube Page)
      goToStage(3);
    } catch (err) {
      console.error('Failed to start break:', err);
    }
  });

  btnStage2OpenReal?.addEventListener('click', async () => {
    const mins = state.breakDurationMinutes || 15;

    try {
      await fetch('/api/break/start/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_minutes: mins })
      });

      state.remainingSeconds = mins * 60;
      playChimeStart();
      showToast('Break Active 🌿', `${mins}m break running. Shorts shield active on youtube.com!`);
      refreshAnalytics();
      goToStage(3);
    } catch (err) {
      console.error('Failed to start break:', err);
    }
  });

  // ========================================================
  // STAGE 3: Authentic YouTube Browsing (Strictly No Shorts)
  // ========================================================
  const breakLiveClock = document.getElementById('break-live-clock');
  const btnFinishBreakNow = document.getElementById('btn-finish-break-now');
  const ytSearchForm = document.getElementById('yt-search-form');
  const videoSearchInput = document.getElementById('video-search-input');
  const btnVideoSearch = document.getElementById('btn-video-search');
  const btnVideoClearSearch = document.getElementById('btn-video-clear-search');
  const btnTestShortsIntercept = document.getElementById('btn-test-shorts-intercept');
  const feedResultsCount = document.getElementById('feed-results-count');
  const savedCounterBadge = document.getElementById('saved-counter-badge');
  const historyCounterBadge = document.getElementById('history-counter-badge');
  const categoryPills = document.querySelectorAll('.filter-pill[data-cat]');
  const videoCardsGrid = document.getElementById('video-cards-grid');

  // Views & Player Elements
  const ytFeedView = document.getElementById('yt-feed-view');
  const ytWatchView = document.getElementById('yt-watch-view');
  const btnBackToFeed = document.getElementById('btn-back-to-feed');
  const inlinePlayerIframe = document.getElementById('inline-player-iframe');
  const watchVideoTitle = document.getElementById('watch-video-title');
  const watchChannelAvatar = document.getElementById('watch-channel-avatar');
  const watchChannelName = document.getElementById('watch-channel-name');
  const btnWatchSave = document.getElementById('btn-watch-save');
  const btnWatchCopy = document.getElementById('btn-watch-copy');
  const btnPlayerExternalLink = document.getElementById('btn-player-external-link');
  const watchDurationTag = document.getElementById('watch-duration-tag');
  const watchCategoryTag = document.getElementById('watch-category-tag');
  const watchVideoDesc = document.getElementById('watch-video-desc');
  const upNextList = document.getElementById('up-next-list');

  // Nav Tabs
  const tabHome = document.getElementById('tab-home');
  const tabSaved = document.getElementById('tab-saved');
  const tabHistory = document.getElementById('tab-history');
  const btnSurprisePick = document.getElementById('btn-surprise-pick');

  // Quarantine Modal Elements
  const modalShortsQuarantined = document.getElementById('modal-shorts-quarantined');
  const quarantineInterceptedUrl = document.getElementById('quarantine-intercepted-url');
  const btnCloseQuarantineModal = document.getElementById('btn-close-quarantine-modal');
  const btnDismissQuarantine = document.getElementById('btn-dismiss-quarantine');
  const btnQuarantineSurprise = document.getElementById('btn-quarantine-surprise');

  // Stage 3 Local State
  let currentSearchQuery = '';
  let currentSelectedCategory = 'All';
  let currentActiveTab = 'home'; // 'home', 'saved', 'history'

  // Load Watched History from localStorage
  function getWatchedHistory() {
    try {
      const raw = localStorage.getItem('fl_watched_history');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function addWatchedHistory(video) {
    let list = getWatchedHistory();
    list = list.filter(v => v.id !== video.id && v.youtube_id !== video.youtube_id);
    list.unshift({
      id: video.id,
      title: video.title,
      channel: video.channel || 'YouTube',
      duration: video.duration || video.duration_str || '25m',
      category: video.category || 'Curated',
      thumbnail_url: video.thumbnail_url || `https://i.ytimg.com/vi/${video.youtube_id}/hqdefault.jpg`,
      youtube_id: video.youtube_id,
      watched_at: new Date().toISOString()
    });
    if (list.length > 20) list = list.slice(0, 20);
    localStorage.setItem('fl_watched_history', JSON.stringify(list));
    updateHistoryCount();
  }

  function updateHistoryCount() {
    const list = getWatchedHistory();
    if (historyCounterBadge) historyCounterBadge.textContent = list.length;
  }

  // View Switching
  function showFeedView() {
    if (ytFeedView) ytFeedView.style.display = 'block';
    if (ytWatchView) ytWatchView.style.display = 'none';
  }

  function showWatchView() {
    if (ytFeedView) ytFeedView.style.display = 'none';
    if (ytWatchView) ytWatchView.style.display = 'block';
    ytWatchView?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeInlinePlayer() {
    if (inlinePlayerIframe) inlinePlayerIframe.innerHTML = '';
    state.activeVideo = null;
    showFeedView();
  }

  btnBackToFeed?.addEventListener('click', () => {
    showFeedView();
  });

  btnFinishBreakNow?.addEventListener('click', () => {
    finishBreakAndAskStudy();
  });

  function finishBreakAndAskStudy() {
    closeInlinePlayer();
    playAlertBreakEnd();
    showToast('Break Completed 🔔', 'Time to choose your study hours and lock YouTube.');
    goToStage(4);
  }

  // ========================================================
  // Shorts Quarantine Defense Engine
  // ========================================================
  async function handleShortsQuarantined(targetUrl) {
    playWarningBuzzer();
    const urlStr = targetUrl || 'https://www.youtube.com/shorts/...';

    if (quarantineInterceptedUrl) {
      quarantineInterceptedUrl.textContent = urlStr;
    }

    // Open Quarantine Alert Modal
    modalShortsQuarantined?.classList.add('open');

    // Telemetry log to Django API
    try {
      await fetch('/api/events/log/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'SHORTS_BLOCKED_BREAK',
          app_name: 'YouTube Shorts',
          target_url: urlStr,
          note: 'Blocked direct Shorts navigation during intentional break.'
        })
      });
      refreshAnalytics();
    } catch (e) {
      console.debug('Failed to log shorts telemetry:', e);
    }

    showToast('❌ Shorts Quarantined!', 'Shorts loop intercepted. Only intentional long-form is allowed.', true);
  }

  // Test Shorts Defense Button
  btnTestShortsIntercept?.addEventListener('click', () => {
    handleShortsQuarantined('https://www.youtube.com/shorts/3t78j6x0w3A');
  });

  // Close Quarantine Modal Handlers
  btnCloseQuarantineModal?.addEventListener('click', () => {
    modalShortsQuarantined?.classList.remove('open');
  });

  btnDismissQuarantine?.addEventListener('click', () => {
    modalShortsQuarantined?.classList.remove('open');
    showFeedView();
  });

  btnQuarantineSurprise?.addEventListener('click', () => {
    modalShortsQuarantined?.classList.remove('open');
    triggerSurpriseVideo();
  });

  // ========================================================
  // Video Feed & API Fetching
  // ========================================================
  async function loadVideos(category = 'All', query = '', onlySaved = false) {
    try {
      if (currentActiveTab === 'history') {
        const historyList = getWatchedHistory();
        state.videos = historyList;
        renderVideos(historyList);
        if (feedResultsCount) {
          feedResultsCount.textContent = `Recently Watched (${historyList.length} videos)`;
        }
        return;
      }

      // Sync External Search Link
      const btnOpenSearchExternal = document.getElementById('btn-open-search-external');
      if (btnOpenSearchExternal) {
        if (query) {
          btnOpenSearchExternal.style.display = 'inline-flex';
          btnOpenSearchExternal.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
          btnOpenSearchExternal.textContent = `▶ Open "${query}" on YouTube.com ↗`;
        } else {
          btnOpenSearchExternal.style.display = 'none';
        }
      }

      // Show temporary loading indicator for search
      if (query && videoCardsGrid) {
        videoCardsGrid.innerHTML = `
          <div style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; color: var(--brand-text-muted);">
            <div style="font-size: 2.2rem; margin-bottom: 12px;">⏳</div>
            <strong style="display: block; font-size: 1.1rem; color: var(--brand-dark); margin-bottom: 6px;">
              Searching YouTube for "${query}"...
            </strong>
            <span style="font-size: 0.88rem;">Filtering out Shorts & loops for verified long-form content</span>
          </div>
        `;
      }

      let url = '/api/videos/?';
      const params = [];
      if (category && category !== 'All') params.push(`category=${encodeURIComponent(category)}`);
      if (query) params.push(`q=${encodeURIComponent(query)}`);
      if (onlySaved) params.push('saved=true');

      url += params.join('&');
      const res = await fetch(url);
      const data = await res.json();
      state.videos = data.videos || [];
      renderVideos(state.videos);

      // Update header label
      if (feedResultsCount) {
        if (query) {
          feedResultsCount.textContent = `Search results for "${query}" (${state.videos.length})`;
        } else if (onlySaved) {
          feedResultsCount.textContent = `Saved Queue (${state.videos.length} videos)`;
        } else if (category && category !== 'All') {
          feedResultsCount.textContent = `${category} (${state.videos.length} videos)`;
        } else {
          feedResultsCount.textContent = `Approved Long-Form Videos (${state.videos.length})`;
        }
      }

      updateSavedCount();
      updateHistoryCount();
    } catch (err) {
      console.debug('Failed to load videos:', err);
    }
  }

  async function updateSavedCount() {
    try {
      const res = await fetch('/api/videos/?saved=true');
      const data = await res.json();
      const count = (data.videos || []).length;
      if (savedCounterBadge) savedCounterBadge.textContent = count;
    } catch (e) {
      console.debug('Failed to update saved count:', e);
    }
  }

  // ========================================================
  // Video Grid Renderer (Real YouTube Cards)
  // ========================================================
  function renderVideos(videos) {
    if (!videoCardsGrid) return;
    videoCardsGrid.innerHTML = '';

    if (!videos.length) {
      const searchFallbackHtml = currentSearchQuery ? `
        <div style="margin-top: 16px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(currentSearchQuery)}" target="_blank" class="pill-btn yt-btn-open-real" style="text-decoration: none; padding: 10px 20px;">
            ▶ Open "${currentSearchQuery}" on YouTube.com ↗
          </a>
          <button type="button" class="pill-btn pill-btn-outline" id="btn-reset-feed-filters">
            Reset All Filters
          </button>
        </div>
      ` : `
        <div style="margin-top: 16px;">
          <button type="button" class="pill-btn pill-btn-sm" id="btn-reset-feed-filters">
            Reset All Filters
          </button>
        </div>
      `;

      videoCardsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; color: var(--brand-text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 10px;">🔍</div>
          <strong style="display: block; font-size: 1.1rem; color: var(--brand-dark); margin-bottom: 6px;">
            ${currentSearchQuery ? `No cached long-form videos found for "${currentSearchQuery}"` : 'No long-form videos found'}
          </strong>
          <span style="font-size: 0.88rem; display: block; max-width: 440px; margin: 0 auto;">
            ${currentSearchQuery 
              ? 'You can open this search directly on YouTube with Shorts protection enabled, or search for another topic.' 
              : 'No videos matched your filter. Try a different category or reset filters.'}
          </span>
          ${searchFallbackHtml}
        </div>
      `;

      document.getElementById('btn-reset-feed-filters')?.addEventListener('click', () => {
        if (videoSearchInput) videoSearchInput.value = '';
        currentSearchQuery = '';
        currentSelectedCategory = 'All';
        currentActiveTab = 'home';
        updateActiveTabUI();
        categoryPills.forEach(p => {
          if (p.getAttribute('data-cat') === 'All') p.classList.add('active');
          else p.classList.remove('active');
        });
        loadVideos('All', '', false);
      });
      return;
    }

    videos.forEach((v) => {
      const card = document.createElement('div');
      card.className = 'yt-card';
      card.setAttribute('data-id', v.id || v.youtube_id);

      const thumb = v.thumbnail_url || `https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg`;
      const fallbackThumb = `https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg`;
      const duration = v.duration || (v.duration_minutes ? `${v.duration_minutes}m` : '25m');
      const channel = v.channel || 'Documentary Channel';
      const channelInitial = channel.charAt(0).toUpperCase();
      const isSaved = !!v.is_saved;

      card.innerHTML = `
        <div class="yt-thumb-wrap">
          <img 
            class="yt-thumb-img" 
            src="${thumb}" 
            alt="${v.title}" 
            loading="lazy"
            onerror="if(this.src!=='${fallbackThumb}')this.src='${fallbackThumb}'"
          >
          <span class="yt-thumb-duration">${duration}</span>
          <div class="yt-thumb-play-overlay">
            <span class="yt-play-chip">▶ Watch</span>
          </div>
        </div>

        <div class="yt-card-body">
          <div class="yt-card-avatar">${channelInitial}</div>
          <div class="yt-card-meta">
            <h4 class="yt-card-title" title="${v.title}">${v.title}</h4>
            <div class="yt-card-channel">
              <span>${channel}</span>
              <span class="yt-card-verified-check" title="Verified Intentional Creator">✓</span>
            </div>
            <div class="yt-card-subline">
              <span class="yt-card-cat-pill">${v.category || 'Curated'}</span>
              <span>•</span>
              <span>${duration}</span>
            </div>
          </div>
        </div>

        <div class="yt-card-footer">
          <button type="button" class="yt-card-save-btn ${isSaved ? 'saved' : ''}" data-id="${v.id}" title="Save to queue">
            ${isSaved ? '★ Saved' : '☆ Save to Queue'}
          </button>
          <button type="button" class="pill-btn pill-btn-sm btn-play-card">Watch Now ↗</button>
        </div>
      `;

      // Card Click -> Play Video
      card.addEventListener('click', () => {
        playVideoInline(v);
      });

      // Watch Button Click
      card.querySelector('.btn-play-card')?.addEventListener('click', (e) => {
        e.stopPropagation();
        playVideoInline(v);
      });

      // Save Button Click
      card.querySelector('.yt-card-save-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        if (v.id) {
          await toggleSaveVideo(v.id, btn);
        }
      });

      videoCardsGrid.appendChild(card);
    });
  }

  // ========================================================
  // Watch View / Theater Mode
  // ========================================================
  function playVideoInline(video) {
    state.activeVideo = video;
    showWatchView();

    // Add to History
    addWatchedHistory(video);

    // Populate Video Details
    if (watchVideoTitle) watchVideoTitle.textContent = video.title;
    if (watchChannelName) watchChannelName.textContent = video.channel || 'YouTube';
    if (watchChannelAvatar) {
      watchChannelAvatar.textContent = (video.channel || 'Y').charAt(0).toUpperCase();
    }
    if (watchDurationTag) {
      watchDurationTag.textContent = video.duration || `${video.duration_minutes || 25} min`;
    }
    if (watchCategoryTag) {
      watchCategoryTag.textContent = video.category || 'Science & Tech';
    }
    if (watchVideoDesc) {
      watchVideoDesc.textContent = video.description || 'Deep intentional documentary and video essay content for your scheduled break.';
    }

    if (btnPlayerExternalLink) {
      btnPlayerExternalLink.href = `https://www.youtube.com/watch?v=${video.youtube_id}`;
    }

    // Update Save button state
    if (btnWatchSave) {
      btnWatchSave.textContent = video.is_saved ? '★ Saved in Queue' : '★ Save to Queue';
      btnWatchSave.onclick = async () => {
        if (video.id) {
          await toggleSaveVideo(video.id);
          video.is_saved = !video.is_saved;
          btnWatchSave.textContent = video.is_saved ? '★ Saved in Queue' : '★ Save to Queue';
        }
      };
    }

    // Embed YouTube Player with rel=0, autoplay=1, enablejsapi=1
    if (inlinePlayerIframe) {
      inlinePlayerIframe.innerHTML = `
        <iframe 
          src="https://www.youtube.com/embed/${video.youtube_id}?autoplay=1&rel=0&enablejsapi=1" 
          title="${video.title}" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen>
        </iframe>
      `;
    }

    // Populate Up Next Queue
    populateUpNext(video.youtube_id);

    // Log Boundary Telemetry
    try {
      fetch('/api/events/log/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'LONG_VIDEO_WATCHED',
          app_name: 'YouTube',
          target_url: `https://www.youtube.com/watch?v=${video.youtube_id}`,
          note: `Watched long-form: ${video.title}`
        })
      }).then(() => refreshAnalytics());
    } catch (e) {
      console.debug('Telemetry error:', e);
    }
  }

  // Populate Up Next List (Only Intentional Long-Form)
  function populateUpNext(currentVideoId) {
    if (!upNextList) return;
    upNextList.innerHTML = '';

    const candidates = state.videos.filter(v => v.youtube_id !== currentVideoId);
    const selected = candidates.slice(0, 8);

    selected.forEach(item => {
      const row = document.createElement('div');
      row.className = 'yt-up-next-item';
      const thumb = item.thumbnail_url || `https://i.ytimg.com/vi/${item.youtube_id}/hqdefault.jpg`;
      const dur = item.duration || `${item.duration_minutes || 24}m`;

      row.innerHTML = `
        <div class="yt-up-next-thumb">
          <img src="${thumb}" alt="${item.title}" loading="lazy">
          <span class="duration">${dur}</span>
        </div>
        <div class="yt-up-next-meta">
          <div class="yt-up-next-title" title="${item.title}">${item.title}</div>
          <div class="yt-up-next-channel">${item.channel} • <span style="font-weight: 700;">${item.category}</span></div>
        </div>
      `;

      row.addEventListener('click', () => {
        playVideoInline(item);
      });

      upNextList.appendChild(row);
    });
  }

  // Copy URL Button Handler
  btnWatchCopy?.addEventListener('click', () => {
    if (state.activeVideo) {
      const url = `https://www.youtube.com/watch?v=${state.activeVideo.youtube_id}`;
      navigator.clipboard.writeText(url).then(() => {
        showToast('Link Copied 🔗', 'YouTube video URL copied to clipboard.');
      });
    }
  });

  // Toggle Save Video API
  async function toggleSaveVideo(videoId, btnEl) {
    try {
      const res = await fetch(`/api/videos/${videoId}/save/`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'ok') {
        const isNowSaved = data.is_saved;
        if (btnEl) {
          if (isNowSaved) {
            btnEl.classList.add('saved');
            btnEl.textContent = '★ Saved';
            showToast('Video Saved ★', 'Added to your Intentional Saved Queue.');
          } else {
            btnEl.classList.remove('saved');
            btnEl.textContent = '☆ Save to Queue';
            showToast('Video Removed', 'Removed from your Saved Queue.');
          }
        }
        updateSavedCount();
        if (currentActiveTab === 'saved') {
          loadVideos(currentSelectedCategory, currentSearchQuery, true);
        }
      }
    } catch (err) {
      console.error('Failed to toggle save video:', err);
    }
  }

  // ========================================================
  // Search & Navigation Handlers
  // ========================================================
  ytSearchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    executeSearch();
  });

  btnVideoSearch?.addEventListener('click', (e) => {
    e.preventDefault();
    executeSearch();
  });

  videoSearchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeSearch();
    }
  });

  async function executeSearch() {
    const raw = videoSearchInput?.value.trim() || '';
    if (!raw) {
      currentSearchQuery = '';
      if (btnVideoClearSearch) btnVideoClearSearch.style.display = 'none';
      loadVideos(currentSelectedCategory, '', currentActiveTab === 'saved');
      return;
    }

    // 1. STRICT SHORTS DETECTION IN SEARCH OR URL
    if (raw.toLowerCase().includes('/shorts') || raw.toLowerCase().includes('shorts')) {
      handleShortsQuarantined(raw);
      return;
    }

    // 2. CHECK IF INPUT IS A YOUTUBE URL
    if (raw.includes('youtube.com') || raw.includes('youtu.be')) {
      try {
        const res = await fetch('/api/validate-video/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: raw })
        });
        const data = await res.json();

        if (data.status === 'blocked') {
          handleShortsQuarantined(raw);
          return;
        }

        if (data.status === 'ok') {
          playVideoInline({
            title: data.title || 'Custom Long-Form Video',
            channel: data.channel || 'YouTube',
            duration: data.duration || 'Long-form',
            category: data.category || 'Curated',
            thumbnail_url: data.thumbnail_url,
            youtube_id: data.video_id,
            description: data.description
          });
          showToast('Long-Form Loaded 🌿', 'Playing distraction-free. Shorts stripped.');
          return;
        } else {
          showToast('Invalid URL', data.message || 'Please check the YouTube link.', true);
          return;
        }
      } catch (err) {
        console.error('URL validate error:', err);
      }
    }

    // 3. TEXT SEARCH
    currentSearchQuery = raw;
    currentSelectedCategory = 'All';
    categoryPills.forEach(p => {
      if (p.getAttribute('data-cat') === 'All') p.classList.add('active');
      else p.classList.remove('active');
    });
    if (btnVideoClearSearch) btnVideoClearSearch.style.display = 'inline-block';
    showFeedView();
    loadVideos('All', currentSearchQuery, currentActiveTab === 'saved');
  }

  btnVideoClearSearch?.addEventListener('click', () => {
    if (videoSearchInput) videoSearchInput.value = '';
    currentSearchQuery = '';
    if (btnVideoClearSearch) btnVideoClearSearch.style.display = 'none';
    showFeedView();
    loadVideos(currentSelectedCategory, '', currentActiveTab === 'saved');
  });

  // Tab Switching Helper
  function updateActiveTabUI() {
    [tabHome, tabSaved, tabHistory].forEach(t => t?.classList.remove('active'));
    if (currentActiveTab === 'home') tabHome?.classList.add('active');
    else if (currentActiveTab === 'saved') tabSaved?.classList.add('active');
    else if (currentActiveTab === 'history') tabHistory?.classList.add('active');
  }

  tabHome?.addEventListener('click', () => {
    currentActiveTab = 'home';
    updateActiveTabUI();
    showFeedView();
    loadVideos(currentSelectedCategory, currentSearchQuery, false);
  });

  tabSaved?.addEventListener('click', () => {
    currentActiveTab = 'saved';
    updateActiveTabUI();
    showFeedView();
    loadVideos(currentSelectedCategory, currentSearchQuery, true);
  });

  tabHistory?.addEventListener('click', () => {
    currentActiveTab = 'history';
    updateActiveTabUI();
    showFeedView();
    loadVideos(currentSelectedCategory, currentSearchQuery, false);
  });

  async function triggerSurpriseVideo() {
    try {
      const res = await fetch('/api/videos/?surprise=true');
      const data = await res.json();
      if (data.video) {
        playVideoInline(data.video);
        showToast('🎲 Surprise Pick!', `Now Playing: "${data.video.title}"`);
      }
    } catch (e) {
      console.debug('Surprise pick error:', e);
    }
  }

  btnSurprisePick?.addEventListener('click', triggerSurpriseVideo);

  // Category Filter Pills
  categoryPills.forEach(pill => {
    pill.addEventListener('click', () => {
      categoryPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentSelectedCategory = pill.getAttribute('data-cat') || 'All';
      showFeedView();
      loadVideos(currentSelectedCategory, currentSearchQuery, currentActiveTab === 'saved');
    });
  });

  // ========================================================
  // STAGE 4: Ask Study Hours
  // ========================================================
  const hourChoicePills = document.querySelectorAll('.hour-choice-pill');
  const studyCustomHours = document.getElementById('study-custom-hours');
  const studyTaskInput = document.getElementById('study-task-input');
  const btnLockAndClose = document.getElementById('btn-lock-and-close');

  hourChoicePills.forEach(pill => {
    pill.addEventListener('click', () => {
      hourChoicePills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const hrs = parseFloat(pill.getAttribute('data-hours')) || 2;
      state.studyDurationHours = hrs;
      if (studyCustomHours) studyCustomHours.value = hrs;
    });
  });

  studyCustomHours?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (val && val > 0) {
      state.studyDurationHours = val;
      hourChoicePills.forEach(p => {
        if (parseFloat(p.getAttribute('data-hours')) === val) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });
    }
  });

  btnLockAndClose?.addEventListener('click', async () => {
    const hours = state.studyDurationHours || 2;
    const task = studyTaskInput?.value.trim() || 'Study Session';
    const durationMinutes = Math.round(hours * 60);

    state.studyTask = task;
    state.remainingSeconds = durationMinutes * 60;

    try {
      await fetch('/api/focus/start/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duration_minutes: durationMinutes,
          task_name: task
        })
      });

      playTone(440, 'triangle', 0.4);
      showToast('YouTube Locked 🔒', `Locked for ${hours} hours. Go focus on "${task}"!`);
      refreshAnalytics();

      // Launch Stage 5 (App Closed & Locked)
      const lockedTaskNotice = document.getElementById('locked-task-notice');
      if (lockedTaskNotice) {
        lockedTaskNotice.textContent = `YouTube is locked for the next ${hours} hours for "${task}". All distractions shielded!`;
      }
      goToStage(5);
    } catch (err) {
      console.error('Failed to lock app for study:', err);
    }
  });

  // ========================================================
  // STAGE 5: App Closed / YouTube Locked Overlay
  // ========================================================
  const lockedClockDigits = document.getElementById('locked-clock-digits');
  const btnTestLockedYoutube = document.getElementById('btn-test-locked-youtube');
  const btnEndStudyLock = document.getElementById('btn-end-study-lock');

  btnTestLockedYoutube?.addEventListener('click', async () => {
    playWarningBuzzer();
    await fetch('/api/events/log/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'YOUTUBE_ATTEMPT_FOCUS',
        app_name: 'YouTube',
        target_url: 'https://youtube.com',
        note: 'Attempted to open YouTube during locked study block.'
      })
    });
    window.open('/blocked/?app=YouTube&reason=focus_locked', '_blank');
    refreshAnalytics();
  });

  btnEndStudyLock?.addEventListener('click', async () => {
    try {
      await fetch('/api/focus/end/', { method: 'POST' });
      showToast('Study Session Concluded', 'Great job honoring your boundary!');
      refreshAnalytics();
      goToStage(2);
    } catch (e) {
      console.error('End session error:', e);
    }
  });

  // ========================================================
  // Live Timer Synchronizer
  // ========================================================
  function startTicker() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      if (state.remainingSeconds > 0) {
        state.remainingSeconds--;
        state.elapsedSeconds++;

        if (state.currentStage === 3) {
          if (breakLiveClock) breakLiveClock.textContent = formatClock(state.remainingSeconds);
          if (state.remainingSeconds <= 0) {
            finishBreakAndAskStudy();
          }
        } else if (state.currentStage === 5) {
          if (lockedClockDigits) lockedClockDigits.textContent = formatHoursClock(state.remainingSeconds);
          if (state.remainingSeconds <= 0) {
            playChimeStart();
            showToast('Study Session Completed! 🎉', 'You have honored your study boundary.');
            goToStage(2);
          }
        }
      }
    }, 1000);
  }

  // Refresh Analytics
  async function refreshAnalytics() {
    try {
      const res = await fetch('/api/analytics/');
      const data = await res.json();
      const m = data.metrics_table;

      const numYtFocus = document.getElementById('num-yt-focus');
      const numShortsBlocked = document.getElementById('num-shorts-blocked');
      const numBreaksCompleted = document.getElementById('num-breaks-completed');
      const numAvgBreak = document.getElementById('num-avg-break');

      if (numYtFocus) numYtFocus.textContent = m.youtube_attempts_during_focus;
      if (numShortsBlocked) numShortsBlocked.textContent = m.shorts_blocked;
      if (numBreaksCompleted) numBreaksCompleted.textContent = `${m.breaks_completed} / ${m.breaks_started}`;
      if (numAvgBreak) numAvgBreak.textContent = m.avg_break;

      const el = id => document.getElementById(id);
      if (el('tb-breaks-started')) el('tb-breaks-started').textContent = m.breaks_started;
      if (el('tb-breaks-completed')) el('tb-breaks-completed').textContent = m.breaks_completed;
      if (el('tb-shorts-blocked')) el('tb-shorts-blocked').textContent = m.shorts_blocked;
      if (el('tb-long-videos')) el('tb-long-videos').textContent = m.long_videos_watched;
      if (el('tb-avg-break')) el('tb-avg-break').textContent = m.avg_break;
      if (el('tb-avg-planned')) el('tb-avg-planned').textContent = m.avg_planned_break;
      if (el('tb-overruns')) el('tb-overruns').textContent = m.break_overruns;
      if (el('tb-yt-focus')) el('tb-yt-focus').textContent = m.youtube_attempts_during_focus;
      if (el('tb-focus-completed')) el('tb-focus-completed').textContent = m.focus_sessions_completed;
    } catch (err) {
      console.debug('Failed to refresh analytics:', err);
    }
  }

  // Analytics Modal
  const modalAnalytics = document.getElementById('modal-analytics');
  const btnViewAnalyticsModal = document.getElementById('btn-view-analytics-modal');
  const navAnalyticsLink = document.getElementById('nav-analytics-link');
  const btnCloseAnalytics = document.getElementById('btn-close-analytics');
  const btnDoneAnalytics = document.getElementById('btn-done-analytics');

  btnViewAnalyticsModal?.addEventListener('click', () => { refreshAnalytics(); modalAnalytics?.classList.add('open'); });
  navAnalyticsLink?.addEventListener('click', (e) => { e.preventDefault(); refreshAnalytics(); modalAnalytics?.classList.add('open'); });
  btnCloseAnalytics?.addEventListener('click', () => modalAnalytics?.classList.remove('open'));
  btnDoneAnalytics?.addEventListener('click', () => modalAnalytics?.classList.remove('open'));

  // Header quick navigation
  document.getElementById('header-status-btn')?.addEventListener('click', () => {
    if (state.currentStage === 5) {
      showToast('App Locked', 'YouTube is locked for your study block.');
    } else {
      goToStage(state.currentStage);
    }
  });

  // Initial Boot
  refreshAnalytics();
  updateHistoryCount();
  loadVideos('All');
  startTicker();

  // If already connected from localStorage, start at Stage 2
  if (state.isConnected) {
    goToStage(2);
  } else {
    goToStage(1);
  }
});
