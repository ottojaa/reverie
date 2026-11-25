package com.reverie.app.ui.screens.upload

import com.reverie.app.data.api.model.FolderType
import com.reverie.app.data.api.model.FolderWithChildren

/**
 * Groups the folder tree into the picker's sections: one per collection (with its uploadable child
 * folders) plus a "Folders" section for folders that sit at the root.
 */
fun toPickerSections(tree: List<FolderWithChildren>): List<FolderPickerSection> {
    val sections = mutableListOf<FolderPickerSection>()
    val rootFolders = mutableListOf<FolderOption>()
    tree.forEach { node ->
        when (node.type) {
            FolderType.COLLECTION -> sections += FolderPickerSection(
                id = node.id,
                name = node.name,
                emoji = node.emoji,
                collectionId = node.id,
                folders = node.children
                    .filter { it.type == FolderType.FOLDER }
                    .map { FolderOption(it.id, it.name, it.emoji) },
            )
            else -> rootFolders += FolderOption(node.id, node.name, node.emoji)
        }
    }
    if (rootFolders.isNotEmpty()) {
        sections += FolderPickerSection(id = "root", name = "Folders", emoji = null, collectionId = null, folders = rootFolders)
    }
    return sections
}

/**
 * The tree without private folders (and without anything inside a private collection). Backup
 * must never write into a private folder: it may be locked, and it would put photos where the
 * person chose to keep things out of the open library.
 */
fun withoutPrivateFolders(tree: List<FolderWithChildren>): List<FolderWithChildren> = tree
    .filter { !it.is_private && !it.locked }
    .map { it.copy(children = withoutPrivateFolders(it.children)) }
