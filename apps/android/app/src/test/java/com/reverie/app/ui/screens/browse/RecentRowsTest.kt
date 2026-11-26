package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

class RecentRowsTest {

    private val base = Instant.parse("2026-11-23T12:00:00Z")
    private fun at(minutesAgo: Long) = base.minusSeconds(minutesAgo * 60).toString()

    private fun photo(id: String, minutesAgo: Long) = doc(id, "image/jpeg", at(minutesAgo), name = "IMG_$id.jpg")
    private fun video(id: String, minutesAgo: Long) = doc(id, "video/mp4", at(minutesAgo), name = "VID_$id.mp4")
    private fun file(id: String, minutesAgo: Long, name: String = "$id.pdf") = doc(id, "application/pdf", at(minutesAgo), name = name)

    private fun shape(rows: List<RecentRow>) = rows.map {
        when (it) {
            is RecentRow.Single -> it.doc.id
            is RecentRow.Group -> it.groupKind.name.first() + it.docs.joinToString(",", "[", "]") { d -> d.id }
        }
    }

    @Test
    fun `media within ten minutes of its neighbour folds, a chain keeps growing`() {
        val rows = recentRows(listOf(photo("a", 0), photo("b", 8), video("c", 16), photo("d", 40)))
        assertEquals(listOf("F[a,b,c]", "d"), shape(rows))
    }

    @Test
    fun `a gap over ten minutes splits folds and a lone media stays single`() {
        val rows = recentRows(listOf(photo("a", 0), photo("b", 3), photo("c", 14), photo("d", 30)))
        assertEquals(listOf("F[a,b]", "c", "d"), shape(rows))
    }

    @Test
    fun `files never fold with media or each other`() {
        val rows = recentRows(listOf(file("a", 0), photo("b", 1), file("c", 2), photo("d", 3)))
        assertEquals(listOf("a", "b", "c", "d"), shape(rows))
    }

    @Test
    fun `a fold is keyed by its newest member so a page that extends it keeps the row`() {
        val page1 = listOf(photo("a", 0), photo("b", 5), photo("c", 100))
        val both = page1 + photo("d", 104)
        val before = recentRows(page1)
        val after = recentRows(both)
        assertEquals(listOf("a", "c"), before.map { it.key }.let { listOf(it[0], it[1]) })
        assertEquals(listOf("F[a,b]", "F[c,d]"), shape(after))
        // c was a single before and stays the same row (same key) once d joins it
        assertEquals(before.map { it.key }, after.map { it.key })
    }

    @Test
    fun `a later page never merges two folds that were already shown`() {
        val page1 = listOf(photo("a", 0), photo("b", 4), photo("c", 60), photo("d", 64))
        val page2 = page1 + photo("e", 300)
        assertEquals(listOf("F[a,b]", "F[c,d]"), shape(recentRows(page1)))
        assertEquals(listOf("F[a,b]", "F[c,d]", "e"), shape(recentRows(page2)))
    }

    @Test
    fun `a long batch folds into rows of at most thirty, counted from the newest`() {
        val batch = (0 until 100).map { photo("p$it", minutesAgo = 0).copy(created_at = base.minusSeconds(it * 5L).toString()) }
        val rows = recentRows(batch)
        assertEquals(listOf(30, 30, 30, 10), rows.map { (it as RecentRow.Group).docs.size })
        assertEquals(listOf("p0", "p30", "p60", "p90"), rows.map { it.key })
        // More of the batch arriving only fills the last fold and starts new ones: the rows above stay.
        val more = batch + (100 until 135).map { photo("p$it", 0).copy(created_at = base.minusSeconds(it * 5L).toString()) }
        val after = recentRows(more)
        assertEquals(listOf(30, 30, 30, 30, 15), after.map { (it as RecentRow.Group).docs.size })
        assertEquals(rows.take(3).map { it.key }, after.take(3).map { it.key })
    }

    @Test
    fun `a batch one over the bound leaves its last member single`() {
        val batch = (0 until 31).map { photo("p$it", 0).copy(created_at = base.minusSeconds(it * 5L).toString()) }
        val rows = recentRows(batch)
        assertEquals(2, rows.size)
        assertEquals("p30", (rows[1] as RecentRow.Single).doc.id)
    }

    @Test
    fun `files with exactly the same name stack at the newest copy's position`() {
        val docs = listOf(
            file("a", 0, "x.apk"), file("n1", 5, "notes.md"), file("b", 10, "x.apk"), file("c", 20, "x.apk"), file("n2", 30, "other.md"),
        )
        assertEquals(listOf("S[a,b,c]", "n1", "n2"), shape(recentRows(docs)))
    }

    @Test
    fun `names differing in case or extension do not stack`() {
        val docs = listOf(file("a", 0, "x.apk"), file("b", 5, "X.apk"), file("c", 10, "x.apk.zip"))
        assertEquals(listOf("a", "b", "c"), shape(recentRows(docs)))
    }

    @Test
    fun `a stack gains older copies from a later page without moving rows above it`() {
        val page1 = listOf(file("a", 0, "x.apk"), file("n", 5, "n.md"), file("b", 10, "x.apk"))
        val page2 = page1 + file("c", 500, "x.apk") + file("m", 600, "m.md")
        assertEquals(listOf("S[a,b]", "n"), shape(recentRows(page1)))
        assertEquals(listOf("S[a,b,c]", "n", "m"), shape(recentRows(page2)))
        assertEquals(recentRows(page1).map { it.key }, recentRows(page2).map { it.key }.take(2))
    }

    @Test
    fun `media with the same name does not stack`() {
        val docs = listOf(
            doc("a", "image/png", at(0), name = "Screenshot.png"),
            file("n", 30, "n.md"),
            doc("b", "image/png", at(60), name = "Screenshot.png"),
        )
        assertEquals(listOf("a", "n", "b"), shape(recentRows(docs)))
    }

    @Test
    fun `a stacked older copy still separates media on either side of it`() {
        val docs = listOf(photo("a", 0), file("x", 2, "x.apk"), photo("b", 4), file("y", 6, "x.apk"))
        assertEquals(listOf("a", "S[x,y]", "b"), shape(recentRows(docs)))
    }

    @Test
    fun `expanding a group lists its members under it`() {
        val rows = recentRows(listOf(photo("a", 0), photo("b", 1), file("c", 90)))
        val entries = recentEntries(rows, expanded = setOf("a"))
        assertEquals(listOf("a", "member:a", "member:b", "c"), entries.map { it.key })
        assertTrue((entries[0] as RecentEntry.Row).expanded)
        assertEquals(listOf("a", "c"), recentEntries(rows, emptySet()).map { it.key })
    }

    @Test
    fun `a row stands for all its loaded members when selected`() {
        val rows = recentRows(listOf(photo("a", 0), photo("b", 1), file("c", 90)))
        assertEquals(listOf("a", "b"), rows[0].docIds())
        assertEquals(listOf("c"), rows[1].docIds())
    }

    @Test
    fun `labels name the kind without a count`() {
        val zone = ZoneOffset.UTC
        val today = LocalDate.of(2026, 11, 23)
        val videos = listOf(video("a", 0), video("b", 1))
        val mixed = listOf(photo("a", 0), video("b", 1))
        assertEquals("Videos · 23 Nov", foldLabel(videos, today, zone))
        assertEquals("Photos and videos · 23 Nov", foldLabel(mixed, today, zone))
        assertEquals("Photos · 23 Nov", foldLabel(listOf(photo("a", 0), photo("b", 1)), today, zone))
    }

    @Test
    fun `a stack label spans the days of its copies`() {
        val zone = ZoneOffset.UTC
        val today = LocalDate.of(2026, 11, 23)
        fun copy(id: String, created: String): DocumentDto = doc(id, "application/vnd.android.package-archive", created, name = "x.apk")
        val sameMonth = listOf(copy("b", "2026-08-25T10:00:00Z"), copy("a", "2026-08-19T10:00:00Z"))
        val acrossMonths = listOf(copy("b", "2026-09-02T10:00:00Z"), copy("a", "2026-08-19T10:00:00Z"))
        val oneDay = listOf(copy("b", "2026-08-19T12:00:00Z"), copy("a", "2026-08-19T10:00:00Z"))
        assertEquals("Versions · 19–25 Aug", stackLabel(sameMonth, today, zone))
        assertEquals("Versions · 19 Aug – 2 Sep", stackLabel(acrossMonths, today, zone))
        assertEquals("Versions · 19 Aug", stackLabel(oneDay, today, zone))
    }

    @Test
    fun `the time of a row is short and relative`() {
        val zone = ZoneOffset.UTC
        val today = LocalDate.of(2026, 11, 23)
        fun whenOf(created: String) = recentWhen(doc("x", created = created), today, zone)
        assertEquals("09:05", whenOf("2026-11-23T09:05:00Z"))
        assertEquals("Yesterday", whenOf("2026-11-22T09:05:00Z"))
        assertEquals("Thu", whenOf("2026-11-19T09:05:00Z"))
        assertEquals("6 Nov", whenOf("2026-11-06T09:05:00Z"))
    }
}
