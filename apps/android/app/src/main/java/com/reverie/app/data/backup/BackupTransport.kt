package com.reverie.app.data.backup

import com.reverie.app.data.api.model.CheckContentFile
import com.reverie.app.data.api.model.CheckContentResult
import com.reverie.app.data.api.model.FolderDto

/** Everything a backup pass needs from the device and the server, so the runner can be tested without either. */
interface BackupTransport {
    /** The SHA-256 of [media]'s original bytes, or null when they can't be read. */
    suspend fun hash(media: BackupMedia): String?

    /** Which of [files]' content is already in the library, in [files]' order. Throws [com.reverie.app.data.api.ReverieApiException]. */
    suspend fun checkContent(files: List<CheckContentFile>): List<CheckContentResult>

    /** Uploads [media]'s original bytes into [folderId] and returns the new document's id. Throws like [checkContent]. */
    suspend fun upload(media: BackupMedia, folderId: String): String?

    /** Makes a folder in [parentId] (null for the top level) and returns its id; a name taken there is a 409. Throws like [checkContent]. */
    suspend fun createFolder(name: String, parentId: String?): String

    /** The folders directly inside [parentId]. Throws like [checkContent]. */
    suspend fun listFolders(parentId: String?): List<FolderDto>

    /** The folder [folderId]; a 404 when it is gone, a 403 when a locked folder hides it. Throws like [checkContent]. */
    suspend fun fetchFolder(folderId: String): FolderDto
}

/** What the runner needs to list the device's photos and videos, newest first. */
interface BackupMediaSource {
    suspend fun queryMedia(): List<BackupMedia>
}
