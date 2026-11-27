package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentFilter
import com.reverie.app.data.api.model.MediaDatesDto
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
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
private val dayAndMonth = DateTimeFormatter.ofPattern("d MMM", Locale.US)
private val fullDay = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.US)

private fun instantOf(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

/**
 * When a photo or video was taken, as a clock reading. The date taken is a local reading stored as if it
 * were UTC, so it is read as written (no zone shift); without one it is the time of the upload, in [zone].
 */
fun timeTakenOf(doc: DocumentDto, zone: ZoneId): LocalDateTime? =
    instantOf(doc.taken_at)?.atOffset(ZoneOffset.UTC)?.toLocalDateTime() ?: timeAddedOf(doc, zone)

/** When a document was uploaded; an upload time is a real instant, read in [zone]. */
fun timeAddedOf(doc: DocumentDto, zone: ZoneId): LocalDateTime? =
    instantOf(doc.created_at)?.atZone(zone)?.toLocalDateTime()

/** The day a photo or video belongs to. */
fun dayTakenOf(doc: DocumentDto, zone: ZoneId): LocalDate? = timeTakenOf(doc, zone)?.toLocalDate()

/** The day a document was uploaded. */
fun dayAddedOf(doc: DocumentDto, zone: ZoneId): LocalDate? = timeAddedOf(doc, zone)?.toLocalDate()

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

/**
 * The days a set of photos and videos spans: "21–25 Aug 2025", "28 Jul – 3 Aug 2025", or one day alone.
 * Both ends are read as written, like a date taken (see [dayTakenOf]); null when either cannot be read.
 */
fun daySpan(dates: MediaDatesDto): String? {
    val first = instantOf(dates.first)?.atOffset(ZoneOffset.UTC)?.toLocalDate() ?: return null
    val last = instantOf(dates.last)?.atOffset(ZoneOffset.UTC)?.toLocalDate() ?: return null
    val end = last.format(fullDay)
    return when {
        first == last -> end
        first.year != last.year -> first.format(fullDay) + " – " + end
        first.month != last.month -> first.format(dayAndMonth) + " – " + end
        else -> "${first.dayOfMonth}–$end"
    }
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

/** The ids of [docs] in the order [byDay] shows them, which is the viewer's swipe order. */
fun dayOrderedIds(filter: DocumentFilter, docs: List<DocumentDto>, zone: ZoneId): List<String> =
    byDay(filter, docs, zone).flatMap { (_, day) -> day.map { it.id } }

/** What a day is called where a list names it; [day] is null for documents with no readable date. */
fun dayTitle(day: LocalDate?, today: LocalDate): String = day?.let { dayLabel(it, today) } ?: "Undated"

/**
 * [docs] as list items, in [byDay] order. Photos and videos are one grid with nothing between the days (the date
 * chip names them); any other list has a heading per day over its rows.
 */
fun buildFeed(filter: DocumentFilter, docs: List<DocumentDto>, today: LocalDate, zone: ZoneId): List<FeedItem> {
    val days = byDay(filter, docs, zone)
    if (!filter.isByDateTaken) {
        return days.flatMap { (day, group) ->
            listOf(FeedItem.Header(key = "day:$day", title = dayTitle(day, today))) + group.map { FeedItem.FileRow(it) }
        }
    }
    if (docs.isEmpty()) return emptyList()
    return listOf(FeedItem.Media(days.flatMap { it.second }))
}
