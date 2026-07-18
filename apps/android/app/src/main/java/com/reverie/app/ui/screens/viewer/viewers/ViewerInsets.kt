package com.reverie.app.ui.screens.viewer.viewers

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Approximate height of the floating [com.reverie.app.ui.screens.document.ViewerToolbar] icon row
 * (48dp button + 4dp vertical padding each side). Non-media viewers (PDF/text/fallback) add this on
 * top of the status-bar inset so their first content isn't hidden beneath the translucent toolbar.
 */
internal val VIEWER_TOOLBAR_INSET: Dp = 56.dp
