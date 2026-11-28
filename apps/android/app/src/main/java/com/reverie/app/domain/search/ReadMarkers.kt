package com.reverie.app.domain.search

/**
 * Filters read from a typed sentence. The server adds an ordinary filter token and a marker saying which
 * words it came from (`type:receipt read:"type:receipt kuitit"`). The words stay in the query as free
 * text; the marker is what keeps them out of the searched text, and what lets a client tell the filter
 * apart from a picked one. Kotlin port of libs/shared/src/search/read-markers.ts.
 */

data class ReadMarker(
    /** The only filters read from words are TYPE and DATE. */
    val key: FilterKey,
    /** The filter value read from the words. */
    val value: String,
    val words: List<String>,
)

private val MARKER_VALUE = Regex("^(type|date):(\\S+)\\s+(\\S.*)$", RegexOption.DOT_MATCHES_ALL)

private val WORD_BREAK = Regex("\\s+")

/** The marker a token holds; null for every other token, a `read:` of another shape included (that is plain text). */
fun toReadMarker(token: QueryToken): ReadMarker? {
    if (token.type != TokenType.FILTER || token.key != "read" || token.negated) return null

    val (key, value, words) = MARKER_VALUE.find(token.value)?.destructured ?: return null
    val filterKey = FilterKey.fromKey(key) ?: return null

    return ReadMarker(filterKey, value, words.trim().split(WORD_BREAK))
}

/** A word typed as it is, neither quoted, negated nor a filter. */
private fun isPlainWord(token: QueryToken): Boolean = token.type == TokenType.TEXT && !token.negated

/** Whether `words` appear in a row as plain words, ignoring case; filters between them don't break the row. */
private fun hasWordRun(tokens: List<QueryToken>, words: List<String>): Boolean =
    tokens
        .filter { it.type != TokenType.FILTER }
        .windowed(words.size)
        .any { run ->
            run.zip(words).all { (token, word) -> isPlainWord(token) && token.value.lowercase() == word.lowercase() }
        }

/** Whether `token` is the filter the marker added, still holding the value it read. */
private fun isReadFilter(token: QueryToken, marker: ReadMarker): Boolean =
    token.type == TokenType.FILTER &&
        !token.negated &&
        token.key == marker.key.key &&
        token.value.lowercase() == marker.value.lowercase()

/** The keys whose one filter still holds the value read from the user's words. */
fun getReadKeys(tokens: List<QueryToken>): Set<FilterKey> =
    tokens
        .mapNotNull { toReadMarker(it) }
        .filter { marker ->
            val only = getFilterTokens(tokens, marker.key).singleOrNull()

            only != null && isReadFilter(only, marker)
        }
        .map { it.key }
        .toSet()

/**
 * `tokens` without the markers whose words are no longer in `text`, and without the filters still holding
 * what those words said. A filter whose value was changed since stays.
 */
internal fun dropDeletedReads(tokens: List<QueryToken>, text: List<QueryToken>): List<QueryToken> {
    val deleted = tokens.mapNotNull { token ->
        toReadMarker(token)?.takeUnless { hasWordRun(text, it.words) }?.let { token to it }
    }

    return tokens.filterNot { token ->
        deleted.any { (markerToken, marker) -> token === markerToken || isReadFilter(token, marker) }
    }
}
