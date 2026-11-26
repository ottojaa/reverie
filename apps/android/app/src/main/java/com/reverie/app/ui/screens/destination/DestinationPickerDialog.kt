package com.reverie.app.ui.screens.destination

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.ui.components.CreateEditFolderSheet
import com.reverie.app.ui.components.FullScreenDialog
import com.reverie.app.ui.components.VaultUnlockSheet

/** The destination browser over the current screen, whenever [browser] is open. */
@Composable
fun DestinationPickerDialog(browser: DestinationBrowser, onSelect: (Destination) -> Unit) {
    val state by browser.state.collectAsStateWithLifecycle()
    val prompt by browser.unlocker.prompt.collectAsStateWithLifecycle()
    var isCreating by remember { mutableStateOf(false) }
    val shown = state ?: return

    FullScreenDialog(onBack = browser::back) {
        DestinationPickerContent(
            state = shown,
            onOpen = browser::open,
            onSearch = browser::search,
            onNewFolder = { isCreating = true },
            onCancel = browser::close,
            onSelect = {
                browser.close()
                onSelect(shown.destination)
            },
        )
        if (isCreating) {
            CreateEditFolderSheet(
                title = "New folder",
                initial = null,
                onSubmit = {
                    isCreating = false
                    browser.create(it)
                },
                onDismiss = { isCreating = false },
                allowPrivate = shown.rules.allowPrivate,
            )
        }
        prompt?.let { VaultUnlockSheet(it, browser.unlocker::submit, browser.unlocker::dismiss) }
    }
}
