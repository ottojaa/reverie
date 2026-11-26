package com.reverie.app.ui.components

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.sp

private val SMALLEST_TITLE = 15.sp

/** Contextual app bar shown while something is selected, with what can be done to it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SelectionTopBar(
    count: Int,
    onClose: () -> Unit,
    actions: @Composable RowScope.() -> Unit,
) {
    TopAppBar(
        windowInsets = TopAppBarDefaults.windowInsets,
        title = { CountTitle(count) },
        navigationIcon = {
            IconButton(onClick = onClose) {
                Icon(Icons.Filled.Close, contentDescription = "Clear selection")
            }
        },
        actions = actions,
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
        ),
    )
}

@Composable
fun SelectionAction(label: String, icon: ImageVector, onClick: () -> Unit) {
    IconButton(onClick = onClick) {
        Icon(icon, contentDescription = label)
    }
}

/** "3 selected", shrunk to fit, or the bare count where the words would not fit beside the actions. */
@Composable
private fun CountTitle(count: Int) {
    val style = LocalTextStyle.current
    val measurer = rememberTextMeasurer()
    BoxWithConstraints {
        val words = "$count selected"
        val narrowest = measurer.measure(words, style.copy(fontSize = SMALLEST_TITLE), maxLines = 1).size.width
        Text(
            if (narrowest <= constraints.maxWidth) words else "$count",
            maxLines = 1,
            autoSize = TextAutoSize.StepBased(minFontSize = SMALLEST_TITLE, maxFontSize = MaterialTheme.typography.titleLarge.fontSize),
        )
    }
}
