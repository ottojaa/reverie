package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.kind
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Neighbouring media uploaded within this long of each other fold into one row. */
const val FOLD_WINDOW_MILLIS = 10 * 60 * 1000L

/**
 * The most documents one fold holds. A camera-roll backup uploads thousands of photos seconds apart;
 * unbounded, the newest fold would swallow every page that loads and the list would never get a
 * second row. Members are counted from the newest, so a page that lands only fills the last fold or
 * starts new ones below it, and nothing above moves.
 */
const val FOLD_MAX_MEMBERS = 30

/**
 * One row of the Recently added list. A [Group] holds several documents (newest first)
 * behind one line: a [GroupKind.FOLD] of media uploaded together, or a [GroupKind.STACK] of files that
 * share a name. A group's key is its newest member's id, so a page that extends a group keeps its row.
 */
sealed interface RecentRow {
    val key: String

    data class Single(val doc: DocumentDto) : RecentRow {
        override val key get() = doc.id
    }

    data class Group(val groupKind: GroupKind, val docs: List<DocumentDto>) : RecentRow {
        override val key get() = docs.first().id
    }
}

enum class GroupKind { FOLD, STACK }

/** What the list draws: a row, or one member of an expanded group. */
sealed interface RecentEntry {
    val key: String

    data class Row(val row: RecentRow, val expanded: Boolean = false) : RecentEntry {
        override val key get() = row.key
    }

    /** A member shown under its expanded [group]. */
    data class Member(val doc: DocumentDto, val groupKey: String) : RecentEntry {
        override val key get() = "member:" + doc.id
    }
}

private fun DocumentDto.isMedia() = kind != DocumentKind.FILE

private fun DocumentDto.createdMillis(): Long? = runCatching { Instant.parse(created_at).toEpochMilli() }.getOrNull()

/**
 * Folds and stacks [docs], the loaded documents in upload order (newest first).
 *
 * Folding looks at raw neighbours only, so a document hidden inside a stack still separates the media
 * on either side of it, and a page that lands later can only extend the last group, never merge two
 * groups above it. Stacking collects every loaded file with exactly the same name into one row at the
 * position of its newest copy; media never stacks (camera names repeat without being versions).
 */
fun recentRows(docs: List<DocumentDto>): List<RecentRow> {
    val folds = foldRuns(docs)
    val stacks = docs.filter { it.kind == DocumentKind.FILE }.groupBy { it.original_filename }.filterValues { it.size > 1 }
    val rows = mutableListOf<RecentRow>()
    val stacked = mutableSetOf<String>()
    var index = 0
    while (index < docs.size) {
        val fold = folds[index]
        if (fold != null) {
            rows += RecentRow.Group(GroupKind.FOLD, fold)
            index += fold.size
            continue
        }
        val doc = docs[index++]
        val members = stacks[doc.original_filename].takeIf { doc.kind == DocumentKind.FILE }
        when {
            members == null -> rows += RecentRow.Single(doc)
            stacked.add(doc.original_filename) -> rows += RecentRow.Group(GroupKind.STACK, members)
        }
    }
    return rows
}

/** The folds (two or more chained media neighbours, at most [FOLD_MAX_MEMBERS]), keyed by the index each starts at. */
private fun foldRuns(docs: List<DocumentDto>): Map<Int, List<DocumentDto>> {
    val folds = mutableMapOf<Int, List<DocumentDto>>()
    var start = 0
    for (i in 1..docs.size) {
        if (i < docs.size && isChained(docs[i - 1], docs[i])) continue
        var at = start
        for (chunk in docs.subList(start, i).chunked(FOLD_MAX_MEMBERS)) {
            if (chunk.size > 1) folds[at] = chunk
            at += chunk.size
        }
        start = i
    }
    return folds
}

private fun isChained(newer: DocumentDto, older: DocumentDto): Boolean {
    if (!newer.isMedia() || !older.isMedia()) return false
    val a = newer.createdMillis() ?: return false
    val b = older.createdMillis() ?: return false
    return a - b in 0..FOLD_WINDOW_MILLIS
}

/** [rows] with the groups whose key is in [expanded] opened into their members. */
fun recentEntries(rows: List<RecentRow>, expanded: Set<String>): List<RecentEntry> = rows.flatMap { row ->
    if (row !is RecentRow.Group) return@flatMap listOf(RecentEntry.Row(row))
    val open = row.key in expanded
    listOf<RecentEntry>(RecentEntry.Row(row, open)) + if (open) row.docs.map { RecentEntry.Member(it, row.key) } else emptyList()
}

/**
 * The viewer's swipe order over [rows]: a single is one item, a collapsed group is one item (its newest
 * member), and the members of a group in [expanded] are items in place, newest first.
 */
fun viewerIds(rows: List<RecentRow>, expanded: Set<String>): List<String> = rows.flatMap { row ->
    when {
        row is RecentRow.Single -> listOf(row.doc.id)
        row is RecentRow.Group && row.key in expanded -> row.docs.map { it.id }
        else -> listOf(row.key)
    }
}

/** The ids of the documents a row stands for: all the members of a group, the one document of a single. */
fun RecentRow.docIds(): List<String> = when (this) {
    is RecentRow.Single -> listOf(doc.id)
    is RecentRow.Group -> docs.map { it.id }
}

private val dayInYear = DateTimeFormatter.ofPattern("d MMM", Locale.US)
private val dayWithYear = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.US)

private fun dayText(day: LocalDate, today: LocalDate): String =
    day.format(if (day.year == today.year) dayInYear else dayWithYear)

private fun DocumentDto.day(zone: ZoneId): LocalDate? = createdMillis()?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate() }

/** "Videos · 6 Nov", "Photos and videos · 9 Nov": the members' kind (no count) and the day of the newest. */
fun foldLabel(docs: List<DocumentDto>, today: LocalDate, zone: ZoneId): String {
    val kinds = docs.map { it.kind }.toSet()
    val what = when (kinds) {
        setOf(DocumentKind.IMAGE) -> "Photos"
        setOf(DocumentKind.VIDEO) -> "Videos"
        else -> "Photos and videos"
    }
    val day = docs.first().day(zone)?.let { dayText(it, today) } ?: return what
    return "$what · $day"
}

/** "Versions · 19–25 Aug": the days the copies were uploaded across, oldest to newest. */
fun stackLabel(docs: List<DocumentDto>, today: LocalDate, zone: ZoneId): String {
    val newest = docs.first().day(zone)
    val oldest = docs.last().day(zone)
    if (newest == null || oldest == null) return "Versions"
    return "Versions · " + dayRange(oldest, newest, today)
}

private fun dayRange(from: LocalDate, to: LocalDate, today: LocalDate): String = when {
    from == to -> dayText(from, today)
    from.year == to.year && from.month == to.month -> from.dayOfMonth.toString() + "–" + dayText(to, today)
    else -> dayText(from, today) + " – " + dayText(to, today)
}

private val weekday = DateTimeFormatter.ofPattern("EEE", Locale.US)
private val clock = DateTimeFormatter.ofPattern("HH:mm", Locale.US)

/** When a row was added, short: the time today, "Yesterday", the weekday within a week, else "6 Nov". */
fun recentWhen(doc: DocumentDto, today: LocalDate, zone: ZoneId): String {
    val instant = doc.createdMillis()?.let(Instant::ofEpochMilli) ?: return ""
    val at = instant.atZone(zone)
    val days = java.time.temporal.ChronoUnit.DAYS.between(at.toLocalDate(), today)
    return when {
        days <= 0 -> at.format(clock)
        days == 1L -> "Yesterday"
        days < 7 -> at.format(weekday)
        else -> dayText(at.toLocalDate(), today)
    }
}
