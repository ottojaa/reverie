package com.reverie.app.domain.search

/**
 * Token-level parser/serializer for the search query DSL.
 *
 * A faithful Kotlin port of libs/shared/src/search/query-tokens.ts — it MUST stay
 * byte-for-byte compatible with the backend/web grammar, since the server re-parses the
 * `q` string this produces. Semantic interpretation (date ranges, size math,
 * type→category expansion) stays backend-side; this layer only deals in tokens.
 *
 * Grammar:
 * - Tokens are whitespace-separated.
 * - A leading `-` negates the token (`-has:text`, `-type:photo`).
 * - `"..."` is quoted free text; an unterminated quote consumes to end-of-string.
 * - `key:value` is a filter; the key is lowercased. Values may be quoted to contain
 *   whitespace (`entity:"John Smith"`).
 * - Unknown filter keys are treated as free text by the backend, so they round-trip as
 *   filter tokens here but count as free text in [getFreeText].
 * - Repeated tokens express multiple values (no comma lists). Semantics (backend-defined):
 *   repeated `category`/`type`/`format` are OR, repeated `tag` are AND.
 * - Date and size values are opaque strings here (`uploaded:2024-01..2024-06`, `size:>10MB`).
 * - A bare `*` means match-all and is excluded from free text.
 */

enum class FilterKey(val key: String) {
    IN("in"),
    TYPE("type"),
    FORMAT("format"),
    CATEGORY("category"),
    UPLOADED("uploaded"),
    DATE("date"),
    FOLDER("folder"),
    HAS("has"),
    SIZE("size"),
    TAG("tag"),
    ENTITY("entity"),
    COMPANY("company"),
    LOCATION("location");

    companion object {
        private val byKey = entries.associateBy { it.key }
        fun fromKey(key: String?): FilterKey? = byKey[key]
    }
}

/** The set of filter keys the backend understands. */
val FILTER_KEYS: List<String> = FilterKey.entries.map { it.key }

enum class TokenType { TEXT, QUOTED, FILTER }

data class QueryToken(
    val type: TokenType,
    /** Unquoted value ('' for an empty filter value like `tag:`). */
    val value: String,
    /** Lowercased filter key; present only when type == FILTER. */
    val key: String? = null,
    val negated: Boolean = false,
    /** Exact source slice (including `-` prefix and quotes) — enables lossless removal. */
    val raw: String = "",
)

private val WHITESPACE = Regex("\\s")

private fun isWhitespace(char: Char?): Boolean = char != null && WHITESPACE.matches(char.toString())

/** Tokenize a query string. Mirrors the backend tokenizer exactly. */
fun tokenizeQuery(query: String): List<QueryToken> {
    val tokens = mutableListOf<QueryToken>()
    val chars = query.toCharArray()
    var i = 0

    // Clamp like JS `Array.slice`: the quoted-token branch can advance `i` one past the end.
    fun slice(from: Int, to: Int): String {
        val end = to.coerceAtMost(chars.size)
        return String(chars, from, (end - from).coerceAtLeast(0))
    }

    while (i < chars.size) {
        while (isWhitespace(chars.getOrNull(i))) i++

        if (i >= chars.size) break

        val start = i
        val negated = chars.getOrNull(i) == '-'

        if (negated) i++

        // Quoted free text: "beach sunset"
        if (chars.getOrNull(i) == '"') {
            i++
            val sb = StringBuilder()

            while (i < chars.size && chars[i] != '"') {
                sb.append(chars[i])
                i++
            }

            i++ // Skip closing quote (no-op at end-of-string)
            tokens.add(QueryToken(TokenType.QUOTED, sb.toString(), negated = negated, raw = slice(start, i)))
            continue
        }

        val word = StringBuilder()

        while (i < chars.size && !isWhitespace(chars.getOrNull(i))) {
            word.append(chars[i])
            i++
        }

        val wordStr = word.toString()
        val colonIndex = wordStr.indexOf(':')

        if (colonIndex <= 0) {
            tokens.add(QueryToken(TokenType.TEXT, wordStr, negated = negated, raw = slice(start, i)))
            continue
        }

        val key = wordStr.substring(0, colonIndex).lowercase()
        var value = wordStr.substring(colonIndex + 1)

        if (value.startsWith("\"") && !value.endsWith("\"")) {
            // Multi-word quoted value: entity:"John Smith" — consume until closing quote
            val vb = StringBuilder(value.substring(1))

            while (i < chars.size && chars.getOrNull(i - 1) != '"') {
                val current = chars.getOrNull(i) ?: ' '

                if (isWhitespace(current)) {
                    vb.append(current)
                    i++
                    continue
                }

                while (i < chars.size && !isWhitespace(chars.getOrNull(i)) && chars[i] != '"') {
                    vb.append(chars[i])
                    i++
                }

                if (chars.getOrNull(i) == '"') {
                    i++
                    break
                }
            }
            value = vb.toString()
        } else if (value.startsWith("\"") && value.endsWith("\"")) {
            value = value.substring(1, value.length - 1)
        }

        tokens.add(QueryToken(TokenType.FILTER, value, key = key, negated = negated, raw = slice(start, i)))
    }

    return tokens
}

private fun toCanonicalRaw(token: QueryToken): String {
    val prefix = if (token.negated) "-" else ""

    return when (token.type) {
        TokenType.QUOTED -> "$prefix\"${token.value}\""
        TokenType.FILTER -> {
            val value = if (WHITESPACE.containsMatchIn(token.value)) "\"${token.value}\"" else token.value
            "$prefix${token.key}:$value"
        }
        TokenType.TEXT -> "$prefix${token.value}"
    }
}

/** Serialize tokens back to a query string, preserving original spelling via `raw`. */
fun serializeQuery(tokens: List<QueryToken>): String =
    tokens
        .map { if (it.raw.isNotEmpty()) it.raw else toCanonicalRaw(it) }
        .filter { it.isNotEmpty() }
        .joinToString(" ")

/** Whether a filter token uses a key the backend understands. */
fun isKnownFilter(token: QueryToken): Boolean =
    token.type == TokenType.FILTER && FILTER_KEYS.contains(token.key ?: "")

private fun isFreeTextToken(token: QueryToken): Boolean {
    if (token.type == TokenType.FILTER) return !isKnownFilter(token)

    return !(token.type == TokenType.TEXT && token.value == "*")
}

/** The free-text portion of the query (text, quoted, and unknown-key tokens). */
fun getFreeText(tokens: List<QueryToken>): String =
    serializeQuery(tokens.filter { isFreeTextToken(it) })

/** Filter tokens with known keys, optionally restricted to one key. */
fun getFilterTokens(tokens: List<QueryToken>, key: FilterKey? = null): List<QueryToken> {
    val known = tokens.filter { isKnownFilter(it) }

    if (key == null) return known

    return known.filter { it.key == key.key }
}

private fun buildFilterToken(key: FilterKey, value: String, negated: Boolean): QueryToken {
    val token = QueryToken(TokenType.FILTER, value, key = key.key, negated = negated)

    return token.copy(raw = toCanonicalRaw(token))
}

private fun matchesFilter(token: QueryToken, key: FilterKey, value: String? = null): Boolean {
    if (token.type != TokenType.FILTER || token.key != key.key) return false

    if (value == null) return true

    return token.value.lowercase() == value.lowercase()
}

/** Append a filter token (no-op if an identical token already exists). */
fun addFilter(q: String, key: FilterKey, value: String, negated: Boolean = false): String {
    val tokens = tokenizeQuery(q)
    val exists = tokens.any { matchesFilter(it, key, value) && it.negated == negated }

    if (exists) return q

    return serializeQuery(tokens + buildFilterToken(key, value, negated))
}

/** Remove filter tokens by key (all of them) or by key + value. Token-level, never substring. */
fun removeFilter(q: String, key: FilterKey, value: String? = null): String {
    val tokens = tokenizeQuery(q)

    return serializeQuery(tokens.filterNot { matchesFilter(it, key, value) })
}

/** Replace all tokens of a key with a single new value (used for dates/sizes). */
fun replaceFilter(q: String, key: FilterKey, value: String, negated: Boolean = false): String {
    val tokens = tokenizeQuery(q).filterNot { matchesFilter(it, key) }

    return serializeQuery(tokens + buildFilterToken(key, value, negated))
}

/**
 * Replace the free-text portion, preserving known filter tokens.
 * Filter syntax typed into `text` is lifted into real filter tokens.
 */
fun setFreeText(q: String, text: String): String {
    val filters = tokenizeQuery(q).filter { isKnownFilter(it) }

    return serializeQuery(tokenizeQuery(text) + filters)
}
