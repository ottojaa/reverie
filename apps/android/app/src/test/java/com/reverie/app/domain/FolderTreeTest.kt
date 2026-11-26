package com.reverie.app.domain

import com.reverie.app.data.api.ApiJson
import com.reverie.app.data.api.model.FolderWithChildren
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Test

/** Lookups and folder labels over the server's three level tree. */
class FolderTreeTest {

    private val tree = FolderTree(
        ApiJson.decodeFromString(
            ListSerializer(FolderWithChildren.serializer()),
            checkNotNull(javaClass.classLoader?.getResource("folder-tree.json")) { "Missing fixture" }.readText(),
        ),
    )

    private fun id(number: Int) = "10000000-0000-4000-8000-00000000000$number"

    private fun meta(number: Int) = folderMeta(tree.find(id(number))!!)

    @Test fun `a folder's path runs from the top level down to it`() {
        assertEquals(listOf("Photos", "Trips", "Norway"), tree.pathTo(id(3)).map { it.name })
        assertEquals(emptyList<String>(), tree.pathTo(null).map { it.name })
        assertEquals(emptyList<String>(), tree.pathTo("gone").map { it.name })
    }

    @Test fun `children are listed for a folder and for the top level`() {
        assertEquals(listOf("Photos", "Receipts", "Taxes"), tree.childrenOf(null).map { it.name })
        assertEquals(listOf("Surprise party", "Trips"), tree.childrenOf(id(1)).map { it.name })
    }

    @Test fun `a subtree holds the folder and everything beneath it`() {
        assertEquals(setOf(id(1), id(2), id(3), id(4)), tree.subtreeIds(id(1)))
        assertEquals(setOf("gone"), tree.subtreeIds("gone"))
    }

    @Test fun `a folder is private through any folder above it`() {
        val private = tree.all().filter { it.isInPrivateTree }.map { it.name }.toSet()

        assertEquals(setOf("Surprise party", "Taxes", "Statements"), private)
    }

    @Test fun `meta counts the folders inside and the documents further down`() {
        assertEquals("2 folders · 3 photos · 1 video", meta(1))
        assertEquals("1 folder · 2 photos · 1 video", meta(2))
        assertEquals("2 files", meta(5))
        assertEquals("1 folder · 2 files", meta(6))
        assertEquals("Locked", meta(4))
    }

    @Test fun `a mix with files counts as files, and nothing is empty`() {
        val receipts = tree.find(id(5))!!

        assertEquals("3 files", folderMeta(receipts.copy(kind_counts = receipts.kind_counts.copy(image = 1))))
        assertEquals("Empty", folderMeta(receipts.copy(kind_counts = receipts.kind_counts.copy(file = 0))))
    }
}
