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
import androidx.compose.ui.graphics.vector.ImageVector

/** Per-extension icon for the ~50 most common file types (keyed lowercase, no dot). */
private val EXTENSION_ICONS: Map<String, ImageVector> = buildMap {
    fun ImageVector.covers(vararg extensions: String) = extensions.forEach { put(it, this) }

    Icons.Outlined.Description.covers("doc", "docx", "odt", "rtf", "pages")
    Icons.Outlined.PictureAsPdf.covers("pdf")
    Icons.Outlined.TableChart.covers("xls", "xlsx", "xlsm", "ods", "numbers", "csv", "tsv")
    Icons.Outlined.Slideshow.covers("ppt", "pptx", "odp", "key")
    Icons.Outlined.Article.covers("md", "markdown", "mdx", "rst", "txt", "log")
    Icons.Outlined.DataObject.covers("json", "jsonc", "json5", "ndjson")
    Icons.Outlined.Tune.covers("yaml", "yml", "toml", "ini", "conf", "cfg", "env", "properties")
    Icons.Outlined.Code.covers(
        "xml", "html", "htm", "svg", "vue", "svelte", "css", "scss", "sass", "less",
        "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt", "kts",
        "c", "h", "cpp", "cc", "hpp", "cs", "php", "swift", "sh", "bash", "zsh", "sql", "graphql", "gql",
    )
    Icons.Outlined.FolderZip.covers("zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz")
    Icons.Outlined.AudioFile.covers("mp3", "wav", "flac", "ogg", "m4a", "aac")
    Icons.Outlined.Movie.covers("mp4", "mov", "webm", "avi", "mkv", "m4v")
    Icons.Outlined.Image.covers("jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "heic", "heif", "ico")
    Icons.Outlined.FontDownload.covers("ttf", "otf", "woff", "woff2")
    Icons.Outlined.Terminal.covers("exe", "bin", "dmg", "iso", "apk")
}

/**
 * The icon for a document shown without a picture. The extension decides first, being the more
 * specific; then the MIME type; then a generic file.
 */
internal fun fileTypeIcon(mime: String, filename: String): ImageVector {
    val ext = filename.substringAfterLast('.', "").lowercase()
    EXTENSION_ICONS[ext]?.let { return it }

    return when {
        mime.startsWith("image/") -> Icons.Outlined.Image
        mime == "application/pdf" -> Icons.Outlined.PictureAsPdf
        mime.startsWith("video/") -> Icons.Outlined.Movie
        mime.startsWith("audio/") -> Icons.Outlined.AudioFile
        mime.contains("spreadsheet") || mime.contains("excel") -> Icons.Outlined.TableChart
        mime.contains("presentation") || mime.contains("powerpoint") -> Icons.Outlined.Slideshow
        mime.contains("word") -> Icons.Outlined.Description
        mime.startsWith("text/") -> Icons.Outlined.Article
        else -> Icons.Outlined.InsertDriveFile
    }
}
