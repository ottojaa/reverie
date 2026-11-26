package com.reverie.app.ui.screens.library

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.DpRect
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FileTotalsDto
import com.reverie.app.ui.screens.browse.doc
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The Library's Files card: a block for each of the newest files' types, the name and count over them. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w400dp-h900dp")
class FilesCardTest {
    @get:Rule
    val compose = createComposeRule()

    private val opened = mutableListOf<DocumentKind>()

    private fun file(name: String, mime: String = "application/octet-stream") = doc(name, mime, name = name)

    private fun show(files: List<DocumentDto>) = compose.setContent {
        ReverieTheme {
            LibraryBento(
                summary = DocumentSummaryDto(file = FileTotalsDto(count = 77)),
                covers = KindCovers(files = files),
                onOpen = { opened += it },
            )
        }
    }

    private fun bounds(tag: String): DpRect =
        compose.onNodeWithTag(tag, useUnmergedTree = true).getUnclippedBoundsInRoot()

    @Test fun `four blocks, newest first, in two rows of two`() {
        show(listOf(file("a.apk"), file("b.zip"), file("c.md", "text/markdown"), file("d.pdf", "application/pdf")))

        val (apk, zip, md, pdf) = listOf("APK", "ZIP", "MD", "PDF").map { bounds("file-block:$it") }

        assertEquals(apk.top, zip.top)
        assertEquals(md.top, pdf.top)
        assertEquals(apk.left, md.left)
        assertEquals(zip.left, pdf.left)
        assertTrue(apk.left < zip.left && apk.top < md.top)
    }

    @Test fun `the name and the count sit over the foot of the blocks`() {
        show(listOf(file("a.apk"), file("b.zip"), file("c.md"), file("d.pdf")))

        compose.onNodeWithText("Files").assertIsDisplayed()
        val count = compose.onNodeWithText("77", useUnmergedTree = true).getUnclippedBoundsInRoot()
        val lowerLeft = bounds("file-block:MD")

        assertTrue(count.top > lowerLeft.top && count.bottom <= lowerLeft.bottom)
    }

    @Test fun `with fewer than four files the other blocks are plain`() {
        show(listOf(file("a.apk"), file("b.zip")))

        compose.onNodeWithTag("file-block:APK", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("file-block:ZIP", useUnmergedTree = true).assertExists()
        compose.onAllNodesWithTag("file-block:plain", useUnmergedTree = true).assertCountEquals(2)
    }

    @Test fun `the extensions are decoration, so the card reads as its name and count`() {
        show(listOf(file("a.apk")))

        val card = compose.onNodeWithText("Files")
        val read = card.fetchSemanticsNode().config[SemanticsProperties.Text].map { it.text }
        card.performClick()

        assertEquals(listOf("Files", "77"), read)

        assertEquals(listOf(DocumentKind.FILE), opened)
    }
}
