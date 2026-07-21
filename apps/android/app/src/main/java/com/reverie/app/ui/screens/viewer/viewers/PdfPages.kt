package com.reverie.app.ui.screens.viewer.viewers

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.LruCache
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File
import kotlin.math.min

/**
 * Page source for [PdfViewer]: opens the document once and renders pages lazily, on demand, into a
 * byte-bounded LRU cache. Rendering everything up-front (the previous approach) held every page
 * bitmap at once — an A4 page at [RENDER_WIDTH] is ~13 MB, so a long document ran to hundreds of
 * megabytes and nothing showed until the last page finished. Here only the pages near the viewport
 * are ever resident, and page 1 is on screen as soon as it alone has rendered.
 */
internal class PdfPages(file: File) {
    private val renderer = PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY))

    // PdfRenderer is single-threaded (one open page at a time, not thread-safe) — every touch of it
    // after construction is serialized behind this lock.
    private val lock = Any()
    private var closed = false

    val pageCount = min(renderer.pageCount, MAX_PAGES)
    val isTruncated = renderer.pageCount > MAX_PAGES

    /** Per-page aspect (w/h), read once up-front so every item can hold its exact final size (no
     *  layout shift) before its bitmap lands. Opening a page only parses it — far cheaper than a render. */
    val aspects: List<Float> = (0 until pageCount).map { index ->
        renderer.openPage(index).use { it.width.toFloat() / it.height.toFloat() }
    }

    private val cache = object : LruCache<Int, Bitmap>(CACHE_BYTES) {
        override fun sizeOf(key: Int, value: Bitmap) = value.allocationByteCount
    }

    /** Render (or return the cached) page bitmap; null once the viewer has been disposed. */
    fun render(index: Int): Bitmap? {
        synchronized(lock) {
            if (closed) return null
            cache.get(index)?.let { return it }
            renderer.openPage(index).use { page ->
                val height = (RENDER_WIDTH.toFloat() / page.width * page.height).toInt().coerceAtLeast(1)
                val bitmap = Bitmap.createBitmap(RENDER_WIDTH, height, Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                cache.put(index, bitmap)
                return bitmap
            }
        }
    }

    /** Close off the main thread — an in-flight render holding [lock] finishes first, and the
     *  renderer closes its own file descriptor. Subsequent [render] calls return null. */
    fun closeAsync() {
        CoroutineScope(Dispatchers.IO).launch {
            synchronized(lock) {
                if (closed) return@synchronized
                closed = true
                renderer.close()
            }
        }
    }
}

// ~1.5× a 1080p screen width, so a pinch toward MAX_SCALE stays acceptably sharp. PdfRenderer
// requires ARGB_8888, so an A4 page is RENDER_WIDTH × ~1.41·RENDER_WIDTH × 4 bytes ≈ 14 MB.
private const val RENDER_WIDTH = 1600
private const val MAX_PAGES = 150
// Room for ~4 pages: the visible page and its neighbors stay warm; a far back-scroll re-renders
// (~50 ms) behind that page's aspect-true placeholder.
private const val CACHE_BYTES = 64 * 1024 * 1024
