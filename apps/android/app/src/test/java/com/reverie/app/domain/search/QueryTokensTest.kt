package com.reverie.app.domain.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Ported verbatim from libs/shared/src/search/query-tokens.test.ts. These fixtures are the
 * contract: the Kotlin DSL must produce identical `q` strings to the web/backend so the
 * server re-parses them the same way.
 */
class QueryTokensTest {

    private fun text(value: String, negated: Boolean = false, raw: String = value) =
        QueryToken(TokenType.TEXT, value, negated = negated, raw = raw)

    private fun quoted(value: String, negated: Boolean = false, raw: String) =
        QueryToken(TokenType.QUOTED, value, negated = negated, raw = raw)

    private fun filter(key: String, value: String, negated: Boolean = false, raw: String) =
        QueryToken(TokenType.FILTER, value, key = key, negated = negated, raw = raw)

    // ---- tokenizeQuery ----

    @Test fun `tokenizes free text words`() {
        assertEquals(
            listOf(text("beach"), text("sunset")),
            tokenizeQuery("beach sunset"),
        )
    }

    @Test fun `tokenizes quoted free text`() {
        assertEquals(
            listOf(quoted("beach sunset", raw = "\"beach sunset\"")),
            tokenizeQuery("\"beach sunset\""),
        )
    }

    @Test fun `tokenizes filters and lowercases keys`() {
        assertEquals(
            listOf(filter("type", "photo", raw = "TYPE:photo")),
            tokenizeQuery("TYPE:photo"),
        )
    }

    @Test fun `tokenizes negated filters`() {
        assertEquals(
            listOf(filter("has", "text", negated = true, raw = "-has:text")),
            tokenizeQuery("-has:text"),
        )
    }

    @Test fun `handles quoted filter values with whitespace`() {
        assertEquals(
            listOf(
                filter("entity", "John Smith", raw = "entity:\"John Smith\""),
                text("beach"),
            ),
            tokenizeQuery("entity:\"John Smith\" beach"),
        )
    }

    @Test fun `handles single-word quoted filter values`() {
        assertEquals(
            listOf(filter("folder", "Seppo", raw = "folder:\"Seppo\"")),
            tokenizeQuery("folder:\"Seppo\""),
        )
    }

    @Test fun `consumes unterminated quotes to end of string`() {
        assertEquals(
            listOf(quoted("beach sun", raw = "\"beach sun")),
            tokenizeQuery("\"beach sun"),
        )
        assertEquals(
            listOf(filter("entity", "John Smi", raw = "entity:\"John Smi")),
            tokenizeQuery("entity:\"John Smi"),
        )
    }

    @Test fun `keeps empty filter values`() {
        assertEquals(
            listOf(filter("tag", "", raw = "tag:")),
            tokenizeQuery("tag:"),
        )
    }

    @Test fun `treats a leading colon as text`() {
        assertEquals(
            listOf(text(":value")),
            tokenizeQuery(":value"),
        )
    }

    @Test fun `preserves value case`() {
        assertEquals("Important", tokenizeQuery("tag:Important")[0].value)
    }

    @Test fun `handles date and size values as opaque strings`() {
        assertEquals(
            listOf(
                filter("uploaded", "2024-01..2024-06", raw = "uploaded:2024-01..2024-06"),
                filter("size", ">10MB", raw = "size:>10MB"),
            ),
            tokenizeQuery("uploaded:2024-01..2024-06 size:>10MB"),
        )
    }

    // ---- serializeQuery ----

    @Test fun `round-trips exactly`() {
        val queries = listOf(
            "beach type:photo -has:text",
            "entity:\"John Smith\" tag:tax uploaded:last-week",
            "\"exact phrase\" folder:/vacation/2024",
            "type:photo type:video size:>10MB",
        )
        for (q in queries) {
            assertEquals(q, serializeQuery(tokenizeQuery(q)))
        }
    }

    @Test fun `is stable on a second pass`() {
        val q = "beach   type:photo    entity:\"John Smith\""
        val once = serializeQuery(tokenizeQuery(q))
        assertEquals(once, serializeQuery(tokenizeQuery(once)))
    }

    // ---- isKnownFilter / getFreeText / getFilterTokens ----

    @Test fun `marks unknown keys as free text`() {
        val tokens = tokenizeQuery("beach foo:bar type:photo")
        assertFalse(isKnownFilter(tokens[1]))
        assertEquals("beach foo:bar", getFreeText(tokens))
        assertEquals(listOf("type"), getFilterTokens(tokens).map { it.key })
    }

    @Test fun `excludes bare star from free text`() {
        assertEquals("", getFreeText(tokenizeQuery("* type:photo")))
    }

    @Test fun `filters tokens by key`() {
        val tokens = tokenizeQuery("tag:a tag:b type:photo")
        assertEquals(listOf("a", "b"), getFilterTokens(tokens, FilterKey.TAG).map { it.value })
    }

    // ---- addFilter ----

    @Test fun `appends a filter token`() {
        assertEquals("beach type:photo", addFilter("beach", FilterKey.TYPE, "photo"))
    }

    @Test fun `quotes values with whitespace`() {
        assertEquals("entity:\"John Smith\"", addFilter("", FilterKey.ENTITY, "John Smith"))
    }

    @Test fun `dedupes identical tokens`() {
        assertEquals("type:photo", addFilter("type:photo", FilterKey.TYPE, "photo"))
    }

    @Test fun `adds negated tokens distinctly`() {
        assertEquals("has:text -has:text", addFilter("has:text", FilterKey.HAS, "text", negated = true))
    }

    // ---- removeFilter ----

    @Test fun `removes by key and value at token level`() {
        assertEquals(
            "entity:\"tax office\"",
            removeFilter("tag:tax entity:\"tax office\"", FilterKey.TAG, "tax"),
        )
    }

    @Test fun `does not substring-match across keys`() {
        assertEquals("format:pdf", removeFilter("tag:pdf format:pdf", FilterKey.TAG, "pdf"))
    }

    @Test fun `removes all tokens of a key when value omitted`() {
        assertEquals("beach", removeFilter("tag:a tag:b beach", FilterKey.TAG))
    }

    @Test fun `matches values case-insensitively`() {
        assertEquals("", removeFilter("folder:Seppo", FilterKey.FOLDER, "seppo"))
    }

    // ---- replaceFilter ----

    @Test fun `replaces all tokens of a key with one value`() {
        assertEquals(
            "beach uploaded:last-week",
            replaceFilter("uploaded:2024 beach", FilterKey.UPLOADED, "last-week"),
        )
    }

    // ---- setFreeText ----

    @Test fun `replaces free text and preserves filters`() {
        assertEquals("sunset type:photo", setFreeText("beach type:photo", "sunset"))
    }

    @Test fun `clears free text when empty`() {
        assertEquals("type:photo", setFreeText("beach type:photo", ""))
    }

    @Test fun `lifts filter syntax typed into the text`() {
        assertEquals("beach tag:summer type:photo", setFreeText("type:photo", "beach tag:summer"))
    }

    @Test fun `drops unknown-key pseudo filters with the old text`() {
        assertEquals("beach type:photo", setFreeText("foo:bar type:photo", "beach"))
    }
}
