package com.reverie.app.data.local

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.FolderType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.JobStatus
import com.reverie.app.data.local.entity.FolderEntity
import com.reverie.app.data.repository.toPublicFolderIds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class PrivateDocumentGateTest {

    private fun doc(id: String, isPrivate: Boolean) = DocumentDto(
        id = id, file_path = "/$id", file_hash = id, original_filename = "$id.jpg", mime_type = "image/jpeg",
        size_bytes = 1, ocr_status = JobStatus.COMPLETE, thumbnail_status = JobStatus.COMPLETE,
        llm_status = JobStatus.COMPLETE, is_private = isPrivate,
        created_at = "2024-01-01T00:00:00Z", updated_at = "2024-01-01T00:00:00Z",
    )

    private fun folder(id: String, parent: String? = null, isPrivate: Boolean = false) = FolderEntity(
        id = id, parentId = parent, name = id, path = "/$id", description = null, emoji = null, sortOrder = 0,
        type = if (parent == null) "collection" else "folder", isPrivate = isPrivate, locked = false,
        documentCount = 0, createdAt = "2024-01-01T00:00:00Z", updatedAt = "2024-01-01T00:00:00Z", cachedAt = 0,
    )

    @Test fun `a private document never becomes a Room row`() {
        assertNull(doc("p", isPrivate = true).toEntityOrNull(now = 1))
        assertNotNull(doc("a", isPrivate = false).toEntityOrNull(now = 1))
    }

    @Test fun `only public documents of a page are cacheable`() {
        val page = listOf(doc("a", false), doc("p1", true), doc("b", false), doc("p2", true))

        assertEquals(listOf("a", "b"), page.toCacheableEntities(now = 1).map { it.id })
    }

    @Test fun `the document read back from Room is never private`() {
        val entity = doc("a", false).toEntityOrNull(now = 1)!!
        assertEquals(false, entity.toDto().is_private)
    }

    @Test fun `a folder is public unless it, or its parent, is private`() {
        val rows = listOf(
            folder("openCollection"),
            folder("openFolder", parent = "openCollection"),
            folder("secretFolder", parent = "openCollection", isPrivate = true),
            folder("secretCollection", isPrivate = true),
            folder("insideSecret", parent = "secretCollection"),
        )

        assertEquals(listOf("openCollection", "openFolder"), rows.toPublicFolderIds())
    }

    @Test fun `folder rows keep the lock flags the tree needs`() {
        val node = FolderWithChildren(
            id = "f", parent_id = null, name = "f", path = "/f", description = null, emoji = null, sort_order = 0,
            type = FolderType.COLLECTION, is_private = true, locked = true, document_count = 0,
            created_at = "2024-01-01T00:00:00Z", updated_at = "2024-01-01T00:00:00Z", children = emptyList(),
        )

        val row = listOf(node).flattenToEntities(now = 1).single()

        assertEquals(true, row.isPrivate)
        assertEquals(true, row.locked)
    }
}
