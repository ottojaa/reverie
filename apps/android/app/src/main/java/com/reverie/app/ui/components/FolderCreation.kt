package com.reverie.app.ui.components

import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.CreateFolderRequest
import com.reverie.app.data.api.model.FolderDto
import com.reverie.app.data.api.model.UpdateFolderRequest
import com.reverie.app.data.repository.FolderRepository
import kotlinx.coroutines.CancellationException

/**
 * Creates the folder [form] describes inside [parentId] (null: at the top level). Making it private is a
 * second request, so a folder can be created and still not be private.
 *
 * @param onCreated told as soon as the folder exists, before it is made private.
 * @return what to tell the user when a step failed; null when both went through.
 */
suspend fun FolderRepository.createFolder(
    form: FolderFormData,
    parentId: String?,
    onCreated: (FolderDto) -> Unit = {},
): String? {
    var failure = "Couldn't create the folder"
    return try {
        val created = create(CreateFolderRequest(form.name, parentId, form.description, form.emoji))
        onCreated(created)
        failure = "Created the folder, but couldn't make it private"
        if (form.isPrivate) update(created.id, UpdateFolderRequest(is_private = true))
        null
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Exception) {
        listOfNotNull(failure, (error as? ReverieApiException)?.userMessage()).joinToString(": ")
    }
}
