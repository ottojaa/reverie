package com.reverie.app.ui.navigation

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Height of the bottom pill and of the round button beside it. */
val BottomBarHeight: Dp = 64.dp

/** Gap between the pill and the system navigation bar. */
internal val BottomBarMargin: Dp = 8.dp

/** How far above the pill the content starts to fade. */
internal val BottomBarFade: Dp = 24.dp

/** The height of the system navigation bar, for screens the pill is not over. */
@Composable
fun navigationBarInset(): Dp = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

/**
 * The bottom space the pill occupies, above the system navigation bar it sits over. The pill is drawn as
 * an overlay (out of the layout flow) so navigating never reflows content, which means the screens it
 * floats over must add this to their scroll content padding so nothing ends up stuck behind it.
 */
@Composable
fun bottomBarInset(): Dp = BottomBarHeight + BottomBarMargin + navigationBarInset()
