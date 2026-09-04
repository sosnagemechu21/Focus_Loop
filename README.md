# FocusLoop: Intentional YouTube Break & Boundary Engine

> The layer above screen time: controlling when entertainment is allowed, enforcing long-form only during breaks, blocking Shorts, and measuring temptation metrics.

---

## 🧠 The Core Idea

1. **Focus Session Active 🔒:** YouTube and distracting apps are completely locked.
2. **Intentional Break Begins 🌿:** YouTube unlocks for a pre-committed duration (e.g. 20 min).
3. **During that Break ❌:** YouTube Shorts and infinite reels are strictly quarantined and stripped. Only intentional long-form videos are allowed.
4. **Break Ends 🔒:** YouTube auto-locks immediately until the next scheduled break.
5. **Boundary Telemetry 📊:** Measures temptation (YouTube open attempts during focus sessions) and friction (Shorts taps during breaks), tracking your decline in autopilot app dependency over time.

---

## 🎨 Minimalist 2-Color Brand UI

Built strictly with the 2-color brand aesthetic (inspired by the earthy clay & obsidian minimalist design):
- **Base Canvas:** Warm natural sand / earthy clay (`#b8b1a5`)
- **Accent & Typography:** Solid obsidian charcoal (`#141414`)
- **Card Containers:** Refined stone tone (`#a7a094`) with soft rounded corners and clean pills
- **Zero AI Icons:** Pure typographic hierarchy and human interface design.

---

## 🛡️ Shorts Blocker Integration

Ported from [sosnagemechu21/FocusLoop](https://github.com/sosnagemechu21/FocusLoop):
- **Native Android Accessibility Service (`shorts_blocker/android/YouTubeShortsService.kt`)**: Detects YouTube Shorts container views (`reel_recycler`, `shorts_player`) in the YouTube app and intercepts them automatically.
- **React Native Bridge (`shorts_blocker/YouTubeShortsDetector.js`)**: Emits detection events and syncs with the Django boundary engine.
- **Browser Extension (`extension/`)**: Manifest V3 extension for Chrome / Edge that hides Shorts shelves and redirects direct `/shorts/*` links on desktop.

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
pip install django django-cors-headers
```

### 2. Apply Migrations & Seed Telemetry
```bash
python manage.py migrate
python seed.py
```

### 3. Start Development Server
```bash
python manage.py runserver 127.0.0.1:8000
```
Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/) in your browser.

### 4. Run Unit Tests
```bash
python manage.py test core
```

---

## 📊 Interaction Analytics API

- `GET /api/status/`: Live session mode, remaining countdown, today's focus/break minutes.
- `POST /api/break/start/`: Initiates intentional break (long-form unlocked, Shorts blocked).
- `POST /api/break/end/`: Concludes break, calculates duration and overruns, locks YouTube.
- `POST /api/events/log/`: Logs boundary events (`YOUTUBE_ATTEMPT_FOCUS`, `SHORTS_BLOCKED_BREAK`, `LONG_VIDEO_WATCHED`).
- `GET /api/analytics/`: Detailed interaction & friction telemetry table, week-over-week dependency drop, and behavioral insights.
