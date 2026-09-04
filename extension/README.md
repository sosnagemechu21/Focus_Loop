# FocusGuard Browser Extension

Enforces the boundary layer directly on Chrome / Edge / Brave:
1. **Focus Mode:** Blocks YouTube entirely and logs temptation events.
2. **Break Mode:** Unlocks YouTube, strips Shorts elements from feeds, and intercepts direct `/shorts/*` links.

## How to Install in Chrome / Edge:
1. Open `chrome://extensions` or `edge://extensions`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select this folder (`c:\Users\Beza\OneDrive\Desktop\Longform Youtube\extension`).
5. Ensure your Django server is running (`python manage.py runserver`).
