package com.reverie.app.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Article
import androidx.compose.material.icons.outlined.AudioFile
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.DataObject
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.FolderZip
import androidx.compose.material.icons.outlined.FontDownload
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Slideshow
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * Icon + accent for a document that has no raster thumbnail (binaries, archives, audio, …).
 * Mirrors the web FileTypeIcon map and the canvas getIconTexture palette so the file-type
 * fallback looks the same across the grid, the 3D canvas, and mobile.
 */
internal data class FileTypeVisual(val icon: ImageVector, val tint: Color)

private val IMAGE = FileTypeVisual(Icons.Outlined.Image, Color(0xFF3B82F6))
private val VIDEO = FileTypeVisual(Icons.Outlined.Movie, Color(0xFFA855F7))
private val PDF = FileTypeVisual(Icons.Outlined.PictureAsPdf, Color(0xFFEF4444))
private val AUDIO = FileTypeVisual(Icons.Outlined.AudioFile, Color(0xFF22C55E))
private val SHEET = FileTypeVisual(Icons.Outlined.TableChart, Color(0xFF059669))
private val WORD = FileTypeVisual(Icons.Outlined.Description, Color(0xFF2563EB))
private val SLIDES = FileTypeVisual(Icons.Outlined.Slideshow, Color(0xFFF97316))
private val TEXT = FileTypeVisual(Icons.Outlined.Article, Color(0xFF64748B))
private val DATA = FileTypeVisual(Icons.Outlined.DataObject, Color(0xFFF59E0B))
private val CONFIG = FileTypeVisual(Icons.Outlined.Tune, Color(0xFF6B7280))
private val CODE = FileTypeVisual(Icons.Outlined.Code, Color(0xFF8B5CF6))
private val WEB = FileTypeVisual(Icons.Outlined.Code, Color(0xFFEA580C))
private val STYLE = FileTypeVisual(Icons.Outlined.Code, Color(0xFF0EA5E9))
private val ARCHIVE = FileTypeVisual(Icons.Outlined.FolderZip, Color(0xFFCA8A04))
private val FONT = FileTypeVisual(Icons.Outlined.FontDownload, Color(0xFFEC4899))
private val BINARY = FileTypeVisual(Icons.Outlined.Terminal, Color(0xFF94A3B8))
private val GENERIC = FileTypeVisual(Icons.Outlined.InsertDriveFile, Color(0xFF94A3B8))

/** Per-extension visual for the ~50 most common file types (keyed lowercase, no dot). */
private val EXTENSION_VISUALS: Map<String, FileTypeVisual> = buildMap {
    listOf("doc", "docx", "odt", "rtf", "pages").forEach { put(it, WORD) }
    put("pdf", PDF)
    listOf("xls", "xlsx", "xlsm", "ods", "numbers", "csv", "tsv").forEach { put(it, SHEET) }
    listOf("ppt", "pptx", "odp", "key").forEach { put(it, SLIDES) }
    listOf("md", "markdown", "mdx", "rst", "txt", "log").forEach { put(it, TEXT) }
    listOf("json", "jsonc", "json5", "ndjson").forEach { put(it, DATA) }
    listOf("yaml", "yml", "toml", "ini", "conf", "cfg", "env", "properties").forEach { put(it, CONFIG) }
    listOf("xml", "html", "htm", "svg", "vue", "svelte").forEach { put(it, WEB) }
    listOf("css", "scss", "sass", "less").forEach { put(it, STYLE) }
    listOf(
        "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt", "kts",
        "c", "h", "cpp", "cc", "hpp", "cs", "php", "swift", "sh", "bash", "zsh", "sql", "graphql", "gql",
    ).forEach { put(it, CODE) }
    listOf("zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz").forEach { put(it, ARCHIVE) }
    listOf("mp3", "wav", "flac", "ogg", "m4a", "aac").forEach { put(it, AUDIO) }
    listOf("mp4", "mov", "webm", "avi", "mkv", "m4v").forEach { put(it, VIDEO) }
    listOf("jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "heic", "heif", "ico").forEach { put(it, IMAGE) }
    listOf("ttf", "otf", "woff", "woff2").forEach { put(it, FONT) }
    listOf("exe", "bin", "dmg", "iso", "apk").forEach { put(it, BINARY) }
}

/** Prefer the extension (specific icon/colour); fall back to MIME buckets, then a generic file. */
internal fun fileTypeVisual(mime: String, filename: String): FileTypeVisual {
    val ext = filename.substringAfterLast('.', "").lowercase()
    EXTENSION_VISUALS[ext]?.let { return it }

    return when {
        mime.startsWith("image/") -> IMAGE
        mime == "application/pdf" -> PDF
        mime.startsWith("video/") -> VIDEO
        mime.startsWith("audio/") -> AUDIO
        mime.contains("spreadsheet") || mime.contains("excel") -> SHEET
        mime.contains("presentation") || mime.contains("powerpoint") -> SLIDES
        mime.contains("word") || mime == "application/msword" || mime.contains("wordprocessingml") -> WORD
        mime.startsWith("text/") -> TEXT
        else -> GENERIC
    }
}
