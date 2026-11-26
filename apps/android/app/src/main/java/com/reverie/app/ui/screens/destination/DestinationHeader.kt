package com.reverie.app.ui.screens.destination

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The title with "New folder here" and search; while searching, the search field in their place. */
@Composable
internal fun DestinationHeader(
    state: DestinationState,
    onOpen: (folderId: String?) -> Unit,
    onSearch: (query: String?) -> Unit,
    onNewFolder: () -> Unit,
    onCancel: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (state.query != null) {
            HeaderButton(Icons.AutoMirrored.Outlined.ArrowBack, "Close search") { onSearch(null) }
            SearchField(state, onOpen, onSearch, Modifier.weight(1f))
            return@Row
        }
        HeaderButton(Icons.Outlined.Close, "Close", onCancel)
        Text(
            "Select destination",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            // Shrinks rather than cuts off beside the two buttons on a narrow phone.
            autoSize = TextAutoSize.StepBased(minFontSize = 15.sp, maxFontSize = 20.sp),
            modifier = Modifier.weight(1f).padding(start = 4.dp),
        )
        HeaderButton(Icons.Outlined.CreateNewFolder, "New folder here", onNewFolder)
        HeaderButton(Icons.Outlined.Search, "Search folders") { onSearch("") }
    }
}

@Composable
private fun HeaderButton(icon: ImageVector, label: String, onClick: () -> Unit) {
    IconButton(onClick = onClick) { Icon(icon, contentDescription = label) }
}

/** Enter opens the only match, and otherwise just puts the keyboard away. */
@Composable
private fun SearchField(
    state: DestinationState,
    onOpen: (folderId: String?) -> Unit,
    onSearch: (query: String?) -> Unit,
    modifier: Modifier,
) {
    val focus = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    LaunchedEffect(Unit) { focus.requestFocus() }

    TextField(
        value = state.query.orEmpty(),
        onValueChange = onSearch,
        placeholder = { Text("Search folders") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = {
            focusManager.clearFocus()
            state.rows.singleOrNull()?.takeIf { state.isSearching }?.let { onOpen(it.id) }
        }),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Color.Transparent,
            unfocusedContainerColor = Color.Transparent,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
        ),
        modifier = modifier.focusRequester(focus),
    )
}
