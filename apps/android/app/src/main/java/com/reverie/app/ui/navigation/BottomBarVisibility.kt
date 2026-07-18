package com.reverie.app.ui.navigation

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.compositionLocalOf

/**
 * Shell-owned flag scrollable tab screens can drive to hide the bottom nav on scroll (true = the
 * bar should be visible). Null when no shell provides it (previews); the shell resets it to visible
 * on every route change. Only honored when the "hide navigation while scrolling" setting is on.
 */
val LocalBottomBarScrollState = compositionLocalOf<MutableState<Boolean>?> { null }
