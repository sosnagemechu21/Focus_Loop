package com.focusloop

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.util.Log

/**
 * FocusLoop Accessibility Service for Android
 * Automatically detects YouTube Shorts view containers and triggers blocking/boundary defense.
 */
class YouTubeShortsService : AccessibilityService() {

    companion object {
        private const val TAG = "YouTubeShortsService"
        private const val YOUTUBE_PACKAGE = "com.google.android.youtube"
        
        // Identifiers for YouTube Shorts screens & reels in official YouTube app
        private val SHORTS_IDENTIFIERS = listOf(
            "reel_recycler",
            "shorts_container",
            "reel_player_page",
            "shorts_player",
            "reel_watch_fragment"
        )
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || event.packageName != YOUTUBE_PACKAGE) {
            return
        }

        val rootNode = rootInActiveWindow ?: return
        try {
            if (isShortsActive(rootNode)) {
                Log.d(TAG, "YouTube Shorts detected! Triggering FocusLoop boundary defense.")
                
                // Block Shorts by pressing back or navigating to home feed
                performGlobalAction(GLOBAL_ACTION_BACK)

                // Broadcast event to React Native / Bridge
                val intent = Intent("com.focusloop.SHORTS_DETECTED")
                intent.putExtra("package", YOUTUBE_PACKAGE)
                sendBroadcast(intent)
            }
        } finally {
            rootNode.recycle()
        }
    }

    private fun isShortsActive(node: AccessibilityNodeInfo): Boolean {
        val viewId = node.viewIdResourceName
        if (viewId != null) {
            for (identifier in SHORTS_IDENTIFIERS) {
                if (viewId.contains(identifier, ignoreCase = true)) {
                    return true
                }
            }
        }

        // Recursively inspect children
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val result = isShortsActive(child)
            child.recycle()
            if (result) return true
        }

        return false
    }

    override fun onInterrupt() {
        Log.w(TAG, "FocusLoop YouTube Shorts Service interrupted.")
    }
}
