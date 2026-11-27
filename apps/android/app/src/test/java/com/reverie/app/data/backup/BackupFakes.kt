package com.reverie.app.data.backup

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.CheckContentFile
import com.reverie.app.data.api.model.CheckContentResult
import com.reverie.app.data.api.model.ContentLocation
import com.reverie.app.data.api.model.FolderDto
import com.reverie.app.data.local.dao.BackupDao
import com.reverie.app.data.local.entity.BackupLedgerEntity
import com.reverie.app.data.local.entity.BackupRetryEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.TestScope
import org.junit.rules.TemporaryFolder
import java.io.File

/** The real settings repository over a file of its own. */
internal fun TestScope.settingsRepository(files: TemporaryFolder): BackupSettingsRepository =
    BackupSettingsRepository(
        PreferenceDataStoreFactory.create(migrations = listOf(BackupSettingsMigration), scope = backgroundScope) {
            File(files.newFolder(), "backup.preferences_pb")
        },
    )

internal fun notFound() = ReverieApiException.Http(404, "not_found", "Folder not found")

internal fun folderLocked() = ReverieApiException.Http(403, ReverieApiException.FOLDER_LOCKED_CODE, "Locked")

/**
 * The server's folders as backup meets them: sibling names are unique ignoring case (409), and nothing
 * can be made or put inside a folder that is gone (404) or locked.
 */
internal class FakeFolderServer {
    private val folders = linkedMapOf<String, FolderDto>()
    private var lastId = 0
    val locked = mutableSetOf<String>()
    var creates = 0

    fun add(name: String, parentId: String? = null): String {
        val id = "f${++lastId}"
        folders[id] = FolderDto(
            id = id, name = name, parent_id = parentId, path = "/$id", sort_order = 0, is_private = false,
            created_at = "2026-01-01T00:00:00Z", updated_at = "2026-01-01T00:00:00Z",
        )
        return id
    }

    fun create(name: String, parentId: String?): String {
        creates++
        if (isShut(parentId)) throw folderLocked()
        if (parentId != null && parentId !in folders) throw notFound()
        if (children(parentId).any { it.name.equals(name, ignoreCase = true) }) {
            throw ReverieApiException.Http(409, "conflict", "A folder with this name already exists")
        }
        return add(name, parentId)
    }

    fun children(parentId: String?): List<FolderDto> = folders.values.filter { it.parent_id == parentId }

    /** As the server answers for one folder: it describes a locked one, and refuses one inside it. */
    fun fetch(id: String): FolderDto {
        val folder = folders[id] ?: throw notFound()
        if (isShut(folder.parent_id)) throw folderLocked()
        return folder.copy(locked = id in locked)
    }

    fun assertTakesFiles(id: String) {
        if (id !in folders) throw notFound()
        if (isShut(id)) throw folderLocked()
    }

    /** Whether [id] is locked, or sits inside a folder that is. */
    private fun isShut(id: String?): Boolean = id != null && (id in locked || isShut(folders[id]?.parent_id))

    fun rename(id: String, name: String) {
        folders[id] = folders.getValue(id).copy(name = name)
    }

    /** Takes the folder away with everything in it. */
    fun delete(id: String) {
        children(id).forEach { delete(it.id) }
        folders.remove(id)
    }

    /** "Phone backup/Camera", or null for a folder that isn't there. */
    fun path(id: String): String? {
        val folder = folders[id] ?: return null
        val parent = folder.parent_id ?: return folder.name
        return path(parent) + "/" + folder.name
    }
}

/** A transport that only does folders; the tests that upload override the rest. */
internal open class FakeFolderTransport(val server: FakeFolderServer = FakeFolderServer()) : BackupTransport {
    var beforeCreate: suspend (name: String) -> Unit = {}

    override suspend fun createFolder(name: String, parentId: String?): String {
        beforeCreate(name)
        return server.create(name, parentId)
    }

    override suspend fun listFolders(parentId: String?): List<FolderDto> = server.children(parentId)

    override suspend fun fetchFolder(folderId: String): FolderDto = server.fetch(folderId)

    override suspend fun hash(media: BackupMedia): String? = error("not a folder call")

    override suspend fun checkContent(files: List<CheckContentFile>): List<CheckContentResult> = error("not a folder call")

    override suspend fun upload(media: BackupMedia, folderId: String): String? = error("not a folder call")
}

/** A photo; album 1 is the camera's. */
internal fun media(id: Long, bucket: Long = 1, addedAt: Long = 0) = BackupMedia(
    id, "IMG_$id.jpg", "image/jpeg", 1_000, bucket,
    bucketName = if (bucket == 1L) "Camera" else "Album $bucket", addedAt = addedAt,
)

internal class FakeDao : BackupDao {
    val ledger = MutableStateFlow<Map<Long, BackupLedgerEntity>>(emptyMap())
    val retryRows = MutableStateFlow<Map<Long, BackupRetryEntity>>(emptyMap())
    override suspend fun ledgerIds(): List<Long> = ledger.value.keys.toList()
    override fun observeLedgerIds(): Flow<List<Long>> = ledger.map { it.keys.toList() }
    override suspend fun retries(): List<BackupRetryEntity> = retryRows.value.values.toList()
    override fun observeRetries(): Flow<List<BackupRetryEntity>> = retryRows.map { it.values.toList() }
    override suspend fun putLedger(entry: BackupLedgerEntity) { ledger.value = ledger.value + (entry.mediaId to entry) }
    override suspend fun putRetry(entry: BackupRetryEntity) { retryRows.value = retryRows.value + (entry.mediaId to entry) }
    override suspend fun deleteRetry(mediaId: Long) { retryRows.value = retryRows.value - mediaId }
    override suspend fun clearLedger() { ledger.value = emptyMap() }
    override suspend fun clearRetries() { retryRows.value = emptyMap() }
}

internal class FakeSource(var items: List<BackupMedia>) : BackupMediaSource {
    override suspend fun queryMedia(): List<BackupMedia> = items
}

/** The library's answer per hash, plus hooks for the upload and check calls. */
internal class FakeTransport(private val pass: (milliseconds: Long) -> Unit = {}) : FakeFolderTransport() {
    val known = mutableMapOf<String, ContentLocation>()
    val hashed = mutableListOf<Long>()
    val uploaded = mutableListOf<Long>()
    /** The folder each uploaded file went into, as the server names it. */
    val uploadedTo = mutableMapOf<Long, String?>()
    val checked = mutableListOf<List<CheckContentFile>>()
    var uploadCost = 0L
    var onUpload: suspend (BackupMedia) -> Unit = {}
    var checkFailure: ReverieApiException? = null
    var shortAnswer = false

    override suspend fun hash(media: BackupMedia): String? {
        hashed += media.id
        return "h${media.id}"
    }

    override suspend fun checkContent(files: List<CheckContentFile>): List<CheckContentResult> {
        checked += files
        checkFailure?.let { throw it }
        val results = files.map { CheckContentResult(it.name, it.sha256, known[it.sha256]) }
        return if (shortAnswer) results.dropLast(1) else results
    }

    override suspend fun upload(media: BackupMedia, folderId: String): String? {
        onUpload(media)
        server.assertTakesFiles(folderId)
        uploaded += media.id
        uploadedTo[media.id] = server.path(folderId)
        pass(uploadCost)
        return "doc-${media.id}"
    }
}
