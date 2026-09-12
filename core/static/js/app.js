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
      brandToast.style.borderColor = 'var(--brand-dark)';
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

    // Show/hide break timer bar based on whether a break is active
    const stickyBreakTimer = document.getElementById('sticky-break-timer');
    if (stickyBreakTimer) {
      if (num === 3 && state.remainingSeconds > 0) {
        stickyBreakTimer.style.display = 'flex';
      } else {
        stickyBreakTimer.style.display = 'none';
      }
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
      if (num === 1) headerStatusBtn.textContent = '1. Connect';
      else if (num === 2) headerStatusBtn.textContent = '2. Break';
      else if (num === 3) headerStatusBtn.textContent = '3. Watch';
      else if (num === 4) headerStatusBtn.textContent = '4. Study';
      else if (num === 5) headerStatusBtn.textContent = 'Study Active';
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
    showToast('Account Connected', `Linked with ${email}. Proceeding to break time.`);

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
      showToast('Break Started', `${mins} min break started. Shorts excluded.`);
      refreshAnalytics();

      // Launch Stage 3 (Directly YouTube Page)
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
  const tabChannels = document.getElementById('tab-channels');
  const tabSaved = document.getElementById('tab-saved');
  const tabHistory = document.getElementById('tab-history');
  const btnSurprisePick = document.getElementById('btn-surprise-pick');
  const channelsCounterBadge = document.getElementById('channels-counter-badge');

  // Channel View Elements
  const ytChannelsView = document.getElementById('yt-channels-view');
  const channelsMainHeader = document.getElementById('channels-main-header');
  const channelsCardsGrid = document.getElementById('channels-cards-grid');
  const channelFocusBanner = document.getElementById('channel-focus-banner');
  const channelFocusAvatar = document.getElementById('channel-focus-avatar');
  const channelFocusAvatarFallback = document.getElementById('channel-focus-avatar-fallback');
  const channelFocusTitle = document.getElementById('channel-focus-title');
  const channelFocusHandle = document.getElementById('channel-focus-handle');
  const channelFocusSubs = document.getElementById('channel-focus-subs');
  const channelFocusVideoCount = document.getElementById('channel-focus-video-count');
  const channelVideosGrid = document.getElementById('channel-videos-grid');
  const btnBackToAllChannels = document.getElementById('btn-back-to-all-channels');
  const popularChannelsShelf = document.getElementById('popular-channels-shelf');
  const popularChannelsChips = document.getElementById('popular-channels-chips');
  const btnChannelsAddNew = document.getElementById('btn-channels-add-new');
  const btnOpenAddChannelModal = document.getElementById('btn-open-add-channel-modal');

  
  // Mobile Bottom Nav Sync
  const mobNavWatch = document.getElementById('mob-nav-watch');
  const mobNavSaved = document.getElementById('mob-nav-saved');
  const mobNavChannels = document.getElementById('mob-nav-channels');

  function updateMobileNavUI() {
    [mobNavWatch, mobNavSaved, mobNavChannels].forEach(m => m?.classList.remove('active'));
    if (currentActiveTab === 'home') mobNavWatch?.classList.add('active');
    else if (currentActiveTab === 'saved') mobNavSaved?.classList.add('active');
    else if (currentActiveTab === 'channels') mobNavChannels?.classList.add('active');
  }

  mobNavWatch?.addEventListener('click', () => {
    if (state.currentStage !== 3) goToStage(3);
    tabHome?.click();
  });

  mobNavSaved?.addEventListener('click', () => {
    if (state.currentStage !== 3) goToStage(3);
    tabSaved?.click();
  });

  mobNavChannels?.addEventListener('click', () => {
    if (state.currentStage !== 3) goToStage(3);
    tabChannels?.click();
  });

  // Add Channel Modal Elements
  const modalAddChannel = document.getElementById('modal-add-channel');
  const btnCloseAddChannelModal = document.getElementById('btn-close-add-channel-modal');
  const btnCancelAddChannel = document.getElementById('btn-cancel-add-channel');
  const btnSubmitAddChannel = document.getElementById('btn-submit-add-channel');
  const inputChannelQuery = document.getElementById('input-channel-query');
  const addChannelFeedback = document.getElementById('add-channel-feedback');

  // Quarantine Modal Elements
  const modalShortsQuarantined = document.getElementById('modal-shorts-quarantined');
  const quarantineInterceptedUrl = document.getElementById('quarantine-intercepted-url');
  const btnCloseQuarantineModal = document.getElementById('btn-close-quarantine-modal');
  const btnDismissQuarantine = document.getElementById('btn-dismiss-quarantine');
  const btnQuarantineSurprise = document.getElementById('btn-quarantine-surprise');

  // Stage 3 Local State
  let currentSearchQuery = '';
  let currentSelectedCategory = 'All';
  let currentActiveTab = 'home'; // 'home', 'channels', 'saved', 'history'
  let currentActiveChannel = null;

  // Load Watched History from localStorage
  function getWatchedHistory() {
    try {
      return JSON.parse(localStorage.getItem('fl_watched_history') || '[]');
    } catch (e) {
      return [];
    }
  }

  function addWatchedHistory(video) {
    if (!video || !video.youtube_id) return;
    let list = getWatchedHistory();
    list = list.filter(v => v.youtube_id !== video.youtube_id);
    list.unshift({
      id: video.id || video.youtube_id,
      youtube_id: video.youtube_id,
      title: video.title,
      channel: video.channel || 'YouTube',
      duration: video.duration || video.duration_str || '24m',
      duration_minutes: video.duration_minutes || 24,
      category: video.category || 'Curated',
      thumbnail_url: video.thumbnail_url,
      description: video.description || '',
      is_saved: video.is_saved
    });
    if (list.length > 50) list = list.slice(0, 50);
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
    if (ytChannelsView) ytChannelsView.style.display = 'none';
  }

  function showWatchView() {
    if (ytFeedView) ytFeedView.style.display = 'none';
    if (ytWatchView) ytWatchView.style.display = 'block';
    if (ytChannelsView) ytChannelsView.style.display = 'none';
    ytWatchView?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showChannelsView() {
    if (ytFeedView) ytFeedView.style.display = 'none';
    if (ytWatchView) ytWatchView.style.display = 'none';
    if (ytChannelsView) ytChannelsView.style.display = 'block';
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
    showToast('Break Completed', 'Select study duration to begin.');
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

    showToast('Shorts Quarantined', 'Shorts excluded. Only long-form videos allowed.', true);
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

      // Show temporary loading indicator for search
      if (query && videoCardsGrid) {
        videoCardsGrid.innerHTML = `
          <div style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; color: var(--brand-text-muted);">
            
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
      const searchFallbackHtml = `
        <div style="margin-top: 16px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <button type="button" class="pill-btn pill-btn-outline" id="btn-reset-feed-filters">
            Reset All Filters
          </button>
          <button type="button" class="pill-btn" id="btn-search-channels-tab" style="background: var(--brand-dark); color: var(--brand-canvas);">
            Browse Channels
          </button>
        </div>
      `;

      videoCardsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; color: var(--brand-text-muted);">
          
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

      document.getElementById('btn-search-channels-tab')?.addEventListener('click', () => {
        currentActiveTab = 'channels';
        updateActiveTabUI();
        showChannelsView();
        loadChannels();
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
            <span class="yt-play-chip">Watch</span>
          </div>
        </div>

        <div class="yt-card-body">
          <div class="yt-card-avatar">${channelInitial}</div>
          <div class="yt-card-meta">
            <h4 class="yt-card-title" title="${v.title}">${v.title}</h4>
            <div class="yt-card-channel">
              <span>${channel}</span>
              <span class="yt-card-verified-check">Verified</span>
            </div>
            <div class="yt-card-subline">
              <span class="yt-card-cat-pill">${v.category || 'Curated'}</span>
              <span>•</span>
              <span>${duration}</span>
            </div>
          </div>
        </div>

        <div class="yt-card-footer">
          <button type="button" class="yt-card-save-btn ${isSaved ? 'saved' : ''}" data-id="${v.id || ''}" data-ytid="${v.youtube_id || ''}" title="Save to queue">
            ${isSaved ? 'Saved' : 'Save'}
          </button>
          <button type="button" class="pill-btn pill-btn-sm btn-play-card">Watch</button>
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
          await toggleSaveVideo(v.id, btn, v);
        } else if (v.youtube_id) {
          await toggleSaveByYoutubeId(v, btn);
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
      btnWatchSave.textContent = video.is_saved ? 'Saved' : 'Save Video';
      btnWatchSave.onclick = async () => {
        if (video.id) {
          await toggleSaveVideo(video.id, null, video);
          btnWatchSave.textContent = video.is_saved ? 'Saved' : 'Save Video';
        } else if (video.youtube_id) {
          await toggleSaveByYoutubeId(video, null);
          btnWatchSave.textContent = video.is_saved ? 'Saved' : 'Save Video';
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
        showToast('Link Copied', 'Video URL copied to clipboard.');
      });
    }
  });

  // Toggle Save Video API
  async function toggleSaveVideo(videoId, btnEl, videoObj) {
    try {
      const res = await fetch(`/api/videos/${videoId}/save/`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'ok') {
        const isNowSaved = data.is_saved;
        if (videoObj) videoObj.is_saved = isNowSaved;
        if (btnEl) {
          if (isNowSaved) {
            btnEl.classList.add('saved');
            btnEl.textContent = 'Saved';
            showToast('Video Saved', 'Added to your Saved list.');
          } else {
            btnEl.classList.remove('saved');
            btnEl.textContent = 'Save';
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

  // Toggle Save by YouTube ID (for live search results without DB primary key)
  async function toggleSaveByYoutubeId(videoObj, btnEl) {
    try {
      const res = await fetch('/api/videos/save-by-ytid/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtube_id: videoObj.youtube_id,
          title: videoObj.title || 'Saved Video',
          channel: videoObj.channel || 'YouTube',
          duration: videoObj.duration || videoObj.duration_str || '24m',
          duration_minutes: videoObj.duration_minutes || 24,
          category: videoObj.category || 'YouTube',
          description: videoObj.description || '',
          thumbnail_url: videoObj.thumbnail_url || `https://i.ytimg.com/vi/${videoObj.youtube_id}/hqdefault.jpg`
        })
      });
      const data = await res.json();
      if (data.status === 'ok') {
        const isNowSaved = data.is_saved;
        // Update the video object with the new DB id so subsequent toggles use the fast path
        if (data.id) videoObj.id = data.id;
        videoObj.is_saved = isNowSaved;
        if (btnEl) {
          if (isNowSaved) {
            btnEl.classList.add('saved');
            btnEl.textContent = 'Saved';
            showToast('Video Saved', 'Added to your Saved list.');
          } else {
            btnEl.classList.remove('saved');
            btnEl.textContent = 'Save';
            showToast('Video Removed', 'Removed from your Saved Queue.');
          }
        }
        updateSavedCount();
        if (currentActiveTab === 'saved') {
          loadVideos(currentSelectedCategory, currentSearchQuery, true);
        }
      }
    } catch (err) {
      console.error('Failed to toggle save by youtube_id:', err);
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
          showToast('Video Loaded', 'Playing long-form content.');
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
    updateMobileNavUI();
    [tabHome, tabChannels, tabSaved, tabHistory].forEach(t => t?.classList.remove('active'));
    if (currentActiveTab === 'home') tabHome?.classList.add('active');
    else if (currentActiveTab === 'channels') tabChannels?.classList.add('active');
    else if (currentActiveTab === 'saved') tabSaved?.classList.add('active');
    else if (currentActiveTab === 'history') tabHistory?.classList.add('active');
  }

  tabHome?.addEventListener('click', () => {
    currentActiveTab = 'home';
    updateActiveTabUI();
    showFeedView();
    loadVideos(currentSelectedCategory, currentSearchQuery, false);
  });

  tabChannels?.addEventListener('click', () => {
    currentActiveTab = 'channels';
    updateActiveTabUI();
    showChannelsView();
    loadChannels();
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

  // ========================================================
  // Channels Directory Engine
  // ========================================================
  async function updateChannelsCount() {
    try {
      const res = await fetch('/api/channels/');
      const data = await res.json();
      if (channelsCounterBadge) channelsCounterBadge.textContent = data.count || 0;
    } catch (e) {
      console.debug('Failed to update channels count:', e);
    }
  }

  async function loadChannels() {
    if (!channelsCardsGrid) return;
    channelsCardsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px 20px; text-align: center; color: var(--brand-text-muted);">
        
        <strong>Loading your subscribed YouTube channels...</strong>
      </div>
    `;

    // Reset single-channel focus view
    if (channelsMainHeader) channelsMainHeader.style.display = 'flex';
    if (channelsCardsGrid) channelsCardsGrid.style.display = 'grid';
    if (popularChannelsShelf) popularChannelsShelf.style.display = 'block';
    if (channelFocusBanner) channelFocusBanner.style.display = 'none';
    if (channelVideosGrid) channelVideosGrid.style.display = 'none';

    try {
      const res = await fetch('/api/channels/');
      const data = await res.json();
      const channels = data.channels || [];

      if (channelsCounterBadge) channelsCounterBadge.textContent = channels.length;
      renderChannels(channels);
      loadPopularChannels();
    } catch (err) {
      channelsCardsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 30px; text-align: center; color: var(--brand-text-muted);">
          Failed to load channels. Please try again.
        </div>
      `;
    }
  }

  function renderChannels(channels) {
    if (!channelsCardsGrid) return;
    channelsCardsGrid.innerHTML = '';

    if (!channels.length) {
      channelsCardsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; color: var(--brand-text-muted);">
          
          <strong style="display: block; font-size: 1.15rem; color: var(--brand-dark); margin-bottom: 6px;">
            No YouTube Channels Added Yet
          </strong>
          <span style="font-size: 0.88rem; display: block; max-width: 440px; margin: 0 auto 16px;">
            Add any YouTube creator by handle, URL, or name. All their long-form uploads will be synced while Shorts are strictly quarantined.
          </span>
          <button type="button" class="pill-btn" id="btn-empty-add-channel" style="background: var(--brand-dark); color: var(--brand-canvas);">
            Add Channel
          </button>
        </div>
      `;
      document.getElementById('btn-empty-add-channel')?.addEventListener('click', () => openAddChannelModal());
      return;
    }

    channels.forEach(ch => {
      const card = document.createElement('div');
      card.className = 'channel-card';
      const avatar = ch.avatar_url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop&q=80';

      card.innerHTML = `
        <div class="channel-card-top">
          <img src="${avatar}" alt="${ch.name}" class="channel-card-avatar-img" onerror="this.src='https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop&q=80'">
          <div class="channel-card-meta">
            <h4 class="channel-card-name" title="${ch.name}">${ch.name}</h4>
            <span class="channel-card-handle">${ch.handle || ''}</span>
            <span class="channel-card-subs">${ch.subscriber_count || 'Verified Creator'}</span>
          </div>
        </div>

        <div class="channel-card-body">
          <p class="channel-card-desc">${ch.description || 'Verified intentional creator synced to your FocusLoop library.'}</p>
          <div class="channel-card-stats">
            <span class="channel-longform-badge">
              ${ch.video_count} Long-Form Videos
            </span>
            <span style="font-size: 0.78rem; opacity: 0.75;">Zero Shorts</span>
          </div>
        </div>

        <div class="channel-card-actions">
          <button type="button" class="pill-btn pill-btn-sm btn-channel-browse" data-id="${ch.id}">
            Browse Videos
          </button>
          <button type="button" class="btn-channel-remove" data-id="${ch.id}" data-name="${ch.name}" title="Remove channel">
            Remove
          </button>
        </div>
      `;

      // Browse Button
      card.querySelector('.btn-channel-browse')?.addEventListener('click', () => {
        browseChannel(ch.id);
      });

      // Remove Button
      card.querySelector('.btn-channel-remove')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const cid = ch.id;
        const cname = ch.name;
        if (confirm(`Remove "${cname}" from your subscribed channels?`)) {
          await removeChannel(cid, cname);
        }
      });

      channelsCardsGrid.appendChild(card);
    });
  }

  async function browseChannel(channelId) {
    if (!channelVideosGrid) return;
    channelVideosGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px 20px; text-align: center; color: var(--brand-text-muted);">
        
        <strong>Loading long-form videos for this creator...</strong>
      </div>
    `;

    // Toggle views inside channels tab
    if (channelsMainHeader) channelsMainHeader.style.display = 'none';
    if (channelsCardsGrid) channelsCardsGrid.style.display = 'none';
    if (popularChannelsShelf) popularChannelsShelf.style.display = 'none';
    if (channelFocusBanner) channelFocusBanner.style.display = 'flex';
    if (channelVideosGrid) channelVideosGrid.style.display = 'grid';

    try {
      const res = await fetch(`/api/channels/${channelId}/videos/`);
      const data = await res.json();
      const channel = data.channel;
      const videos = data.videos || [];

      // Populate Banner
      if (channelFocusTitle) channelFocusTitle.textContent = channel.name;
      if (channelFocusHandle) channelFocusHandle.textContent = channel.handle || '';
      if (channelFocusSubs) channelFocusSubs.textContent = channel.subscriber_count || '';
      if (channelFocusVideoCount) channelFocusVideoCount.textContent = `${videos.length} Verified Long-Form Videos`;

      if (channelFocusAvatar) {
        channelFocusAvatar.src = channel.avatar_url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop&q=80';
        channelFocusAvatar.onerror = () => {
          if (channelFocusAvatar) channelFocusAvatar.style.display = 'none';
          if (channelFocusAvatarFallback) {
            channelFocusAvatarFallback.style.display = 'flex';
            channelFocusAvatarFallback.textContent = channel.name.charAt(0).toUpperCase();
          }
        };
      }

      // Render Channel Videos Grid
      renderChannelVideos(videos, channel.name);
    } catch (err) {
      channelVideosGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 30px; text-align: center; color: var(--brand-text-muted);">
          Failed to load videos for this channel.
        </div>
      `;
    }
  }

  function renderChannelVideos(videos, channelName) {
    if (!channelVideosGrid) return;
    channelVideosGrid.innerHTML = '';

    if (!videos.length) {
      channelVideosGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 48px 20px; text-align: center; color: var(--brand-text-muted);">
          
          <strong>No long-form videos currently indexed for ${channelName}.</strong>
          <p style="font-size: 0.88rem; margin-top: 6px;">All Shorts on this channel were quarantined. You can trigger an import with higher limits.</p>
        </div>
      `;
      return;
    }

    videos.forEach(v => {
      const card = document.createElement('div');
      card.className = 'yt-card';
      const thumb = v.thumbnail_url || `https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg`;
      const fallbackThumb = `https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg`;
      const duration = v.duration || (v.duration_minutes ? `${v.duration_minutes}m` : '25m');
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
            <span class="yt-play-chip">Watch</span>
          </div>
        </div>

        <div class="yt-card-body">
          <div class="yt-card-avatar">${channelName.charAt(0).toUpperCase()}</div>
          <div class="yt-card-meta">
            <h4 class="yt-card-title" title="${v.title}">${v.title}</h4>
            <div class="yt-card-channel">
              <span>${channelName}</span>
              <span class="yt-card-verified-check">Verified</span>
            </div>
            <div class="yt-card-subline">
              <span class="yt-card-cat-pill">${v.category || 'YouTube'}</span>
              <span>•</span>
              <span>${duration}</span>
            </div>
          </div>
        </div>

        <div class="yt-card-footer">
          <button type="button" class="yt-card-save-btn ${isSaved ? 'saved' : ''}" data-id="${v.id}" title="Save to queue">
            ${isSaved ? 'Saved' : 'Save'}
          </button>
          <button type="button" class="pill-btn pill-btn-sm btn-play-card">Watch</button>
        </div>
      `;

      card.addEventListener('click', () => playVideoInline(v));
      card.querySelector('.btn-play-card')?.addEventListener('click', (e) => {
        e.stopPropagation();
        playVideoInline(v);
      });
      card.querySelector('.yt-card-save-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (v.id) {
          await toggleSaveVideo(v.id, e.currentTarget, v);
        } else if (v.youtube_id) {
          await toggleSaveByYoutubeId(v, e.currentTarget);
        }
      });

      channelVideosGrid.appendChild(card);
    });
  }

  btnBackToAllChannels?.addEventListener('click', () => {
    if (channelsMainHeader) channelsMainHeader.style.display = 'flex';
    if (channelsCardsGrid) channelsCardsGrid.style.display = 'grid';
    if (popularChannelsShelf) popularChannelsShelf.style.display = 'block';
    if (channelFocusBanner) channelFocusBanner.style.display = 'none';
    if (channelVideosGrid) channelVideosGrid.style.display = 'none';
  });

  async function removeChannel(channelId, channelName) {
    try {
      const res = await fetch(`/api/channels/${channelId}/`, { method: 'DELETE' });
      const data = await res.json();
      if (data.status === 'ok') {
        showToast('Channel Removed', `"${channelName}" was removed from your list.`);
        loadChannels();
        updateChannelsCount();
      }
    } catch (e) {
      console.error('Failed to remove channel:', e);
    }
  }

  async function loadPopularChannels() {
    if (!popularChannelsChips) return;
    try {
      const res = await fetch('/api/channels/popular/');
      const data = await res.json();
      const list = data.popular || [];

      popularChannelsChips.innerHTML = '';
      list.forEach(p => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'popular-channel-chip';
        chip.innerHTML = `
          <img src="${p.avatar}" alt="${p.name}" class="popular-chip-avatar">
          <span>${p.name}</span>
          <span class="popular-chip-add">+</span>
        `;
        chip.addEventListener('click', async () => {
          chip.disabled = true;
          chip.style.opacity = '0.5';
          showToast('Adding Channel...', `Ingesting ${p.name} via backend...`);
          try {
            const addRes = await fetch('/api/channels/add/', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ input: p.handle, max_videos: 30 })
            });
            const addData = await addRes.json();
            if (addData.status === 'ok') {
              showToast('Channel Added', `Added ${p.name} (${addData.imported_count} videos synced)`);
              loadChannels();
              updateChannelsCount();
            } else {
              showToast('Error', addData.message || 'Failed to add channel', true);
            }
          } catch (e) {
            showToast('Error', 'Network error adding channel', true);
          } finally {
            chip.disabled = false;
            chip.style.opacity = '1';
          }
        });
        popularChannelsChips.appendChild(chip);
      });
    } catch (e) {
      console.debug('Failed to load popular channels:', e);
    }
  }

  // Add Channel Modal Handlers
  function openAddChannelModal(initialQuery = '') {
    if (inputChannelQuery) inputChannelQuery.value = initialQuery;
    if (addChannelFeedback) {
      addChannelFeedback.style.display = 'none';
      addChannelFeedback.textContent = '';
    }
    modalAddChannel?.classList.add('open');
    setTimeout(() => inputChannelQuery?.focus(), 100);
  }

  function closeAddChannelModal() {
    modalAddChannel?.classList.remove('open');
  }

  btnOpenAddChannelModal?.addEventListener('click', () => openAddChannelModal());
  // Top Add Channel Button
  const btnOpenAddChannelTop = document.getElementById('btn-open-add-channel-top');
  btnOpenAddChannelTop?.addEventListener('click', () => openAddChannelModal());

  btnChannelsAddNew?.addEventListener('click', () => openAddChannelModal());
  btnCloseAddChannelModal?.addEventListener('click', closeAddChannelModal);
  btnCancelAddChannel?.addEventListener('click', closeAddChannelModal);

  // Suggestion buttons in modal
  document.querySelectorAll('.btn-suggest-handle').forEach(btn => {
    btn.addEventListener('click', () => {
      const handle = btn.getAttribute('data-handle');
      if (inputChannelQuery && handle) {
        inputChannelQuery.value = handle;
        submitAddChannel();
      }
    });
  });

  btnSubmitAddChannel?.addEventListener('click', () => {
    submitAddChannel();
  });

  inputChannelQuery?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAddChannel();
    }
  });

  async function submitAddChannel() {
    const raw = inputChannelQuery?.value.trim() || '';
    if (!raw) {
      if (addChannelFeedback) {
        addChannelFeedback.style.display = 'block';
        addChannelFeedback.style.backgroundColor = 'var(--brand-card)';
        addChannelFeedback.style.color = 'var(--brand-dark)';
        addChannelFeedback.textContent = 'Please enter a channel handle, URL, or name.';
      }
      return;
    }

    if (btnSubmitAddChannel) {
      btnSubmitAddChannel.disabled = true;
      btnSubmitAddChannel.textContent = 'Importing Channel...';
    }

    if (addChannelFeedback) {
      addChannelFeedback.style.display = 'block';
      addChannelFeedback.style.backgroundColor = 'var(--brand-card)';
      addChannelFeedback.style.color = 'var(--brand-dark)';
      addChannelFeedback.innerHTML = `
        <strong>Importing channel...</strong><br>
        Scanning uploads for "${raw}", checking durations, and strictly quarantining Shorts.
      `;
    }

    try {
      const res = await fetch('/api/channels/add/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: raw, max_videos: 40 })
      });
      const data = await res.json();

      if (data.status === 'ok') {
        showToast('Channel Added', `${data.channel.name}: ${data.imported_count} long-form videos imported.`);
        closeAddChannelModal();
        updateChannelsCount();

        // Switch to Channels view and browse
        currentActiveTab = 'channels';
        updateActiveTabUI();
        showChannelsView();
        loadChannels();
      } else {
        if (addChannelFeedback) {
          addChannelFeedback.style.display = 'block';
          addChannelFeedback.style.backgroundColor = 'var(--brand-card)';
          addChannelFeedback.style.color = 'var(--brand-dark)';
          addChannelFeedback.textContent = data.message || 'Failed to add channel. Please check the handle or name.';
        }
      }
    } catch (err) {
      if (addChannelFeedback) {
        addChannelFeedback.style.display = 'block';
        addChannelFeedback.style.backgroundColor = 'var(--brand-card)';
        addChannelFeedback.style.color = 'var(--brand-dark)';
        addChannelFeedback.textContent = 'Network error while contacting backend. Please try again.';
      }
    } finally {
      if (btnSubmitAddChannel) {
        btnSubmitAddChannel.disabled = false;
        btnSubmitAddChannel.textContent = 'Import Channel';
      }
    }
  }

  async function triggerSurpriseVideo() {
    try {
      const res = await fetch('/api/videos/?surprise=true');
      const data = await res.json();
      if (data.video) {
        playVideoInline(data.video);
        showToast('Random Pick', `Now Playing: "${data.video.title}"`);
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
      showToast('Session Locked', `Locked for ${hours} hours for "${task}".`);
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
            showToast('Session Completed', 'Study session finished.');
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

  
  // ========================================================
  // PWA & Service Worker Registration
  // ========================================================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/static/sw.js')
        .then(reg => console.log('FocusLoop Service Worker registered:', reg.scope))
        .catch(err => console.debug('Service Worker registration skipped:', err));
    });
  }

  let deferredInstallPrompt = null;
  const btnInstallPwa = document.getElementById('btn-install-pwa');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (btnInstallPwa) btnInstallPwa.style.display = 'inline-block';
  });

  btnInstallPwa?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        showToast('App Installed', 'FocusLoop added to your home screen.');
      }
      deferredInstallPrompt = null;
      btnInstallPwa.style.display = 'none';
    }
  });

  window.addEventListener('appinstalled', () => {
    if (btnInstallPwa) btnInstallPwa.style.display = 'none';
    showToast('App Ready', 'FocusLoop installed as an app.');
  });

  // ========================================================
  // Server State Sync (Timer Persistence)
  // ========================================================
  async function syncFromServer() {
    try {
      const res = await fetch('/api/status/');
      const data = await res.json();

      const serverMode = data.mode;           // 'FOCUS', 'BREAK', or 'IDLE'
      const remaining = data.remaining_seconds;
      const elapsed = data.elapsed_seconds;
      const isExpired = data.is_expired;
      const plannedMins = data.planned_duration_minutes;
      const taskName = data.task_name;
      const breakMins = data.break_duration_minutes || 15;

      if (serverMode === 'BREAK') {
        if (isExpired) {
          // Break ended while app was closed → auto-transition to ask study
          try {
            await fetch('/api/break/end/', { method: 'POST' });
          } catch (e) { /* ignore */ }
          showToast('Break Ended', 'Your break finished while the app was closed. Choose study time.');
          goToStage(4);
        } else {
          // Break is still active → resume Stage 3 with correct countdown
          state.remainingSeconds = remaining;
          state.elapsedSeconds = elapsed;
          state.breakDurationMinutes = plannedMins;
          goToStage(3);
          // Re-show the break timer bar since we have active time
          const stickyBreakTimer = document.getElementById('sticky-break-timer');
          if (stickyBreakTimer) stickyBreakTimer.style.display = 'flex';
          if (breakLiveClock) breakLiveClock.textContent = formatClock(remaining);
        }
        return true; // handled
      }

      if (serverMode === 'FOCUS') {
        if (isExpired) {
          // Focus/study ended while app was closed → end session, go to Stage 2
          try {
            await fetch('/api/focus/end/', { method: 'POST' });
          } catch (e) { /* ignore */ }
          showToast('Study Complete', 'Your study session finished while the app was closed. Great job!');
          goToStage(2);
        } else {
          // Focus/study still active → resume Stage 5 with correct countdown
          state.remainingSeconds = remaining;
          state.elapsedSeconds = elapsed;
          state.studyDurationHours = plannedMins / 60;
          state.studyTask = taskName || 'Study Session';

          const lockedTaskNotice = document.getElementById('locked-task-notice');
          const hoursLeft = Math.max(0.1, remaining / 3600).toFixed(1);
          if (lockedTaskNotice) {
            lockedTaskNotice.textContent = `YouTube is locked for ${hoursLeft} hours for "${state.studyTask}". All distractions shielded!`;
          }
          if (lockedClockDigits) lockedClockDigits.textContent = formatHoursClock(remaining);
          goToStage(5);
        }
        return true; // handled
      }

      // IDLE mode — no active session
      return false;
    } catch (err) {
      console.debug('Failed to sync from server:', err);
      return false;
    }
  }

  // Initial Boot
  refreshAnalytics();
  updateHistoryCount();
  updateChannelsCount();
  loadVideos('All');
  startTicker();

  // Sync state from server first, then fall back to localStorage check
  syncFromServer().then(handled => {
    if (!handled) {
      // No active server session — use localStorage connection state
      if (state.isConnected) {
        goToStage(2);
      } else {
        goToStage(1);
      }
    }
  });
});
