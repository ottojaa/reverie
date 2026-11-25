package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.kind
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.util.formatBytes
import com.reverie.app.util.formatDuration
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/** What a kind screen lists, top to bottom: group headers and the runs of documents between them. */
sealed interface FeedItem {
    /** A month or day heading: just its [title], since a count of the rows loaded so far would grow as the list does. */
    data class Header(val key: String, val title: String) : FeedItem

    /** Consecutive photos and videos, laid out as one mosaic. */
    data class Media(val docs: List<DocumentDto>) : FeedItem

    /** One row of the Files screen. */
    data class FileRow(val doc: DocumentDto) : FeedItem

    /** One row of the Videos grid: up to two videos. */
    data class VideoRow(val docs: List<DocumentDto>) : FeedItem
}

private const val VIDEO_COLUMNS = 2
private val dayWithYear = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)
private val dayInYear = DateTimeFormatter.ofPattern("MMM d", Locale.US)
private val rowDay = DateTimeFormatter.ofPattern("d MMM", Locale.US)
private val rowDayWithYear = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.US)

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

/** The dashboard's subtitle: the library's server total ("248 files"). */
fun dashboardSubtitle(total: Int): String = count(total, "file", "files")

/**
 * A folder page's subtitle: its description, then how many files it holds ("31 files"), or under a kind chip
 * how many of them that chip lists ("4 of 31 files").
 *
 * @param total null while unknown, which leaves only the description.
 * @param matching the selected chip's count; null under All.
 */
fun folderPageSubtitle(total: Int?, matching: Int?, description: String?): String {
    if (total == null) return description.orEmpty()
    val held = count(total, "file", "files")
    val counted = if (matching == null) held else "$matching of $held"
    return if (description.isNullOrBlank()) counted else "$description · $counted"
}

/**
 * A folder list row's second line: "JPG · 3.4 MB · 21 Jun", with a video's length after its type. The date is
 * the one the list of [listed] (null is All) is sorted by: date taken for Photos and Videos when the file has
 * one, else the upload date. It carries its year when that isn't this year.
 */
fun folderRowMeta(doc: DocumentDto, listed: DocumentKind?, today: LocalDate, zone: ZoneId): String {
    val sortsByTaken = listed == DocumentKind.IMAGE || listed == DocumentKind.VIDEO
    // The date taken is a local clock reading stored as UTC (see monthOf), so it is read as written.
    val taken = if (sortsByTaken) instantOf(doc.taken_at)?.atOffset(ZoneOffset.UTC)?.toLocalDate() else null
    val day = taken ?: instantOf(doc.created_at)?.atZone(zone)?.toLocalDate()
    return listOfNotNull(
        fileTypeLabel(doc.mime_type, doc.original_filename),
        doc.duration_seconds?.takeIf { doc.kind == DocumentKind.VIDEO }?.let(::formatDuration),
        formatBytes(doc.size_bytes),
        day?.format(if (day.year == today.year) rowDay else rowDayWithYear),
    ).joinToString(" · ")
}

/** A kind screen's title. */
fun kindTitle(kind: DocumentKind): String = when (kind) {
    DocumentKind.IMAGE -> "Photos"
    DocumentKind.VIDEO -> "Videos"
    DocumentKind.FILE -> "Files"
}

/** A kind screen's subtitle: "38 photos · My Files". */
fun kindSubtitle(kind: DocumentKind, total: Int): String {
    val counted = when (kind) {
        DocumentKind.IMAGE -> count(total, "photo", "photos")
        DocumentKind.VIDEO -> count(total, "video", "videos")
        DocumentKind.FILE -> count(total, "file", "files")
    }
    return "$counted · My Files"
}

/**
 * Lays [docs] (already in the kind's order) out as feed items. Groups are runs of neighbours, so a
 * page that continues a day or month adds to its last group instead of starting a new one.
 */
fun buildFeed(kind: DocumentKind, docs: List<DocumentDto>, today: LocalDate, zone: ZoneId): List<FeedItem> = when (kind) {
    DocumentKind.IMAGE -> monthGroups(docs, today, zone) { listOf(FeedItem.Media(it)) }
    DocumentKind.VIDEO -> monthGroups(docs, today, zone) { group ->
        group.chunked(VIDEO_COLUMNS).map { FeedItem.VideoRow(it) }
    }
    DocumentKind.FILE -> dayGroups(docs, today, zone) { group -> group.map { FeedItem.FileRow(it) } }
}

private fun monthGroups(
    docs: List<DocumentDto>,
    today: LocalDate,
    zone: ZoneId,
    toItems: (List<DocumentDto>) -> List<FeedItem>,
): List<FeedItem> = docs.groupConsecutive { monthOf(it, zone) }.flatMap { (month, group) ->
    val header = FeedItem.Header(
        key = "month:$month",
        title = month?.let { monthLabel(it, today) } ?: "Undated",
    )
    listOf(header) + toItems(group)
}

private fun dayGroups(
    docs: List<DocumentDto>,
    today: LocalDate,
    zone: ZoneId,
    toItems: (List<DocumentDto>) -> List<FeedItem>,
): List<FeedItem> = docs.groupConsecutive { dayOf(it, zone) }.flatMap { (day, group) ->
    val header = FeedItem.Header(
        key = "day:$day",
        title = day?.let { dayLabel(it, today) } ?: "Undated",
    )
    listOf(header) + toItems(group)
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
