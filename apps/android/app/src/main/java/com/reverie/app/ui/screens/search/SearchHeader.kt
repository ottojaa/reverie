package com.reverie.app.ui.screens.search

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Sort
import androidx.compose.material.icons.outlined.ViewList
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.reverie.app.data.api.model.SortBy
import com.reverie.app.data.api.model.SortOrder
import com.reverie.app.domain.search.FilterKey
import com.reverie.app.ui.components.FilterPillBar

/** Back and the search field, the scope and filter pills, and with a query the result count and its order. */
@Composable
internal fun SearchHeader(state: SearchUiState, actions: SearchActions, modifier: Modifier = Modifier) {
    Column(modifier) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 16.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = actions.onBack) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Close search")
            }
            SearchField(state.freeText, state.placeholder, actions, Modifier.weight(1f).padding(start = 4.dp))
        }
        FilterPillBar(
            typeValues = state.activeValues(FilterKey.TYPE),
            dateActive = state.isDateActive,
            moreValues = state.moreValues,
            isMoreActive = state.isMoreActive,
            hasAnyActive = state.hasFilters,
            onOpenType = { actions.onOpenSheet(SearchSheet.Facet(FilterKey.TYPE)) },
            onOpenDate = { actions.onOpenSheet(SearchSheet.Date) },
            onOpenMore = { actions.onOpenSheet(SearchSheet.More) },
            onClearAll = actions.onClearFilters,
            modifier = Modifier.padding(vertical = 4.dp),
            leading = state.scopeLabel?.let { label -> { ScopeChip(label, actions.onRemoveScope) } },
        )
        if (state.hasQuery) MetaRow(state, actions)
    }
}

@Composable
private fun SearchField(value: String, placeholder: String, actions: SearchActions, modifier: Modifier = Modifier) {
    val focus = LocalFocusManager.current
    TextField(
        value = value,
        onValueChange = actions.onType,
        placeholder = { Text(placeholder, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { actions.onSubmit(); focus.clearFocus() }),
        trailingIcon = {
            if (value.isNotEmpty()) {
                IconButton(onClick = { actions.onType("") }) { Icon(Icons.Outlined.Clear, contentDescription = "Clear") }
            }
        },
        shape = CircleShape,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
        ),
        modifier = modifier,
    )
}

/** What the search is narrowed to; tapping it searches the whole library. */
@Composable
private fun ScopeChip(label: String, onRemove: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    FilterChip(
        selected = true,
        shape = CircleShape,
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = colors.primaryContainer,
            selectedLabelColor = colors.onPrimaryContainer,
            selectedTrailingIconColor = colors.onPrimaryContainer,
        ),
        onClick = onRemove,
        label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        trailingIcon = {
            Icon(
                Icons.Outlined.Clear,
                contentDescription = "Search the whole library instead",
                modifier = Modifier.size(18.dp),
            )
        },
        modifier = Modifier.widthIn(max = 240.dp),
    )
}

@Composable
private fun MetaRow(state: SearchUiState, actions: SearchActions) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "${state.total} ${if (state.total == 1) "result" else "results"}",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
        )
        SortButton(state.sortBy, state.sortOrder, actions.onSort)
        val isGrid = state.viewMode == ViewMode.GRID
        IconButton(onClick = { actions.onViewMode(if (isGrid) ViewMode.LIST else ViewMode.GRID) }) {
            Icon(if (isGrid) Icons.Outlined.ViewList else Icons.Outlined.GridView, contentDescription = "Toggle view")
        }
    }
}

@Composable
private fun SortButton(sortBy: SortBy, sortOrder: SortOrder, onSort: (SortBy) -> Unit) {
    var isOpen by remember { mutableStateOf(false) }
    val arrow = if (sortOrder == SortOrder.DESC) "  ↓" else "  ↑"
    Box {
        TextButton(onClick = { isOpen = true }) {
            Icon(Icons.Outlined.Sort, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("  ${sortLabel(sortBy)}")
        }
        DropdownMenu(expanded = isOpen, onDismissRequest = { isOpen = false }) {
            listOf(SortBy.RELEVANCE, SortBy.UPLOADED, SortBy.DATE, SortBy.FILENAME, SortBy.SIZE).forEach { option ->
                DropdownMenuItem(
                    text = { Text(sortLabel(option) + if (option == sortBy) arrow else "") },
                    onClick = { isOpen = false; onSort(option) },
                )
            }
        }
    }
}

private fun sortLabel(sortBy: SortBy): String = when (sortBy) {
    SortBy.RELEVANCE -> "Relevance"
    SortBy.UPLOADED -> "Uploaded"
    SortBy.DATE -> "Date"
    SortBy.FILENAME -> "Name"
    SortBy.SIZE -> "Size"
}
