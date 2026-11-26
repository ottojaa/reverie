package com.reverie.app.ui.screens.browse

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.ui.components.DocumentCardSkeleton
import com.reverie.app.ui.components.EmptyState
import com.reverie.app.ui.components.rememberSkeletonVisible

/** A brief placeholder while a list's first page loads: a fixed 3-wide square grid, since real tiles need document sizes. */
@Composable
fun LoadingGrid(contentPadding: PaddingValues) {
    val visible = rememberSkeletonVisible(isLoading = true)
    if (!visible) return
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        contentPadding = contentPadding,
        verticalArrangement = Arrangement.spacedBy(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(12) { DocumentCardSkeleton() }
    }
}

/** What a list shows when the server has answered and has nothing. */
@Composable
fun EmptyList(title: String, contentPadding: PaddingValues, onUpload: () -> Unit) {
    Box(Modifier.padding(top = contentPadding.calculateTopPadding()).fillMaxSize()) {
        EmptyState(
            icon = Icons.Outlined.FolderOpen,
            title = title,
            description = "Upload photos and files, or scan one with the camera.",
            actionLabel = "Upload",
            onAction = onUpload,
        )
    }
}

/** True while a list's first page is still on its way: nothing to show yet, and no failure to report. */
fun isFirstLoad(documents: FeedDocuments, error: String?): Boolean =
    documents.documents.isEmpty() && (documents.isLoading || (!documents.fetched && !documents.failed && error == null))
