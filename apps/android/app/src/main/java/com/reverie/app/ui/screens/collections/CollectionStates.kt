package com.reverie.app.ui.screens.collections

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.reverie.app.ui.components.LockedCover

/** A locked collection: one card that asks for the password. Its folders are not sent until then. */
@Composable
fun LockedCollectionCard(accent: Color, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .padding(horizontal = 20.dp)
            .fillMaxWidth()
            .clip(CARD_SHAPE)
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .heightIn(min = ROW_MIN_HEIGHT)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LockedCover(accent)
        Column(Modifier.padding(start = 12.dp)) {
            Text("Locked", style = MaterialTheme.typography.bodyLarge)
            Text(
                "Tap to unlock with your password",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** An empty collection: a dashed button that makes its first folder. */
@Composable
fun AddFolderButton(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val outline = MaterialTheme.colorScheme.outline
    val dash = PathEffect.dashPathEffect(floatArrayOf(14f, 10f))
    Row(
        modifier
            .padding(horizontal = 20.dp)
            .fillMaxWidth()
            .height(56.dp)
            .clip(CARD_SHAPE)
            .clickable(onClick = onClick)
            .drawBehind {
                drawRoundRect(
                    color = outline,
                    cornerRadius = CornerRadius(18.dp.toPx()),
                    style = Stroke(width = 1.5.dp.toPx(), pathEffect = dash),
                )
            },
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Add, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
        Text(
            "Add a folder",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(start = 8.dp),
        )
    }
}
