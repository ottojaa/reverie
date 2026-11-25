package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.kind
import com.reverie.app.ui.components.fileTypeLabel
import com.reverie.app.util.formatBytes
import com.reverie.app.util.formatDuration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** What a feed screen lists, top to bottom: day headers and the documents under each. */
sealed interface FeedItem {
    /** A day heading: just its [title], since a count of the rows loaded so far would grow as the list does. */
    data class Header(val key: String, val title: String) : FeedItem

    /** One day's photos and videos, laid out as one grid. */
    data class Media(val docs: List<DocumentDto>) : FeedItem

    /** One document as a row. */
    data class FileRow(val doc: DocumentDto) : FeedItem
}

private val headerDay = DateTimeFormatter.ofPattern("EEE d MMM", Locale.US)
private val headerDayWithYear = DateTimeFormatter.ofPattern("EEE d MMM yyyy", Locale.US)
private val rowDay = DateTimeFormatter.ofPattern("d MMM", Locale.US)
private val rowDayWithYear = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.US)

private fun instantOf(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

/**
 * The day a photo or video belongs to. The date taken is a local clock reading stored as if it were
 * UTC, so it is read as written (no zone shift); without one it is the day of the upload, in [zone].
 */
fun dayTakenOf(doc: DocumentDto, zone: ZoneId): LocalDate? =
    instantOf(doc.taken_at)?.atOffset(ZoneOffset.UTC)?.toLocalDate() ?: dayAddedOf(doc, zone)

/** The day a document was uploaded; an upload time is a real instant, read in [zone]. */
fun dayAddedOf(doc: DocumentDto, zone: ZoneId): LocalDate? = instantOf(doc.created_at)?.atZone(zone)?.toLocalDate()

/** "Today", "Yesterday", then "Thu 6 Nov" (with the year when it isn't this year's). */
fun dayLabel(day: LocalDate, today: LocalDate): String {
    val ago = today.toEpochDay() - day.toEpochDay()
    return when {
        ago == 0L -> "Today"
        ago == 1L -> "Yesterday"
        day.year == today.year -> day.format(headerDay)
        else -> day.format(headerDayWithYear)
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
    // The date taken is a local clock reading stored as UTC (see dayTakenOf), so it is read as written.
    val taken = if (sortsByTaken) instantOf(doc.taken_at)?.atOffset(ZoneOffset.UTC)?.toLocalDate() else null
    val day = taken ?: instantOf(doc.created_at)?.atZone(zone)?.toLocalDate()
    return listOfNotNull(
        fileTypeLabel(doc.mime_type, doc.original_filename),
        doc.duration_seconds?.takeIf { doc.kind == DocumentKind.VIDEO }?.let(::formatDuration),
        formatBytes(doc.size_bytes),
        day?.format(if (day.year == today.year) rowDay else rowDayWithYear),
    ).joinToString(" · ")
}

/**
 * [docs] (in the order of a list of [filter]) grouped under the day that list files them: photos and videos by
 * the day taken, any other list by the day of the upload. Newest day first, each day in the order it came, and
 * documents with no readable date last.
 *
 * Grouped by day rather than by runs of neighbours, so no day can appear twice: a list ordered by instants can
 * interleave two calendar days around midnight.
 */
fun byDay(filter: DocumentFilter, docs: List<DocumentDto>, zone: ZoneId): List<Pair<LocalDate?, List<DocumentDto>>> =
    docs.groupBy { if (filter.isByDateTaken) dayTakenOf(it, zone) else dayAddedOf(it, zone) }
        .toList()
        .sortedWith(compareByDescending(nullsFirst<LocalDate>()) { it.first })

/** [byDay] as list items: a heading per day, over one grid of its photos and videos or over its rows. */
fun buildFeed(filter: DocumentFilter, docs: List<DocumentDto>, today: LocalDate, zone: ZoneId): List<FeedItem> =
    byDay(filter, docs, zone).flatMap { (day, group) ->
        val title = day?.let { dayLabel(it, today) } ?: "Undated"
        val held = if (filter.isByDateTaken) listOf(FeedItem.Media(group)) else group.map { FeedItem.FileRow(it) }
        listOf(FeedItem.Header(key = "day:$day", title = title)) + held
    }
