/**
 * FocusLoop - YouTube Shorts Detection & Boundary Service
 * Ported & adapted from sosnagemechu21/FocusLoop
 * Connects native mobile/accessibility detection events to the Django Boundary Engine.
 */

import { NativeEventEmitter, NativeModules, Platform } from "react-native";

const { YouTubeShortsModule } = NativeModules || {};
const DJANGO_API_URL = "http://127.0.0.1:8000";

class YouTubeShortsDetector {
  constructor() {
    this.eventEmitter = null;
    this.listeners = new Map();
    this.isInitialized = false;

    if (Platform && Platform.OS === "android" && YouTubeShortsModule) {
      this.eventEmitter = new NativeEventEmitter(YouTubeShortsModule);
      this.isInitialized = true;
    }
  }

  /**
   * Check if Android accessibility permission is granted
   */
  async checkAccessibilityPermission() {
    if (!this.isInitialized) {
      return false;
    }

    try {
      return await YouTubeShortsModule.checkAccessibilityPermission();
    } catch (error) {
      console.error("Error checking accessibility permission:", error);
      return false;
    }
  }

  /**
   * Open accessibility settings on device
   */
  async openAccessibilitySettings() {
    if (!this.isInitialized) {
      throw new Error("YouTube Shorts detector not available on this platform");
    }

    try {
      return await YouTubeShortsModule.openAccessibilitySettings();
    } catch (error) {
      console.error("Error opening accessibility settings:", error);
      throw error;
    }
  }

  /**
   * Start listening for Shorts detection events and sync with FocusLoop boundary
   */
  startMonitoring(onShortsDetected) {
    if (!this.isInitialized || !this.eventEmitter) {
      console.warn("YouTubeShortsDetector: Native module unavailable. Running in web/extension fallback mode.");
      return () => {};
    }

    const subscription = this.eventEmitter.addListener("onYouTubeShortsDetected", async (event) => {
      console.log("⚡ YouTube Shorts detected by Accessibility Service:", event);

      // 1. Report to Django backend boundary engine
      try {
        await fetch(`${DJANGO_API_URL}/api/events/log/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_type: "SHORTS_BLOCKED_BREAK",
            app_name: "YouTube Android",
            target_url: event.url || "youtube://shorts",
            note: "Android Accessibility Service intercepted Shorts stream."
          })
        });
      } catch (err) {
        console.debug("Django API sync failed:", err);
      }

      // 2. Trigger local callback
      if (typeof onShortsDetected === "function") {
        onShortsDetected(event);
      }
    });

    return () => subscription.remove();
  }
}

export default new YouTubeShortsDetector();
