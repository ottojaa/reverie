package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.domain.model.ThumbnailSize
import com.reverie.app.ui.components.DocumentThumbnail
import com.reverie.app.ui.components.EmptyState

/** Rows this close to the end of the list trigger loading the next page. */
private const val LOAD_MORE_THRESHOLD = 5

/**
 * The files being processed right now, newest first, with the stages each still has to go through.
 * Rows leave as their files finish; tapping one opens it in the viewer ([onOpenDocument]).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProcessingSheet(
    onOpenDocument: (DocumentDto) -> Unit,
    onDismiss: () -> Unit,
    viewModel: ProcessingSheetViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.load() }
    LaunchedEffect(Unit) { viewModel.keepRowsLive() }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        ProcessingSheetContent(
            state = state,
            onOpenDocument = { document ->
                viewModel.prepareSequence()
                onOpenDocument(document)
            },
            onLoadMore = viewModel::loadMore,
            modifier = Modifier.fillMaxHeight(0.7f),
        )
    }
}

/** The sheet's body, independent of the sheet chrome and the view model so it can be previewed. */
@Composable
fun ProcessingSheetContent(
    state: ProcessingSheetState,
    onOpenDocument: (DocumentDto) -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = processingTitle(state.total),
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
        )
        when {
            state.isLoading -> LoadingIndicator(Modifier.weight(1f))
            state.rows.isEmpty() && !state.hasMore -> EmptyState(
                icon = Icons.Outlined.CheckCircle,
                title = "All caught up",
                description = "Files you upload show up here until they're ready.",
                modifier = Modifier.weight(1f),
            )
            else -> ProcessingRows(state, onOpenDocument, onLoadMore, Modifier.weight(1f))
        }
    }
}

@Composable
private fun ProcessingRows(
    state: ProcessingSheetState,
    onOpenDocument: (DocumentDto) -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier,
) {
    val listState = rememberLazyListState()
    val nearEnd by remember(state.rows.size) {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            last >= state.rows.size - LOAD_MORE_THRESHOLD
        }
    }
    // Also fires when rows have emptied out while more remain, so the list refills itself.
    LaunchedEffect(nearEnd, state.rows.size, state.hasMore, state.isLoadingMore) {
        if (nearEnd && state.hasMore && !state.isLoadingMore) onLoadMore()
    }

    LazyColumn(
        state = listState,
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(bottom = 16.dp),
    ) {
        // Keyed by id with animated placement, so a finished file's row slides out and the rows
        // below it close the gap instead of the whole list jumping.
        items(state.rows, key = { it.id }) { document ->
            ProcessingRow(document, onClick = { onOpenDocument(document) }, Modifier.animateItem())
        }
        if (state.hasMore) {
            item(key = "loading-more") { LoadingIndicator(Modifier.fillMaxWidth().padding(16.dp)) }
        }
        item(key = "nav-bar-space") { Box(Modifier.navigationBarsPadding()) }
    }
}

@Composable
private fun LoadingIndicator(modifier: Modifier = Modifier) {
    Box(modifier, contentAlignment = Alignment.Center) {
        CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
    }
}

@Composable
private fun ProcessingRow(document: DocumentDto, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val stages = processingStages(document)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        RowThumbnail(document)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = document.original_filename,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            StageLine(stages)
        }
    }
}

@Composable
private fun RowThumbnail(document: DocumentDto) {
    DocumentThumbnail(
        documentId = document.id,
        mimeType = document.mime_type,
        filename = document.original_filename,
        blurhash = document.thumbnail_blurhash,
        hasThumbnail = document.hasRenderedThumbnail,
        modifier = Modifier.size(52.dp).clip(MaterialTheme.shapes.medium),
        size = ThumbnailSize.SM,
    )
}

@Composable
private fun StageLine(stages: List<String>) {
    val text = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.semantics { contentDescription = "Still running: ${stages.joinToString(", ")}" },
    ) {
        CircularProgressIndicator(strokeWidth = 1.5.dp, color = MaterialTheme.colorScheme.primary, modifier = Modifier.size(12.dp))
        Text(
            text = stages.joinToString(" · "),
            style = MaterialTheme.typography.labelMedium,
            color = text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** "12 files processing", "1 file processing", or "No files processing". */
internal fun processingTitle(total: Int): String = when (total) {
    0 -> "No files processing"
    1 -> "1 file processing"
    else -> "$total files processing"
}

/** The stages [document] hasn't finished, by the names people see (never OCR/LLM). */
internal fun processingStages(document: DocumentDto): List<String> = buildList {
    if (!document.thumbnail_status.isTerminal) add("Thumbnail")
    if (!document.ocr_status.isTerminal) add("Text recognition")
    if (!document.llm_status.isTerminal) add("AI summary")
}
