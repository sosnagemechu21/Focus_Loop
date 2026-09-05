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
      showToast('YouTube Break Unlocked 🌿', `${mins} min break started. Shorts are quarantined!`);
      refreshAnalytics();

      // Launch Stage 3 (Directly YouTube Page)
      goToStage(3);
    } catch (err) {
      console.error('Failed to start break:', err);
    }
  });

  // ========================================================
  // STAGE 3: Directly YouTube Page (Strictly No Shorts)
  // ========================================================
  const breakLiveClock = document.getElementById('break-live-clock');
  const btnFinishBreakNow = document.getElementById('btn-finish-break-now');
  const customVideoUrl = document.getElementById('custom-video-url');
  const btnSubmitCustomVideo = document.getElementById('btn-submit-custom-video');
  const btnTestShortsIntercept = document.getElementById('btn-test-shorts-intercept');
  const inlinePlayerContainer = document.getElementById('inline-player-container');
  const inlinePlayerIframe = document.getElementById('inline-player-iframe');
  const inlinePlayerTitle = document.getElementById('inline-player-title');
  const btnCloseInlinePlayer = document.getElementById('btn-close-inline-player');
  const videoCardsGrid = document.getElementById('video-cards-grid');
  const filterAll = document.getElementById('filter-all');
  const filterSaved = document.getElementById('filter-saved');
  const btnSurprisePick = document.getElementById('btn-surprise-pick');

  btnFinishBreakNow?.addEventListener('click', () => {
    finishBreakAndAskStudy();
  });

  function finishBreakAndAskStudy() {
    closeInlinePlayer();
    playAlertBreakEnd();
    showToast('Break Completed 🔔', 'Time to choose your study hours and lock YouTube.');
    goToStage(4);
  }

  // Real Shorts Interceptor
  btnSubmitCustomVideo?.addEventListener('click', async () => {
    const url = customVideoUrl.value.trim();
    if (!url) {
      showToast('Input Required', 'Please paste a YouTube video URL.', true);
      return;
    }

    try {
      const res = await fetch('/api/validate-video/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url })
      });
      const data = await res.json();

      if (data.status === 'blocked') {
        playWarningBuzzer();
        showToast('❌ Shorts Quarantined!', data.message, true);
        refreshAnalytics();
        return;
      }

      if (data.status === 'ok') {
        playVideoInline({
          title: data.title,
          channel: 'Custom URL',
          youtube_id: data.video_id
        });
        showToast('Long-Form Loaded 🌿', 'Playing distraction-free. Shorts stripped.');
      } else {
        showToast('Invalid URL', data.message || 'Please check the link.', true);
      }
    } catch (err) {
      console.error('Validation error:', err);
    }
  });

  btnTestShortsIntercept?.addEventListener('click', async () => {
    playWarningBuzzer();
    await fetch('/api/validate-video/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.youtube.com/shorts/3t78j6x0w3A' })
    });
    showToast(
      '❌ Shorts Intercepted & Quarantined!',
      'Shorts loop blocked. Only intentional long-form videos are allowed during breaks.',
      true
    );
    refreshAnalytics();
  });

  function playVideoInline(video) {
    state.activeVideo = video;
    if (inlinePlayerContainer && inlinePlayerIframe) {
      inlinePlayerTitle.textContent = `Now Playing: ${video.title} (${video.channel || 'YouTube'})`;
      
      const externalLink = document.getElementById('btn-player-external-link');
      if (externalLink) {
        externalLink.href = `https://www.youtube.com/watch?v=${video.youtube_id}`;
        externalLink.style.display = 'inline-flex';
      }

      inlinePlayerIframe.innerHTML = `
        <iframe 
          src="https://www.youtube.com/embed/${video.youtube_id}?rel=0&enablejsapi=1" 
          title="${video.title}" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen>
        </iframe>
      `;
      inlinePlayerContainer.style.display = 'block';
      inlinePlayerContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function closeInlinePlayer() {
    if (inlinePlayerContainer) inlinePlayerContainer.style.display = 'none';
    if (inlinePlayerIframe) inlinePlayerIframe.innerHTML = '';
    state.activeVideo = null;
  }

  btnCloseInlinePlayer?.addEventListener('click', closeInlinePlayer);

  // Search & Category Filters State
  let currentSearchQuery = '';
  let currentSelectedCategory = 'All';

  const videoSearchInput = document.getElementById('video-search-input');
  const btnVideoSearch = document.getElementById('btn-video-search');
  const btnVideoClearSearch = document.getElementById('btn-video-clear-search');
  const feedResultsCount = document.getElementById('feed-results-count');
  const savedCounterBadge = document.getElementById('saved-counter-badge');
  const categoryPills = document.querySelectorAll('.filter-pill[data-cat]');

  // Load Curated Videos with Search Query and Category
  async function loadVideos(category = 'All', query = '', onlySaved = false) {
    try {
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

      // Update counter and header label
      if (feedResultsCount) {
        if (query) {
          feedResultsCount.textContent = `Search results for "${query}" (${state.videos.length})`;
        } else if (onlySaved) {
          feedResultsCount.textContent = `Saved Queue (${state.videos.length} videos)`;
        } else if (category && category !== 'All') {
          feedResultsCount.textContent = `${category} Videos (${state.videos.length})`;
        } else {
          feedResultsCount.textContent = `Approved Long-Form Videos (${state.videos.length})`;
        }
      }

      // Update saved counter
      updateSavedCount();
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

  function renderVideos(videos) {
    if (!videoCardsGrid) return;
    videoCardsGrid.innerHTML = '';

    if (!videos.length) {
      videoCardsGrid.innerHTML = `
        <div style="padding: 36px 20px; text-align: center; color: var(--brand-text-muted);">
          <strong style="display: block; font-size: 1rem; color: var(--brand-dark); margin-bottom: 6px;">No videos found</strong>
          <span style="font-size: 0.85rem;">Try a different keyword or click "All" to browse the full library.</span>
        </div>
      `;
      return;
    }

    videos.forEach((v, idx) => {
      const row = document.createElement('div');
      row.className = 'video-row-item';
      const isSaved = v.is_saved;

      row.innerHTML = `
        <div class="video-row-left">
          <div class="video-row-icon">${idx + 1}</div>
          <div class="video-row-content">
            <div class="video-row-title">${v.title}</div>
            <div class="video-row-sub">${v.channel} • <span style="font-weight: 700; color: var(--brand-dark);">${v.category}</span></div>
          </div>
        </div>
        <div class="video-row-right">
          <span class="video-duration-tag">${v.duration}</span>
          <button class="video-save-btn ${isSaved ? 'saved' : ''}" type="button" data-id="${v.id}" title="Save to queue">
            ${isSaved ? '★ Saved' : '☆ Save'}
          </button>
          <button class="pill-btn pill-btn-sm btn-play-row" type="button">▶ Play</button>
        </div>
      `;

      // Play video when clicked
      row.querySelector('.btn-play-row')?.addEventListener('click', (e) => {
        e.stopPropagation();
        playVideoInline(v);
      });

      // Save / Bookmark video
      row.querySelector('.video-save-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        await toggleSaveVideo(v.id, btn);
      });

      videoCardsGrid.appendChild(row);
    });
  }

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
            btnEl.textContent = '☆ Save';
            showToast('Video Removed', 'Removed from your Saved Queue.');
          }
        }
        updateSavedCount();
      }
    } catch (err) {
      console.error('Failed to toggle save video:', err);
    }
  }

  // Search input and handlers (Direct search, NO distraction suggestions)
  btnVideoSearch?.addEventListener('click', () => {
    executeSearch();
  });

  videoSearchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeSearch();
    }
  });

  function executeSearch() {
    const q = videoSearchInput?.value.trim() || '';
    currentSearchQuery = q;
    if (btnVideoClearSearch) {
      btnVideoClearSearch.style.display = q ? 'inline-flex' : 'none';
    }
    loadVideos(currentSelectedCategory, currentSearchQuery, false);
  }

  btnVideoClearSearch?.addEventListener('click', () => {
    if (videoSearchInput) videoSearchInput.value = '';
    currentSearchQuery = '';
    if (btnVideoClearSearch) btnVideoClearSearch.style.display = 'none';
    loadVideos(currentSelectedCategory, '', false);
  });

  // Category filter pills
  categoryPills.forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentSelectedCategory = pill.getAttribute('data-cat') || 'All';
      loadVideos(currentSelectedCategory, currentSearchQuery, false);
    });
  });

  // Saved Queue filter
  filterSaved?.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    filterSaved.classList.add('active');
    loadVideos('All', currentSearchQuery, true);
  });

  btnSurprisePick?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/videos/?surprise=true');
      const data = await res.json();
      if (data.video) {
        playVideoInline(data.video);
        showToast('Surprise Selected', `Loading: "${data.video.title}"`);
      }
    } catch (e) {
      console.debug('Surprise pick error:', e);
    }
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
  loadVideos('all');
  startTicker();

  // If already connected from localStorage, start at Stage 2
  if (state.isConnected) {
    goToStage(2);
  } else {
    goToStage(1);
  }
});
