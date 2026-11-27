package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Android
import androidx.compose.material.icons.outlined.Audiotrack
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.FolderZip
import androidx.compose.material.icons.outlined.FontDownload
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Slideshow
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.hasRenderedThumbnail
import com.reverie.app.data.api.model.kind

/**
 * A family of file types: the colour and glyph its files wear. [isPictured] says a document of it is shown as
 * the picture the server renders of it (its first page); photos and videos always are.
 */
internal class FileType(val tint: Color, val icon: ImageVector, val isPictured: Boolean = false) {
    /** The ground its files stand on: the tint, thinned over the surface. */
    val ground: Color
        @Composable get() = tint.copy(alpha = 0.3f).compositeOver(MaterialTheme.colorScheme.surfaceContainerHighest)

    /** What is written or drawn on [ground]: drawn towards the text colour, so it stands out in either theme. */
    val ink: Color
        @Composable get() = lerp(tint, MaterialTheme.colorScheme.onSurface, 0.45f)
}

private val NEUTRAL = FileType(Color(0xFF94A3B8), Icons.AutoMirrored.Outlined.InsertDriveFile)
private val SPREADSHEET = Color(0xFF059669)

/** Each family and the extensions that belong to it. */
private val TYPES: List<Pair<FileType, String>> = listOf(
    FileType(Color(0xFF3B82F6), Icons.Outlined.Image) to "jpg jpeg png gif webp bmp tiff heic heif ico",
    FileType(Color(0xFFA855F7), Icons.Outlined.Movie) to "mp4 mov webm avi mkv m4v",
    FileType(Color(0xFFEF4444), Icons.Outlined.PictureAsPdf, isPictured = true) to "pdf",
    FileType(Color(0xFF22C55E), Icons.Outlined.Audiotrack) to "mp3 wav flac ogg m4a aac",
    FileType(SPREADSHEET, Icons.Outlined.TableChart, isPictured = true) to "xls xlsx xlsm ods numbers",
    FileType(SPREADSHEET, Icons.Outlined.TableChart) to "csv tsv",
    FileType(Color(0xFF2563EB), Icons.Outlined.Description, isPictured = true) to "doc docx odt rtf pages",
    FileType(Color(0xFFF97316), Icons.Outlined.Slideshow, isPictured = true) to "ppt pptx odp key",
    FileType(Color(0xFF64748B), Icons.AutoMirrored.Outlined.Article) to "md markdown mdx rst txt log",
    FileType(Color(0xFFF59E0B), Icons.Outlined.Code) to "json jsonc json5 ndjson",
    FileType(Color(0xFF6B7280), Icons.Outlined.Code) to "yaml yml toml ini conf cfg env properties",
    FileType(Color(0xFF8B5CF6), Icons.Outlined.Code) to
        "js mjs cjs jsx ts tsx py rb go rs java kt kts c h cpp cc hpp cs php swift sh bash zsh sql graphql gql",
    FileType(Color(0xFFEA580C), Icons.Outlined.Code) to "xml html htm svg vue svelte",
    FileType(Color(0xFF0EA5E9), Icons.Outlined.Code) to "css scss sass less",
    FileType(Color(0xFFCA8A04), Icons.Outlined.FolderZip) to "zip rar 7z tar gz tgz bz2 xz",
    FileType(Color(0xFFEC4899), Icons.Outlined.FontDownload) to "ttf otf woff woff2",
    FileType(NEUTRAL.tint, Icons.Outlined.Android) to "apk",
    NEUTRAL to "exe bin dmg iso",
)

private val TYPE_BY_EXTENSION: Map<String, FileType> =
    TYPES.flatMap { (type, extensions) -> extensions.split(' ').map { it to type } }.toMap()

/** The family of a file: by its extension, else by what its MIME type says it is. */
internal fun fileTypeOf(mime: String, filename: String): FileType {
    TYPE_BY_EXTENSION[filename.substringAfterLast('.', "").lowercase()]?.let { return it }
    val like = when {
        mime.startsWith("image/") -> "jpg"
        mime == "application/pdf" -> "pdf"
        mime.startsWith("video/") -> "mp4"
        mime.startsWith("audio/") -> "mp3"
        "spreadsheet" in mime || "excel" in mime -> "xlsx"
        "presentation" in mime || "powerpoint" in mime -> "pptx"
        "word" in mime -> "docx"
        mime.startsWith("text/") -> "txt"
        else -> return NEUTRAL
    }
    return TYPE_BY_EXTENSION.getValue(like)
}

/** Whether a document is drawn as the picture the server rendered of it, rather than as its type. */
internal val DocumentDto.showsPreview: Boolean
    get() = hasRenderedThumbnail &&
        (kind != DocumentKind.FILE || fileTypeOf(mime_type, original_filename).isPictured)

/**
 * A document with no picture to show: its family's glyph over its extension, on the family's tint.
 * [caption] names the file under them, for a tile with nothing else naming it.
 */
@Composable
internal fun FileTypeTile(
    mimeType: String,
    filename: String,
    modifier: Modifier = Modifier,
    glyph: Dp = 22.dp,
    caption: String? = null,
) {
    val type = fileTypeOf(mimeType, filename)
    val label = fileTypeLabel(mimeType, filename)
    Column(
        modifier.background(type.ground),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(type.icon, contentDescription = null, tint = type.ink, modifier = Modifier.size(glyph))
        Text(
            label,
            color = type.ink,
            fontSize = 9.sp,
            lineHeight = 12.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.05.em,
            maxLines = 1,
            softWrap = false,
            modifier = Modifier.clearAndSetSemantics { testTag = "file-tile:$label" },
        )
        if (caption == null) return@Column
        Text(
            caption,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 8.dp, top = 6.dp, end = 8.dp),
        )
    }
}
