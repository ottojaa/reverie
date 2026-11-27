package com.reverie.app.ui.screens.browse

import com.reverie.app.data.api.model.DocumentDto
import com.reverie.app.data.api.model.DocumentKind
import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.KindCountsDto
import com.reverie.app.data.api.model.kind
import com.reverie.app.data.settings.FolderChoices
import com.reverie.app.ui.screens.destination.node
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher

/** A [FolderModel] over [server], with what it was given and what it reported. */
internal class FolderFixture(
    val server: FakeServer,
    val model: FolderModel,
    val choices: MutableStateFlow<FolderChoices>,
    val summary: MutableStateFlow<DocumentSummaryDto?>,
    val failures: MutableList<Throwable>,
) {
    val state: FolderState get() = model.state.value
    val ids: List<String> get() = state.documents.documents.map(DocumentDto::id)
}

internal fun countsOf(documents: List<DocumentDto>) = KindCountsDto(
    image = documents.count { it.kind == DocumentKind.IMAGE },
    video = documents.count { it.kind == DocumentKind.VIDEO },
    file = documents.count { it.kind == DocumentKind.FILE },
)

/** A tree with the folder "lisbon", which holds [documents] and no folder, under "trips". */
internal fun treeHolding(documents: List<DocumentDto>): List<FolderWithChildren> {
    val leaf = node("lisbon", parent = "trips").copy(kind_counts = countsOf(documents))
    return listOf(node("trips", children = listOf(leaf)).copy(kind_counts = leaf.kind_counts))
}

/**
 * The page of [folderId] over [server].
 *
 * @param folders the cached tree; by default it counts what the server holds.
 * @param figures the summary already in memory when the page opens.
 * @param fetchSummary the server's answer to a summary read; by default it counts what the server holds.
 */
internal fun TestScope.openFolder(
    server: FakeServer,
    folderId: String? = "lisbon",
    folders: List<FolderWithChildren> = treeHolding(server.library),
    figures: DocumentSummaryDto? = null,
    chosen: FolderChoices = FolderChoices(),
    isLockRefusal: Boolean = false,
    fetchSummary: suspend () -> DocumentSummaryDto = { server.summary() },
): FolderFixture {
    val summary = MutableStateFlow(figures)
    val choices = MutableStateFlow(chosen)
    val failures = mutableListOf<Throwable>()
    val model = FolderModel(
        scope = backgroundScope,
        folderId = folderId,
        tree = MutableStateFlow(folders),
        cache = server.cache,
        summary = summary,
        choices = choices,
        fetchPage = { filter, sort, offset -> server.page(filter, offset, sort) },
        fetchSummary = { fetchSummary().also { summary.value = it } },
        reconcile = { filter, keep -> server.dropStale(filter, keep) },
        onFirstPageFailed = { failures += it },
        isLockRefusal = { isLockRefusal },
        computation = UnconfinedTestDispatcher(testScheduler),
        sharing = SharingStarted.Eagerly,
    )
    return FolderFixture(server, model, choices, summary, failures)
}
