package com.reverie.app.ui.screens.destination

import com.reverie.app.data.api.model.FolderWithChildren

/** A tree node named after its id; private folders and what is under one carry the lock. */
internal fun node(
    name: String,
    parent: String? = null,
    children: List<FolderWithChildren> = emptyList(),
    isPrivate: Boolean = false,
    lockId: String? = name.takeIf { isPrivate },
    locked: Boolean = false,
) = FolderWithChildren(
    id = name, parent_id = parent, name = name, path = "/$name", sort_order = 0,
    is_private = isPrivate, lock_id = lockId, locked = locked,
    created_at = "2026-11-25T00:00:00Z", updated_at = "2026-11-25T00:00:00Z", children = children,
)
