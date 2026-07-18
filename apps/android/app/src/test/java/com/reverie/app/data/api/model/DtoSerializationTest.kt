package com.reverie.app.data.api.model

import com.reverie.app.data.api.ApiJson
import com.reverie.app.domain.model.LlmMetadata
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Round-trips representative backend payloads through the DTO layer. */
class DtoSerializationTest {

    private val json: Json = ApiJson

    @Test fun `decodes a full document with llm and photo metadata`() {
        val payload = """
            {
              "id": "11111111-1111-1111-1111-111111111111",
              "folder_id": null,
              "file_path": "u/1/a.jpg",
              "file_hash": "abc",
              "original_filename": "beach.jpg",
              "mime_type": "image/jpeg",
              "size_bytes": 123456,
              "width": 4000, "height": 3000,
              "thumbnail_blurhash": "L6Pj0^jE",
              "thumbnail_paths": {"sm":"a","md":"b","lg":"c"},
              "document_category": "photo",
              "extracted_date": "2024-06-01",
              "ocr_status": "complete",
              "thumbnail_status": "complete",
              "llm_status": "complete",
              "llm_summary": "A beach at sunset.",
              "llm_metadata": {"type":"vision_describe","title":"Sunset","topics":["beach","sunset"],
                "entities":[{"type":"location","canonical_name":"Malibu","raw_text":"Malibu"}]},
              "llm_processed_at": "2024-06-02T10:00:00.000Z",
              "llm_token_count": 42,
              "is_private": false,
              "created_at": "2024-06-01T09:00:00.000Z",
              "updated_at": "2024-06-01T09:00:00.000Z",
              "file_url": "/files/x?e=1&s=y",
              "thumbnail_urls": {"sm":"/t/sm","md":"/t/md","lg":"/t/lg"},
              "photo_metadata": {"latitude":34.0,"longitude":-118.7,"city":"Malibu","country":"US","taken_at":"2024-06-01"}
            }
        """.trimIndent()

        val doc = json.decodeFromString(DocumentDto.serializer(), payload)
        assertEquals("beach.jpg", doc.original_filename)
        assertEquals(DocumentCategory.PHOTO, doc.document_category)
        assertEquals(JobStatus.COMPLETE, doc.ocr_status)
        assertEquals(34.0, doc.photo_metadata?.latitude!!, 0.0001)

        val meta = LlmMetadata.from(json.parseToJsonElement(payload).jsonObject["llm_metadata"]?.jsonObject)
        assertNotNull(meta)
        assertEquals("Sunset", meta!!.title)
        assertEquals(listOf("beach", "sunset"), meta.topics)
        assertEquals(EntityType.LOCATION, meta.entities.first().type)
    }

    @Test fun `unknown document category falls back to OTHER`() {
        val payload = documentJson(category = "\"quantum_invoice\"")
        val doc = json.decodeFromString(DocumentDto.serializer(), payload)
        assertEquals(DocumentCategory.OTHER, doc.document_category)
    }

    @Test fun `null document category stays null`() {
        val doc = json.decodeFromString(DocumentDto.serializer(), documentJson(category = "null"))
        assertNull(doc.document_category)
    }

    @Test fun `decodes a paginated document list`() {
        val payload = """
            {"items": [${documentJson(category = "\"receipt\"")}], "total": 1, "limit": 20, "offset": 0}
        """.trimIndent()
        val page = json.decodeFromString(
            com.reverie.app.data.api.model.Paginated.serializer(DocumentDto.serializer()),
            payload,
        )
        assertEquals(1, page.total)
        assertEquals(DocumentCategory.RECEIPT, page.items.first().document_category)
    }

    @Test fun `decodes a search response with both hit types`() {
        val payload = """
            {
              "total": 2,
              "results": [
                {"result_type":"document","document_id":"d1","display_name":"Invoice","filename":"i.pdf",
                 "folder_path":"/Finance","folder_id":"f1","uploaded_at":"2024-01-01T00:00:00.000Z",
                 "extracted_date":null,"category":"invoice","mime_type":"application/pdf","format":"pdf",
                 "snippet":"...total...","has_text":true,"thumbnail_urls":null,"blurhash":null,
                 "size_bytes":9000,"tags":["tax"],"relevance":0.8},
                {"result_type":"collection","id":"c1","name":"Finance","path":"/Finance","description":null,
                 "emoji":"💰","folder_type":"collection","document_count":12,"snippet":null,"relevance":0.5}
              ],
              "timing_ms": 12.5
            }
        """.trimIndent()

        val res = json.decodeFromString(SearchResponse.serializer(), payload)
        assertEquals(2, res.total)
        assertTrue(res.results[0] is DocumentSearchResult)
        assertTrue(res.results[1] is CollectionSearchResult)
        assertEquals("Invoice", (res.results[0] as DocumentSearchResult).display_name)
        assertEquals(FolderType.COLLECTION, (res.results[1] as CollectionSearchResult).folder_type)
    }

    @Test fun `decodes a nested folder tree`() {
        val payload = """
            [{"id":"c1","parent_id":null,"name":"Finance","path":"/Finance","description":null,"emoji":"💰",
              "sort_order":0,"type":"collection","is_private":false,
              "created_at":"2024-01-01T00:00:00.000Z","updated_at":"2024-01-01T00:00:00.000Z",
              "document_count":0,
              "children":[{"id":"f1","parent_id":"c1","name":"Receipts","path":"/Finance/Receipts",
                "description":null,"emoji":null,"sort_order":0,"type":"folder","is_private":true,
                "created_at":"2024-01-01T00:00:00.000Z","updated_at":"2024-01-01T00:00:00.000Z",
                "document_count":5,"children":[]}]}]
        """.trimIndent()

        val tree = json.decodeFromString(ListSerializer(FolderWithChildren.serializer()), payload)
        assertEquals("Finance", tree.first().name)
        assertEquals("Receipts", tree.first().children.first().name)
        assertTrue(tree.first().children.first().is_private)
    }

    @Test fun `decodes a login response`() {
        val payload = """
            {"user":{"id":"u1","email":"a@b.com","display_name":"A","storage_quota_bytes":1000,
              "storage_used_bytes":100,"is_active":true,"role":"admin","created_at":"2024-01-01T00:00:00.000Z",
              "last_login_at":null},"access_token":"tok","expires_in":900}
        """.trimIndent()
        val login = json.decodeFromString(LoginResponse.serializer(), payload)
        assertEquals(UserRole.ADMIN, login.user.role)
        assertEquals(900L, login.expires_in)
    }

    @Test fun `decodes a job event`() {
        val payload = """
            {"type":"job:progress","job_id":"j1","document_id":"d1","session_id":"s1",
             "status":"processing","progress":45,"timestamp":"2024-01-01T00:00:00.000Z"}
        """.trimIndent()
        val ev = json.decodeFromString(JobEventDto.serializer(), payload)
        assertEquals(JobEventType.PROGRESS, ev.type)
        assertEquals(45.0, ev.progress!!, 0.0001)
    }

    private fun documentJson(category: String): String = """
        {
          "id":"d1","folder_id":null,"file_path":"p","file_hash":"h","original_filename":"f",
          "mime_type":"application/pdf","size_bytes":1,"width":null,"height":null,
          "thumbnail_blurhash":null,"thumbnail_paths":null,"document_category":$category,
          "extracted_date":null,"ocr_status":"pending","thumbnail_status":"pending","llm_status":"pending",
          "llm_summary":null,"llm_metadata":null,"llm_processed_at":null,"llm_token_count":null,
          "is_private":false,"created_at":"2024-01-01T00:00:00.000Z","updated_at":"2024-01-01T00:00:00.000Z",
          "file_url":null,"thumbnail_urls":null
        }
    """.trimIndent()
}
