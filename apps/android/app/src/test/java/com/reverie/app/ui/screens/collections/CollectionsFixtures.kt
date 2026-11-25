package com.reverie.app.ui.screens.collections

import com.reverie.app.data.api.model.DocumentSummaryDto
import com.reverie.app.data.api.model.FileTotalsDto
import com.reverie.app.data.api.model.FolderCoverDto
import com.reverie.app.data.api.model.FolderCoverTileDto
import com.reverie.app.data.api.model.FolderType
import com.reverie.app.data.api.model.FolderWithChildren
import com.reverie.app.data.api.model.KindTotalsDto
import com.reverie.app.data.api.model.TopTypeDto
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import com.reverie.app.ui.components.BlurhashDecoder
import com.reverie.app.ui.components.painterCache

/**
 * Data shaped like the C board: a photo collection with five folders (two of them empty), a code
 * collection and an APK collection. Blurhashes stand in for thumbnails (Paparazzi has no network).
 */
internal object CollectionsFixtures {
    private const val STAMP = "2026-11-01T00:00:00.000Z"
    val hashes = listOf("LEHV6nWB2yk8pyo0adR*.7kCMdnj", "L6PZfSi_.AyE_3t7t7R**0o#DgR4", "LKO2?U%2Tw=w]~RBVZRi};RPxuwH", "L9AB*A%LPqWF_3ofWFj[IUWBM{WB")

    fun node(
        id: String,
        name: String,
        type: FolderType = FolderType.FOLDER,
        parent: String? = null,
        emoji: String? = null,
        isPrivate: Boolean = false,
        locked: Boolean = false,
        count: Int = 0,
        children: List<FolderWithChildren> = emptyList(),
    ) = FolderWithChildren(
        id = id, parent_id = parent, name = name, path = "/$name", emoji = emoji, sort_order = 0, type = type,
        is_private = isPrivate, locked = locked, created_at = STAMP, updated_at = STAMP, children = children, document_count = count,
    )

    /** Decode the fixtures' blurhashes up front: the real painter is made off-thread, after a screenshot's one frame. */
    fun warmBlurhashes() {
        hashes.forEach { hash ->
            val bitmap = BlurhashDecoder.decode(hash, 32, 24)
            check(bitmap != null) { "blurhash did not decode: " + hash }
            painterCache.put(hash, BitmapPainter(bitmap.asImageBitmap()))
        }
    }

    private fun tile(id: String, mime: String, name: String, hash: Int?) =
        FolderCoverTileDto(id, mime, name, hash?.let { hashes[it % hashes.size] })

    fun photos(folderId: String, count: Int, tiles: Int = 4) = FolderCoverDto(
        tiles = (0 until tiles).map { tile("$folderId-$it", "image/jpeg", "IMG_$it.jpg", it) },
        summary = DocumentSummaryDto(image = KindTotalsDto(count, count * 2_000_000L)),
    )

    fun files(folderId: String, count: Int, types: List<Pair<String, Int>>, mime: String, tiles: Int = 4) = FolderCoverDto(
        tiles = (0 until tiles).map { tile("$folderId-$it", mime, "file-$it.${types.first().first}", null) },
        summary = DocumentSummaryDto(file = FileTotalsDto(count, count * 40_000L, types.map { TopTypeDto(it.first, it.second) })),
    )

    val emptyCover = FolderCoverDto()

    // Ids that hash to three different accents.
    val travel = node(
        "c-travel", "Travel", FolderType.COLLECTION, emoji = "camera",
        children = listOf(
            node("f-iceland", "Iceland 2025", parent = "c-travel", count = 25),
            node("f-lisbon", "Lisbon", parent = "c-travel", count = 12),
            node("f-japan", "Japan", parent = "c-travel", count = 3),
            node("f-ideas", "Trip ideas", parent = "c-travel"),
            node("f-docs", "Tickets", parent = "c-travel"),
        ),
    )
    val code = node(
        "c-code", "Code", FolderType.COLLECTION, emoji = "code",
        children = listOf(
            node("f-web", "reverie-web", parent = "c-code", count = 13),
            node("f-scripts", "Scripts", parent = "c-code", count = 6),
        ),
    )
    val apps = node(
        "c-apps", "Apps", FolderType.COLLECTION, emoji = "package",
        children = listOf(node("f-apk", "Android builds", parent = "c-apps", count = 91)),
    )
    val rootFolder = node("f-inbox", "Inbox", count = 4)

    val covers: Map<String, FolderCoverDto> = mapOf(
        "f-iceland" to photos("iceland", 25),
        "f-lisbon" to photos("lisbon", 12),
        "f-japan" to photos("japan", 3, tiles = 3),
        "f-ideas" to emptyCover,
        "f-docs" to emptyCover,
        "f-web" to files("web", 13, listOf("ts" to 6, "json" to 4, "md" to 3), "text/plain"),
        "f-scripts" to files("scripts", 6, listOf("sh" to 6), "text/x-shellscript", tiles = 2),
        "f-apk" to files("apk", 91, listOf("apk" to 91), "application/vnd.android.package-archive"),
        "f-inbox" to files("inbox", 4, listOf("pdf" to 4), "application/pdf", tiles = 1),
    )

    val lockedVault = node("c-vault", "Vault", FolderType.COLLECTION, emoji = "shield", isPrivate = true, locked = true)
    val unlockedVault = node(
        "c-vault", "Vault", FolderType.COLLECTION, emoji = "shield", isPrivate = true,
        children = listOf(node("f-tax", "Taxes", parent = "c-vault", isPrivate = true, count = 6)),
    )
    val emptyCollection = node("c-empty", "Recipes", FolderType.COLLECTION, emoji = "utensils")

    fun state(vararg tree: FolderWithChildren, covers: Map<String, FolderCoverDto> = CollectionsFixtures.covers) = CollectionsUiState(
        tree = tree.toList(),
        covers = covers,
        collectionCount = tree.count { it.type == FolderType.COLLECTION },
        folderCount = tree.sumOf { n -> if (n.type == FolderType.FOLDER) 1 else n.children.size.toInt() },
        storageUsed = 48_300_000_000L,
        storageQuota = 100_000_000_000L,
    )
}
