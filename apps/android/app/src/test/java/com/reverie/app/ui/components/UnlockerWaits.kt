package com.reverie.app.ui.components

import kotlinx.coroutines.flow.first

/** The prompt once it can be typed into: it first asks the server how the lock opens. */
suspend fun FolderUnlocker.awaitForm(): FolderUnlockPrompt = prompt.first { it?.lock is LockCheck.Known }!!
