package com.reverie.app.ui.screens.viewer.insight

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.domain.model.LlmMetadata
import com.reverie.app.ui.components.ExpandableSection

/**
 * Mentions & topics collapsed behind an accordion — the chips are useful but there can be a dozen+,
 * so they no longer dominate the panel. The header previews the counts; expanding reveals the two
 * chip groups. Hidden entirely when there's nothing to show.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun InsightTagsSection(metadata: LlmMetadata?) {
    val mentions = metadata?.entities?.map { it.canonical_name }?.distinct().orEmpty()
    val topics = metadata?.topics.orEmpty()
    if (mentions.isEmpty() && topics.isEmpty()) return

    ExpandableSection(
        title = "Mentions & topics",
        subtitle = countSubtitle(mentions.size, topics.size),
        leadingIcon = Icons.Outlined.Sell,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (mentions.isNotEmpty()) {
                MicroLabel("MENTIONS")
                ChipFlow(mentions, emphasized = true)
            }
            if (topics.isNotEmpty()) {
                MicroLabel("TOPICS")
                ChipFlow(topics, emphasized = false)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChipFlow(items: List<String>, emphasized: Boolean) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // future: onChipClick -> filtered search, matching the web insight panel.
        items.forEach { CompactChip(text = it, emphasized = emphasized) }
    }
}

/** A small, dense label pill — far more compact than a Material AssistChip. */
@Composable
private fun CompactChip(text: String, emphasized: Boolean) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = if (emphasized) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .background(
                color = if (emphasized) MaterialTheme.colorScheme.surfaceContainerHighest else MaterialTheme.colorScheme.surfaceContainerHigh,
                shape = RoundedCornerShape(8.dp),
            )
            .padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

private fun countSubtitle(mentions: Int, topics: Int): String {
    val parts = buildList {
        if (mentions > 0) add("$mentions ${if (mentions == 1) "mention" else "mentions"}")
        if (topics > 0) add("$topics ${if (topics == 1) "topic" else "topics"}")
    }
    return parts.joinToString(" · ")
}
