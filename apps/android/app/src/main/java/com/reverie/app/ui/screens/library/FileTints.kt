package com.reverie.app.ui.screens.library

import androidx.compose.ui.graphics.Color

private val NEUTRAL_TINT = Color(0xFF94A3B8)

/** The colour of a file's type on the Library's Files card, and the extensions that wear it. */
private val TINTS: List<Pair<Color, String>> = listOf(
    Color(0xFF3B82F6) to "jpg jpeg png gif webp bmp tiff heic heif ico",
    Color(0xFFA855F7) to "mp4 mov webm avi mkv m4v",
    Color(0xFFEF4444) to "pdf",
    Color(0xFF22C55E) to "mp3 wav flac ogg m4a aac",
    Color(0xFF059669) to "xls xlsx xlsm ods numbers csv tsv",
    Color(0xFF2563EB) to "doc docx odt rtf pages",
    Color(0xFFF97316) to "ppt pptx odp key",
    Color(0xFF64748B) to "md markdown mdx rst txt log",
    Color(0xFFF59E0B) to "json jsonc json5 ndjson",
    Color(0xFF6B7280) to "yaml yml toml ini conf cfg env properties",
    Color(0xFF8B5CF6) to "js mjs cjs jsx ts tsx py rb go rs java kt kts c h cpp cc hpp cs php swift sh bash zsh sql graphql gql",
    Color(0xFFEA580C) to "xml html htm svg vue svelte",
    Color(0xFF0EA5E9) to "css scss sass less",
    Color(0xFFCA8A04) to "zip rar 7z tar gz tgz bz2 xz",
    Color(0xFFEC4899) to "ttf otf woff woff2",
    NEUTRAL_TINT to "exe bin dmg iso apk",
)

private val TINT_BY_EXTENSION: Map<String, Color> =
    TINTS.flatMap { (tint, extensions) -> extensions.split(' ').map { it to tint } }.toMap()

/** The tint for a file: by its extension, else by what its MIME type says it is. */
internal fun fileTint(mime: String, filename: String): Color {
    TINT_BY_EXTENSION[filename.substringAfterLast('.', "").lowercase()]?.let { return it }
    val like = when {
        mime.startsWith("image/") -> "jpg"
        mime == "application/pdf" -> "pdf"
        mime.startsWith("video/") -> "mp4"
        mime.startsWith("audio/") -> "mp3"
        "spreadsheet" in mime || "excel" in mime -> "xlsx"
        "presentation" in mime || "powerpoint" in mime -> "pptx"
        "word" in mime -> "docx"
        mime.startsWith("text/") -> "txt"
        else -> return NEUTRAL_TINT
    }
    return TINT_BY_EXTENSION.getValue(like)
}
