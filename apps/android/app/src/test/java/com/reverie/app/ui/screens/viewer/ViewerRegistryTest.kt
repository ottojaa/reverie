package com.reverie.app.ui.screens.viewer

import com.reverie.app.ui.screens.browse.doc
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ViewerRegistryTest {

    // Uploads keep the MIME type as the sender wrote it, so the case varies; the Videos tab lists "Video/MP4".
    @Test fun `an upper-case video type opens as a video`() {
        val video = doc("v", "Video/MP4", name = "clip.bin")
        assertTrue(isVideoDocument(video))
        assertFalse(isImageDocument(video))
    }

    @Test fun `an upper-case image type opens as an image`() {
        val image = doc("i", "IMAGE/JPEG", name = "photo.bin")
        assertTrue(isImageDocument(image))
        assertFalse(isVideoDocument(image))
    }

    @Test fun `a heic file with a generic type still opens as an image`() {
        assertTrue(isImageDocument(doc("h", "application/octet-stream", name = "IMG_1.HEIC")))
    }
}
