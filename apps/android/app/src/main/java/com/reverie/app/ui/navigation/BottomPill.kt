package com.reverie.app.ui.navigation

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Below this screen width the two buttons close up, so the pill and the search button still fit side by side. */
private const val NARROW_SCREEN_DP = 360

/** Below this width per unit of font scale (large text on a narrow screen) they close up further. */
private const val TIGHT_SCREEN_DP = 300

/**
 * The pill floating over the browsing screens: Library and Photos, with a round search button beside it
 * when [showSearch]. The content under it fades into the background, so the pill never fights a photo.
 */
@Composable
internal fun BottomPill(
    selected: Tab,
    onSelect: (Tab) -> Unit,
    showSearch: Boolean,
    onSearch: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val background = MaterialTheme.colorScheme.background
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(0f to Color.Transparent, 0.8f to background.copy(alpha = 0.9f)))
            .navigationBarsPadding()
            .padding(top = BottomBarFade, bottom = BottomBarMargin),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Weighted so that the search button is measured first and keeps its size.
        PillSurface(Modifier.weight(1f, fill = false)) {
            Row(Modifier.padding(6.dp).selectableGroup(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                val spacing = pillSpacing()
                Tab.entries.forEach { tab -> PillButton(tab, tab == selected, spacing, onClick = { onSelect(tab) }) }
            }
        }
        AnimatedVisibility(
            visible = showSearch,
            enter = fadeIn() + expandHorizontally(),
            exit = fadeOut() + shrinkHorizontally(),
        ) {
            PillSurface(Modifier.padding(start = 10.dp)) {
                Box(
                    Modifier.size(BottomBarHeight).clip(CircleShape).clickable(role = Role.Button, onClick = onSearch),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Outlined.Search, contentDescription = "Search")
                }
            }
        }
    }
}

@Composable
private fun PillSurface(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(
        modifier = modifier,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shadowElevation = 3.dp,
        content = content,
    )
}

/** The room inside a pill button: at its sides, and between its icon and its label. */
private data class PillSpacing(val side: Dp, val gap: Dp)

@Composable
private fun pillSpacing(): PillSpacing {
    val screen = LocalConfiguration.current
    if (screen.screenWidthDp / screen.fontScale < TIGHT_SCREEN_DP) return PillSpacing(side = 8.dp, gap = 6.dp)
    if (screen.screenWidthDp < NARROW_SCREEN_DP) return PillSpacing(side = 14.dp, gap = 10.dp)
    return PillSpacing(side = 22.dp, gap = 10.dp)
}

@Composable
private fun PillButton(tab: Tab, isSelected: Boolean, spacing: PillSpacing, onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    Surface(
        color = if (isSelected) colors.primaryContainer else Color.Transparent,
        contentColor = if (isSelected) colors.onPrimaryContainer else colors.onSurfaceVariant,
        shape = CircleShape,
    ) {
        Row(
            Modifier.selectable(isSelected, role = Role.Tab, onClick = onClick).height(52.dp).padding(horizontal = spacing.side),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(tab.icon, contentDescription = null, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(spacing.gap))
            Text(
                tab.title,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
