package com.reverie.app.data.backup

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.CheckContentFile
import com.reverie.app.data.api.model.CheckContentResult
import com.reverie.app.data.api.model.FolderDto
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

/**
 * The server's folders as backup meets them: sibling names are unique ignoring case (409), and nothing
 * can be made inside a folder that is gone (404) or locked.
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
        if (parentId in locked) throw ReverieApiException.Http(403, ReverieApiException.FOLDER_LOCKED_CODE, "Locked")
        if (parentId != null && parentId !in folders) throw notFound()
        if (children(parentId).any { it.name.equals(name, ignoreCase = true) }) {
            throw ReverieApiException.Http(409, "conflict", "A folder with this name already exists")
        }
        return add(name, parentId)
    }

    fun children(parentId: String?): List<FolderDto> = folders.values.filter { it.parent_id == parentId }

    fun isLive(id: String) = id in folders

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

    override suspend fun hash(media: BackupMedia): String? = error("not a folder call")

    override suspend fun checkContent(files: List<CheckContentFile>): List<CheckContentResult> = error("not a folder call")

    override suspend fun upload(media: BackupMedia, folderId: String): String? = error("not a folder call")
}
