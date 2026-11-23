package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.kind
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/** What a Browse tab lists, top to bottom: group headers and the runs of documents between them. */
sealed interface FeedItem {
    /** A month or day heading: [title] on the left and a [trailing] count or summary on the right. */
    data class Header(val key: String, val title: String, val trailing: String) : FeedItem

    /** Consecutive photos and videos, laid out as one mosaic. */
    data class Media(val docs: List<DocumentDto>) : FeedItem

    /** Consecutive files of one day, drawn as the rounded list card of the All tab. */
    data class FileCard(val docs: List<DocumentDto>) : FeedItem

    /** One row of the Files tab. */
    data class FileRow(val doc: DocumentDto) : FeedItem

    /** One row of the Videos grid: up to two videos. */
    data class VideoRow(val docs: List<DocumentDto>) : FeedItem
}

private const val VIDEO_COLUMNS = 2
private val dayWithYear = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)
private val dayInYear = DateTimeFormatter.ofPattern("MMM d", Locale.US)

private fun instantOf(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

/**
 * The month a photo or video belongs to. The date taken is a local clock reading stored as if it
 * were UTC, so it is read as written (no zone shift); an upload time is a real instant, read in [zone].
 */
fun monthOf(doc: DocumentDto, zone: ZoneId): YearMonth? {
    instantOf(doc.taken_at)?.let { return YearMonth.from(it.atOffset(ZoneOffset.UTC)) }
    return instantOf(doc.created_at)?.let { YearMonth.from(it.atZone(zone)) }
}

/** The calendar day a document was uploaded, in [zone]. */
fun dayOf(doc: DocumentDto, zone: ZoneId): LocalDate? = instantOf(doc.created_at)?.atZone(zone)?.toLocalDate()

/** "November", or "October 2025" when it isn't this year. */
fun monthLabel(month: YearMonth, today: LocalDate): String {
    val name = month.month.getDisplayName(TextStyle.FULL, Locale.US)
    return if (month.year == today.year) name else "$name ${month.year}"
}

/** "Today", "Yesterday", the weekday for the rest of the past week, then "Nov 14" (with the year when it isn't this year's). */
fun dayLabel(day: LocalDate, today: LocalDate): String {
    val ago = today.toEpochDay() - day.toEpochDay()
    return when {
        ago == 0L -> "Today"
        ago == 1L -> "Yesterday"
        ago in 2..6 -> day.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.US)
        day.year == today.year -> day.format(dayInYear)
        else -> day.format(dayWithYear)
    }
}

private fun count(n: Int, one: String, many: String) = "$n ${if (n == 1) one else many}"

/** "3 photos · 1 video · 3 files": what a day holds, leaving out the kinds it doesn't. */
fun daySummary(docs: List<DocumentDto>): String {
    val kinds = docs.groupingBy { it.kind }.eachCount()
    return listOfNotNull(
        kinds[DocumentKind.IMAGE]?.let { count(it, "photo", "photos") },
        kinds[DocumentKind.VIDEO]?.let { count(it, "video", "videos") },
        kinds[DocumentKind.FILE]?.let { count(it, "file", "files") },
    ).joinToString(" · ")
}

/** What the title's subtitle says: the open tab's server total ("168 photos"), after the folder's description when it has one. */
fun tabSubtitle(tab: BrowseTab, total: Int, description: String?): String {
    val counted = when (tab) {
        BrowseTab.PHOTOS -> count(total, "photo", "photos")
        BrowseTab.VIDEOS -> count(total, "video", "videos")
        BrowseTab.ALL, BrowseTab.FILES -> count(total, "file", "files")
    }
    return if (description.isNullOrBlank()) counted else "$description · $counted"
}

/**
 * Lays [docs] (already in the tab's order) out as feed items. Groups are runs of neighbours, so a
 * page that continues a day or month adds to its last group instead of starting a new one. Counts
 * and summaries are of the documents loaded so far.
 */
fun buildFeed(tab: BrowseTab, docs: List<DocumentDto>, today: LocalDate, zone: ZoneId): List<FeedItem> = when (tab) {
    BrowseTab.PHOTOS -> monthGroups(docs, today, zone, "photo", "photos") { listOf(FeedItem.Media(it)) }
    BrowseTab.VIDEOS -> monthGroups(docs, today, zone, "video", "videos") { group ->
        group.chunked(VIDEO_COLUMNS).map { FeedItem.VideoRow(it) }
    }
    BrowseTab.FILES -> dayGroups(docs, today, zone, summarise = false) { group -> group.map { FeedItem.FileRow(it) } }
    BrowseTab.ALL -> dayGroups(docs, today, zone, summarise = true, ::toAllRuns)
}

private fun monthGroups(
    docs: List<DocumentDto>,
    today: LocalDate,
    zone: ZoneId,
    one: String,
    many: String,
    toItems: (List<DocumentDto>) -> List<FeedItem>,
): List<FeedItem> = docs.groupConsecutive { monthOf(it, zone) }.flatMap { (month, group) ->
    val header = FeedItem.Header(
        key = "month:$month",
        title = month?.let { monthLabel(it, today) } ?: "Undated",
        trailing = count(group.size, one, many),
    )
    listOf(header) + toItems(group)
}

private fun dayGroups(
    docs: List<DocumentDto>,
    today: LocalDate,
    zone: ZoneId,
    summarise: Boolean,
    toItems: (List<DocumentDto>) -> List<FeedItem>,
): List<FeedItem> = docs.groupConsecutive { dayOf(it, zone) }.flatMap { (day, group) ->
    val header = FeedItem.Header(
        key = "day:$day",
        title = day?.let { dayLabel(it, today) } ?: "Undated",
        trailing = if (summarise) daySummary(group) else "",
    )
    listOf(header) + toItems(group)
}

/** Consecutive images and videos become one mosaic run, consecutive files one list card. */
private fun toAllRuns(day: List<DocumentDto>): List<FeedItem> =
    day.groupConsecutive { it.kind == DocumentKind.FILE }.map { (isFiles, run) ->
        if (isFiles) FeedItem.FileCard(run) else FeedItem.Media(run)
    }

/** Splits a list into runs of neighbours that share a key, keeping the order. */
private fun <K> List<DocumentDto>.groupConsecutive(keyOf: (DocumentDto) -> K): List<Pair<K, List<DocumentDto>>> {
    val runs = mutableListOf<Pair<K, MutableList<DocumentDto>>>()
    for (doc in this) {
        val key = keyOf(doc)
        val last = runs.lastOrNull()
        if (last != null && last.first == key) last.second += doc else runs += key to mutableListOf(doc)
    }
    return runs
}
