package com.reverie.app.ui.screens.manage

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** The ids a screen has selected. Documents and folders share one set: their ids never collide. */
class Selection {
    private val chosen = MutableStateFlow<Set<String>>(emptySet())
    val ids: StateFlow<Set<String>> = chosen.asStateFlow()

    fun toggle(id: String) = toggle(listOf(id))

    /** Unselects [ids] when all of them are selected, otherwise selects them all. */
    fun toggle(ids: Collection<String>) = chosen.update {
        if (it.containsAll(ids)) it - ids.toSet() else it + ids
    }

    fun remove(ids: Collection<String>) = chosen.update { it - ids.toSet() }

    fun clear() {
        chosen.value = emptySet()
    }
}

/** How rows take part in a screen's selection: while anything is selected, a tap selects instead of opening. */
class RowSelection(private val selected: Set<String> = emptySet(), val toggle: (id: String) -> Unit = {}) {
    operator fun contains(id: String): Boolean = id in selected

    fun tap(id: String, open: () -> Unit) {
        if (selected.isEmpty()) return open()
        toggle(id)
    }
}
