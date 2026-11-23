package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.TopTypeDto
import com.reverie.app.data.api.model.kind

/**
 * A picture card of the dashboard. [count] and [bytes] are null when the figures aren't known (the
 * server hasn't answered and there is no earlier summary): the card then shows no numbers at all.
 */
data class KindCard(
    val kind: DocumentKind,
    val count: Int?,
    val bytes: Long?,
    val topTypes: List<TopTypeDto> = emptyList(),
)

/**
 * The cards to draw, as rows: Photos alone on a wide row, Videos and Files sharing the next one. A
 * kind with no documents has no card; with no Photos, Videos and Files take the first row, and a
 * lone card fills its row.
 *
 * Without a [summary] (cold start, offline) a card exists for each kind in [cachedKinds], with no
 * figures: counting cached rows would show a partial number as if it were the total.
 */
fun dashboardCards(summary: DocumentSummaryDto?, cachedKinds: Set<DocumentKind>): List<List<KindCard>> {
    val cards = DocumentKind.entries.mapNotNull { kind -> cardOf(kind, summary, cachedKinds) }.associateBy { it.kind }
    val photos = cards[DocumentKind.IMAGE]
    val others = listOfNotNull(cards[DocumentKind.VIDEO], cards[DocumentKind.FILE])
    return listOfNotNull(photos?.let { listOf(it) }, others.takeIf { it.isNotEmpty() })
}

private fun cardOf(kind: DocumentKind, summary: DocumentSummaryDto?, cachedKinds: Set<DocumentKind>): KindCard? {
    if (summary == null) return if (kind in cachedKinds) KindCard(kind, count = null, bytes = null) else null
    val count = summary.countOf(kind)
    if (count == 0) return null
    return KindCard(kind, count, summary.bytesOf(kind), if (kind == DocumentKind.FILE) summary.file.top_types else emptyList())
}

/** The kinds present among [docs]. */
fun kindsOf(docs: List<DocumentDto>): Set<DocumentKind> = docs.mapTo(mutableSetOf()) { it.kind }
