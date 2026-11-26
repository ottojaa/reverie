package com.reverie.app.ui.screens.destination

import com.reverie.app.domain.FolderTree
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** What a destination browser lists and lets be picked, three levels deep. */
class DestinationStateTest {

    /** `Photos > Portugal > Lisbon`, and `Papers > Secret (private) > Inside`. */
    private val tree = FolderTree(
        listOf(
            node("Photos", children = listOf(node("Portugal", "Photos", listOf(node("Lisbon", "Portugal"))))),
            node(
                "Papers",
                children = listOf(
                    node("Secret", "Papers", listOf(node("Inside", "Secret", lockId = "Secret")), isPrivate = true),
                ),
            ),
        ),
    )

    private fun state(rules: DestinationRules = DestinationRules(), at: String? = null, query: String? = null) =
        DestinationState(tree, rules, at, query)

    @Test fun `the top level is the Library`() {
        val shown = state()

        assertEquals(listOf("Photos", "Papers"), shown.rows.map { it.name })
        assertEquals(Destination(null, "Library"), shown.destination)
        assertTrue(shown.canSelect)
    }

    @Test fun `a folder deep down lists its own folders under the whole path`() {
        val shown = state(at = "Portugal")

        assertEquals(listOf("Photos", "Portugal"), shown.path.map { it.name })
        assertEquals(listOf("Lisbon"), shown.rows.map { it.name })
        assertEquals(Destination("Portugal", "Portugal"), shown.destination)
    }

    @Test fun `a folder being moved is not offered, and neither is anything in it`() {
        val rules = DestinationRules(excluded = tree.subtreeIds("Portugal"))

        assertEquals(emptyList<String>(), state(rules, at = "Photos").rows.map { it.name })
        assertEquals(emptyList<String>(), state(rules, query = "lis").rows.map { it.name })
    }

    @Test fun `without private folders, nothing at or beneath a private one is offered`() {
        val rules = DestinationRules(allowPrivate = false)

        assertEquals(emptyList<String>(), state(rules, at = "Papers").rows.map { it.name })
        assertEquals(emptyList<String>(), state(rules, query = "inside").rows.map { it.name })
        assertEquals(listOf("Inside"), state(query = "inside").rows.map { it.name })
    }

    @Test fun `where a folder is required, the Library itself cannot be picked`() {
        val rules = DestinationRules(allowTop = false)

        assertFalse(state(rules).canSelect)
        assertTrue(state(rules, at = "Photos").canSelect)
    }

    @Test fun `search finds folders at any depth and says where each is`() {
        val shown = state(query = " lis ")

        assertEquals(listOf("Lisbon"), shown.rows.map { it.name })
        assertEquals("Library › Photos › Portugal", shown.locationOf(shown.rows.single()))
    }

    @Test fun `an empty search field still lists the current folder`() {
        assertEquals(listOf("Portugal"), state(at = "Photos", query = "").rows.map { it.name })
    }
}
