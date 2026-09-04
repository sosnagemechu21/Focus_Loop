/**
 * LimitManager.js
 * Tracks active focus/break session limits and handles auto-locking.
 */

const DJANGO_API_URL = "http://127.0.0.1:8000";

class LimitManager {
  async getStatus() {
    try {
      const res = await fetch(`${DJANGO_API_URL}/api/status/`);
      return await res.json();
    } catch (e) {
      console.error("Failed to fetch limit status:", e);
      return null;
    }
  }

  async startFocus(durationMinutes = 50) {
    try {
      const res = await fetch(`${DJANGO_API_URL}/api/focus/start/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration_minutes: durationMinutes })
      });
      return await res.json();
    } catch (e) {
      console.error("Failed to start focus session:", e);
      return null;
    }
  }

  async startBreak(durationMinutes = 20) {
    try {
      const res = await fetch(`${DJANGO_API_URL}/api/break/start/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration_minutes: durationMinutes })
      });
      return await res.json();
    } catch (e) {
      console.error("Failed to start break session:", e);
      return null;
    }
  }

  async endBreak() {
    try {
      const res = await fetch(`${DJANGO_API_URL}/api/break/end/`, { method: "POST" });
      return await res.json();
    } catch (e) {
      console.error("Failed to end break session:", e);
      return null;
    }
  }
}

export default new LimitManager();
