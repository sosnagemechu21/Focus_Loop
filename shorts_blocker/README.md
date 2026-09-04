# FocusLoop: Mobile & Web Shorts Blocker Architecture

This module integrates the YouTube Shorts blocking capabilities from [sosnagemechu21/FocusLoop](https://github.com/sosnagemechu21/FocusLoop) with the Django Intentional Break Boundary Engine.

## Features
1. **Native Android Accessibility Service (`android/YouTubeShortsService.kt`)**:
   - Detects YouTube Shorts containers (`reel_recycler`, `shorts_player`, `reel_player_page`).
   - Automatically intercepts and sends `GLOBAL_ACTION_BACK` to exit Shorts.
   - Dispatches events to the React Native bridge.
2. **React Native Detection Service (`YouTubeShortsDetector.js`)**:
   - Listens to native Shorts events and logs `SHORTS_BLOCKED_BREAK` to the Django API.
3. **Web & Browser Extension (`extension/`)**:
   - Removes Shorts shelves and sidebar entries from YouTube desktop.
   - Intercepts direct `/shorts/*` URL navigation.
