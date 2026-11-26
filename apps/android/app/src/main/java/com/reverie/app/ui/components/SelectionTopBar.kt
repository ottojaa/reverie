package com.reverie.app.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.DriveFileMove
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable

/** Contextual app bar shown while the grid is in multi-select mode. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SelectionTopBar(
    count: Int,
    onClose: () -> Unit,
    onDownload: () -> Unit,
    onMove: () -> Unit,
    onDelete: () -> Unit,
) {
    TopAppBar(
        windowInsets = TopAppBarDefaults.windowInsets,
        title = { Text("$count selected") },
        navigationIcon = {
            IconButton(onClick = onClose) {
                Icon(Icons.Filled.Close, contentDescription = "Clear selection")
            }
        },
        actions = {
            IconButton(onClick = onDownload) {
                Icon(Icons.Outlined.Download, contentDescription = "Download")
            }
            IconButton(onClick = onMove) {
                Icon(Icons.AutoMirrored.Outlined.DriveFileMove, contentDescription = "Move")
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Outlined.Delete, contentDescription = "Delete")
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
        ),
    )
}
