package com.reverie.app.ui.screens.browse

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProcessingSheetPagingTest {
    private val loaded = PagedIds(ids = setOf("a", "b"), isLoading = false, isLoadingMore = true)

    @Test fun `a page with new ids is added and the list may ask for more`() {
        val next = loaded.afterPage(setOf("c", "d"))
        assertEquals(setOf("a", "b", "c", "d"), next.ids)
        assertFalse(next.isLoadingMore)
        assertFalse(next.isExhausted)
    }

    @Test fun `a failed page stops the list asking again`() {
        val next = loaded.afterPage(null)
        assertEquals(setOf("a", "b"), next.ids)
        assertTrue(next.isExhausted)
    }

    @Test fun `a page that only repeats rows already held stops the list asking again`() {
        assertTrue(loaded.afterPage(setOf("a", "b")).isExhausted)
    }

    @Test fun `an empty first page leaves the sheet loaded and exhausted`() {
        val next = PagedIds().afterPage(emptySet())
        assertFalse(next.isLoading)
        assertTrue(next.isExhausted)
    }

    @Test fun `a stale count with nothing on the server asks for nothing more`() {
        val state = ProcessingSheetState(rows = emptyList(), total = 5, isLoading = false, isExhausted = true)
        assertFalse(state.hasMore)
    }
}
