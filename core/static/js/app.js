// FocusLoop Minimalist 2-Color Brand Application Engine

document.addEventListener('DOMContentLoaded', () => {
  const state = {
    mode: 'FOCUS', // 'FOCUS' | 'BREAK'
    remainingSeconds: 3000,
    elapsedSeconds: 0,
    plannedDurationMinutes: 50,
    taskName: 'Study / Deep Work Block',
    nextBreakTime: '12:30 PM',
    timerInterval: null,
    videos: [],
    currentFilter: 'all'
  };

  // DOM References
  const headerStatusBtn = document.getElementById('header-status-btn');
  const btnHeroBreak = document.getElementById('btn-hero-break');
  const btnHeroSimulate = document.getElementById('btn-hero-simulate');
  const btnHeroTotal = document.getElementById('btn-hero-total');

  const cardFocusTag = document.getElementById('card-focus-tag');
  const cardFocusRemaining = document.getElementById('card-focus-remaining');
  const cardFocusHeadline = document.getElementById('card-focus-headline');
  const cardFocusBody = document.getElementById('card-focus-body');
  const cardBreakTag = document.getElementById('card-break-tag');
  const cardBreakTimerText = document.getElementById('card-break-timer-text');
  const cardAnalyticsAttempts = document.getElementById('card-analytics-attempts');

  // Stats Strip
  const numYtFocus = document.getElementById('num-yt-focus');
  const numShortsBlocked = document.getElementById('num-shorts-blocked');
  const numBreaksCompleted = document.getElementById('num-breaks-completed');
  const numAvgBreak = document.getElementById('num-avg-break');

  // Video Grid & Filters
  const videoCardsGrid = document.getElementById('video-cards-grid');
  const filterAll = document.getElementById('filter-all');
  const filterSaved = document.getElementById('filter-saved');
  const btnSurprisePick = document.getElementById('btn-surprise-pick');

  // Modals
  const modalAnalytics = document.getElementById('modal-analytics');
  const modalSettings = document.getElementById('modal-settings');
  const modalVideoPlayer = document.getElementById('modal-video-player');
  const brandToast = document.getElementById('brand-toast');

  // Toast Function
  function showToast(heading, text) {
    const toastHeading = document.getElementById('toast-heading');
    const toastText = document.getElementById('toast-text');
    toastHeading.textContent = heading;
    toastText.textContent = text;
    brandToast.classList.add('show');
    setTimeout(() => {
      brandToast.classList.remove('show');
    }, 4500);
  }

  document.getElementById('btn-toast-close')?.addEventListener('click', () => {
    brandToast.classList.remove('show');
  });

  // Time Formatter
  function formatRemaining(totalSec) {
    if (totalSec <= 0) return '00:00';
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = Math.floor(totalSec % 60);
    if (hours > 0) return `${hours}h ${mins}m remaining`;
    const mm = mins < 10 ? '0' + mins : mins;
    const ss = secs < 10 ? '0' + secs : secs;
    return `${mm}:${ss} remaining`;
  }

  // Fetch Status from Django API
  async function fetchStatus() {
    try {
      const res = await fetch('/api/status/');
      if (!res.ok) return;
      const data = await res.json();

      state.mode = data.mode;
      state.remainingSeconds = data.remaining_seconds;
      state.elapsedSeconds = data.elapsed_seconds;
      state.plannedDurationMinutes = data.planned_duration_minutes;
      state.taskName = data.task_name;
      state.nextBreakTime = data.next_break_time;

      updateStatusUI();
    } catch (err) {
      console.debug('Failed to fetch status:', err);
    }
  }

  function updateStatusUI() {
    if (state.mode === 'FOCUS') {
      headerStatusBtn.textContent = 'Focus Locked 🔒';
      headerStatusBtn.className = 'pill-btn';
      btnHeroBreak.textContent = 'Start Break';

      if (cardFocusTag) cardFocusTag.textContent = 'SESSION FOCUS';
      if (cardFocusRemaining) cardFocusRemaining.textContent = formatRemaining(state.remainingSeconds);
      if (cardFocusHeadline) cardFocusHeadline.textContent = state.taskName;
      if (cardFocusBody) {
        cardFocusBody.textContent = 'Outside scheduled breaks, YouTube is strictly locked. Every impulse to open distraction apps is shielded at the boundary.';
      }
      if (cardBreakTimerText) cardBreakTimerText.textContent = '20 min allowance';
    } else {
      headerStatusBtn.textContent = 'Break Active 🌿';
      headerStatusBtn.className = 'pill-btn pill-btn-outline';
      btnHeroBreak.textContent = 'Finish Break 🔒';

      if (cardFocusTag) cardFocusTag.textContent = 'FOCUS PAUSED';
      if (cardFocusRemaining) cardFocusRemaining.textContent = 'Break in progress';
      if (cardBreakTimerText) cardBreakTimerText.textContent = formatRemaining(state.remainingSeconds);
    }
  }

  // Live Timer Ticker
  function startTicker() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      if (state.remainingSeconds > 0) {
        state.remainingSeconds--;
        state.elapsedSeconds++;

        if (state.mode === 'FOCUS') {
          if (cardFocusRemaining) cardFocusRemaining.textContent = formatRemaining(state.remainingSeconds);
        } else {
          if (cardBreakTimerText) cardBreakTimerText.textContent = formatRemaining(state.remainingSeconds);
          if (state.remainingSeconds <= 0) {
            endBreakSession();
          }
        }
      }
    }, 1000);
  }

  // Start Break API
  async function startBreakSession(durationMins = 20) {
    try {
      const res = await fetch('/api/break/start/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_minutes: durationMins })
      });
      const data = await res.json();
      state.mode = 'BREAK';
      state.remainingSeconds = durationMins * 60;
      updateStatusUI();
      showToast('Break Started 🌿', `YouTube is unlocked for ${durationMins}m (Long-form only. Shorts blocked).`);
      refreshAnalytics();
    } catch (err) {
      console.error('Failed to start break:', err);
    }
  }

  // End Break API
  async function endBreakSession() {
    try {
      const res = await fetch('/api/break/end/', { method: 'POST' });
      const data = await res.json();
      state.mode = 'FOCUS';
      updateStatusUI();
      showToast('Break Complete 🔒', 'YouTube is locked until your next break. Back to focus.');
      refreshAnalytics();
    } catch (err) {
      console.error('Failed to end break:', err);
    }
  }

  // Toggle Break / Focus from Hero Button
  btnHeroBreak?.addEventListener('click', () => {
    if (state.mode === 'FOCUS') {
      startBreakSession(20);
    } else {
      endBreakSession();
    }
  });

  headerStatusBtn?.addEventListener('click', () => {
    if (state.mode === 'FOCUS') {
      startBreakSession(20);
    } else {
      endBreakSession();
    }
  });

  // Hero Simulate Button: Tests Boundary Defense
  btnHeroSimulate?.addEventListener('click', async () => {
    if (state.mode === 'FOCUS') {
      await fetch('/api/events/log/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'YOUTUBE_ATTEMPT_FOCUS',
          app_name: 'YouTube',
          target_url: 'https://youtube.com',
          note: 'Blocked impulse to open YouTube while in focus mode.'
        })
      });
      showToast('Boundary Defended 🔒', 'YouTube launch intercepted! Temptation metric logged. Attention protected.');
    } else {
      await fetch('/api/events/log/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'SHORTS_BLOCKED_BREAK',
          app_name: 'YouTube',
          target_url: 'https://youtube.com/shorts',
          note: 'Shorts blocked during intentional break.'
        })
      });
      showToast('Shorts Intercepted ❌', 'Shorts blocked! Autopilot scrolling quarantined. Enjoy deep long-form.');
    }
    refreshAnalytics();
  });

  // Hero Total Shorts Button
  btnHeroTotal?.addEventListener('click', async () => {
    await fetch('/api/events/log/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'SHORTS_BLOCKED_BREAK',
        app_name: 'YouTube',
        target_url: 'https://youtube.com/shorts',
        note: 'Shorts blocked during intentional break.'
      })
    });
    showToast('Shorts Blocked ❌', 'Dopamine loop prevented. Counter incremented.');
    refreshAnalytics();
  });

  // Analytics Telemetry
  async function refreshAnalytics() {
    try {
      const res = await fetch('/api/analytics/');
      const data = await res.json();
      const m = data.metrics_table;

      if (numYtFocus) numYtFocus.textContent = m.youtube_attempts_during_focus;
      if (numShortsBlocked) numShortsBlocked.textContent = m.shorts_blocked;
      if (btnHeroTotal) btnHeroTotal.textContent = `${m.shorts_blocked} Shorts Blocked`;
      if (numBreaksCompleted) numBreaksCompleted.textContent = `${m.breaks_completed} / ${m.breaks_started}`;
      if (numAvgBreak) numAvgBreak.textContent = m.avg_break;
      if (cardAnalyticsAttempts) cardAnalyticsAttempts.textContent = `${m.youtube_attempts_during_focus} Temptations`;

      // Modal Table
      document.getElementById('tb-breaks-started').textContent = m.breaks_started;
      document.getElementById('tb-breaks-completed').textContent = m.breaks_completed;
      document.getElementById('tb-shorts-blocked').textContent = m.shorts_blocked;
      document.getElementById('tb-long-videos').textContent = m.long_videos_watched;
      document.getElementById('tb-avg-break').textContent = m.avg_break;
      document.getElementById('tb-avg-planned').textContent = m.avg_planned_break;
      document.getElementById('tb-overruns').textContent = m.break_overruns;
      document.getElementById('tb-yt-focus').textContent = m.youtube_attempts_during_focus;
      document.getElementById('tb-focus-completed').textContent = m.focus_sessions_completed;

      // Insight
      const headline = document.getElementById('insight-headline');
      const detail = document.getElementById('insight-detail');
      const temptation = document.getElementById('insight-temptation');
      if (headline) headline.textContent = data.narrative.headline;
      if (detail) detail.textContent = data.narrative.detail;
      if (temptation) temptation.textContent = data.narrative.temptation_insight;

    } catch (err) {
      console.debug('Failed to refresh analytics:', err);
    }
  }

  // Load Curated Videos
  async function loadVideos(filter = 'all') {
    try {
      let url = '/api/videos/';
      if (filter === 'saved') url += '?saved=true';
      const res = await fetch(url);
      const data = await res.json();
      state.videos = data.videos || [];
      renderVideos(state.videos);
    } catch (err) {
      console.debug('Failed to load videos:', err);
    }
  }

  function renderVideos(videos) {
    if (!videoCardsGrid) return;
    videoCardsGrid.innerHTML = '';

    videos.forEach(v => {
      const card = document.createElement('article');
      card.className = 'video-entry-card';
      card.innerHTML = `
        <div>
          <div class="card-top-row">
            <span class="card-tag-pill">${v.category}</span>
            <span class="card-date-text">${v.duration}</span>
          </div>
          <h3 class="card-headline" style="font-size: 1.15rem; margin-bottom: 8px;">${v.title}</h3>
          <p class="card-body-text" style="font-size: 0.88rem; margin-bottom: 18px;">${v.description || 'High-value long-form deep dive.'}</p>
        </div>
        <div class="card-footer-row">
          <div class="card-source-info">${v.channel}</div>
          <button class="card-view-btn">Play &#8599;</button>
        </div>
      `;
      card.addEventListener('click', () => openVideoPlayer(v));
      videoCardsGrid.appendChild(card);
    });
  }

  // Open Video Player Modal
  function openVideoPlayer(video) {
    const titleEl = document.getElementById('player-title');
    const iframeBox = document.getElementById('player-iframe-box');
    if (titleEl) titleEl.textContent = video.title;

    if (iframeBox) {
      iframeBox.innerHTML = `
        <iframe 
          src="https://www.youtube-nocookie.com/embed/${video.youtube_id}?autoplay=1&rel=0" 
          title="${video.title}" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
          allowfullscreen>
        </iframe>
      `;
    }

    modalVideoPlayer?.classList.add('open');

    fetch('/api/events/log/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'LONG_VIDEO_WATCHED',
        app_name: 'YouTube',
        target_url: `https://youtube.com/watch?v=${video.youtube_id}`,
        note: `Intentional break viewing: "${video.title}"`,
        video_id: video.youtube_id
      })
    }).then(() => refreshAnalytics());
  }

  document.getElementById('btn-close-player')?.addEventListener('click', () => {
    modalVideoPlayer?.classList.remove('open');
    const iframeBox = document.getElementById('player-iframe-box');
    if (iframeBox) iframeBox.innerHTML = '';
  });

  document.getElementById('btn-player-finish-break')?.addEventListener('click', () => {
    modalVideoPlayer?.classList.remove('open');
    const iframeBox = document.getElementById('player-iframe-box');
    if (iframeBox) iframeBox.innerHTML = '';
    endBreakSession();
  });

  // Filter Buttons
  filterAll?.addEventListener('click', () => {
    filterAll.classList.add('active');
    filterSaved.classList.remove('active');
    loadVideos('all');
  });

  filterSaved?.addEventListener('click', () => {
    filterSaved.classList.add('active');
    filterAll.classList.remove('active');
    loadVideos('saved');
  });

  btnSurprisePick?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/videos/?surprise=true');
      const data = await res.json();
      if (data.video) {
        openVideoPlayer(data.video);
        showToast('Surprise Selected', `Loading: "${data.video.title}"`);
      }
    } catch (e) {
      console.debug('Surprise pick error:', e);
    }
  });

  // Card View Buttons
  document.getElementById('btn-view-focus-details')?.addEventListener('click', () => {
    showToast('Focus Boundary', 'Focus session active. YouTube locked until break.');
  });

  document.getElementById('btn-view-break-library')?.addEventListener('click', () => {
    document.querySelector('.longform-library-section')?.scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('btn-view-analytics-modal')?.addEventListener('click', () => {
    refreshAnalytics();
    modalAnalytics?.classList.add('open');
  });

  document.getElementById('btn-close-analytics')?.addEventListener('click', () => {
    modalAnalytics?.classList.remove('open');
  });
  document.getElementById('btn-done-analytics')?.addEventListener('click', () => {
    modalAnalytics?.classList.remove('open');
  });

  // Settings Modal
  async function loadSettings() {
    try {
      const res = await fetch('/api/settings/');
      const data = await res.json();
      const list = document.getElementById('settings-apps-list');
      if (!list) return;
      list.innerHTML = '';

      data.apps.forEach(app => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; background-color: var(--brand-card); padding: 12px 16px; border-radius: 10px;';
        row.innerHTML = `
          <div>
            <strong style="font-size: 0.95rem;">${app.name}</strong>
            <div style="font-size: 0.8rem; color: var(--brand-text-muted);">${app.special_rule}</div>
          </div>
          <input type="checkbox" ${app.is_enabled ? 'checked' : ''} data-app="${app.name}" style="width: 20px; height: 20px; accent-color: var(--brand-dark); cursor: pointer;">
        `;
        list.appendChild(row);
      });
    } catch (e) {
      console.debug('Failed to load settings:', e);
    }
  }

  document.getElementById('nav-settings-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    loadSettings();
    modalSettings?.classList.add('open');
  });

  document.getElementById('btn-close-settings')?.addEventListener('click', () => {
    modalSettings?.classList.remove('open');
  });

  document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('#settings-apps-list input[type="checkbox"]');
    const apps = [];
    checkboxes.forEach(chk => {
      apps.push({
        name: chk.getAttribute('data-app'),
        is_enabled: chk.checked
      });
    });
    await fetch('/api/settings/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apps })
    });
    showToast('Rules Saved', 'Protected apps settings updated.');
    modalSettings?.classList.remove('open');
  });

  // Initial Load
  fetchStatus();
  refreshAnalytics();
  loadVideos('all');
  startTicker();

  setInterval(fetchStatus, 5000);
});
