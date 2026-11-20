package com.reverie.app.domain.upload

import com.reverie.app.data.api.model.CheckContentResult
import com.reverie.app.data.api.model.ContentLocation
import com.reverie.app.data.api.model.FolderContent
import com.reverie.app.data.api.model.PrivateContent
import com.reverie.app.data.api.model.TrashContent

/** A picked file the content check had something to say about. [index] is its position in the picked list. */
data class ContentFinding(val index: Int, val name: String, val result: CheckContentResult) {
    val hasContentMatch: Boolean get() = result.content != null
}

/** The replace / keep both answer for same-name files; the wire values match the upload API. */
enum class NameStrategy(val wire: String) { REPLACE("replace"), KEEP_BOTH("keep_both") }

/** Pairs picked files with the check's answers (same order) and keeps the ones that need a decision. */
fun toFindings(names: List<String>, results: List<CheckContentResult>): List<ContentFinding> =
    names.mapIndexedNotNull { index, name ->
        val result = results.getOrNull(index) ?: return@mapIndexedNotNull null
        if (result.content == null && !result.name_conflict) null else ContentFinding(index, name, result)
    }

/** ["Work", "Invoices"] -> "Work › Invoices". */
fun toBreadcrumb(folderPath: List<String>): String = folderPath.joinToString(" › ")

/**
 * The wording for where content already is. The web upload dialog says the same; keep them in step.
 * [detail] is the existing filename, only when it differs from the file being uploaded.
 */
data class ContentDescription(val label: String, val detail: String? = null)

fun describeContent(content: ContentLocation, uploadName: String): ContentDescription = when (content) {
    PrivateContent -> ContentDescription("Already in a private folder")
    TrashContent -> ContentDescription("Already in Trash")
    is FolderContent -> ContentDescription(
        label = content.folder_path?.let { "Already in ${toBreadcrumb(it)}" } ?: "Already in your library, not in a folder",
        detail = if (content.filename == uploadName) null else "As ${content.filename}",
    )
}

fun describeNameConflict(folderName: String?, hasContentMatch: Boolean): String {
    val where = folderName ?: "this folder"
    return if (hasContentMatch) "Same name also exists in $where" else "A different file with this name is already in $where"
}

/** Whether this file still needs a replace / keep both answer once the person has decided on it. */
fun needsNameChoice(finding: ContentFinding, uploadAnyway: Boolean): Boolean =
    finding.result.name_conflict && (!finding.hasContentMatch || uploadAnyway)

/** The picked items that stay in the upload: all except a content match the person left on Skip. */
fun <T> keptItems(items: List<T>, findings: List<ContentFinding>, uploadAnyway: Set<Int>): List<T> {
    val skipped = findings.filter { it.hasContentMatch && it.index !in uploadAnyway }.map { it.index }.toSet()
    return items.filterIndexed { index, _ -> index !in skipped }
}
