package com.reverie.app.ui.navigation

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Content height of [ReverieBottomBar] (a Material 3 NavigationBar), excluding the system inset. */
val BottomBarHeight: Dp = 80.dp

/**
 * The bottom space the overlaid navigation bar occupies: its content height plus the system
 * navigation-bar inset it sits above. The bar is drawn as an overlay (out of the layout flow) so
 * navigating never reflows content, which means tab screens must add this to their scroll content
 * padding themselves so nothing hides behind the bar. Full-screen routes (the viewer) ignore it.
 */
@Composable
fun bottomBarInset(): Dp =
    BottomBarHeight + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
