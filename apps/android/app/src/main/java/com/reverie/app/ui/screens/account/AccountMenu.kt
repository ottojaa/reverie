package com.reverie.app.ui.screens.account

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.ui.components.AccountButton
import com.reverie.app.ui.components.ConfirmDialog

/** Where the account sheet leads. */
data class AccountLinks(
    val onOpenBackup: () -> Unit,
    val onOpenPrivateFolders: () -> Unit,
    val onOpenSettings: () -> Unit,
)

/** The header's avatar button and the account sheet it opens. */
@Composable
fun AccountEntry(links: AccountLinks, viewModel: AccountViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.recheck() }
    AccountMenu(state, links, viewModel::signOut)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AccountMenu(state: AccountState, links: AccountLinks, onSignOut: () -> Unit) {
    var isOpen by rememberSaveable { mutableStateOf(false) }
    var isConfirmingSignOut by rememberSaveable { mutableStateOf(false) }

    // The sheet closes as it leads elsewhere, so it isn't still open on the way back.
    fun leaving(go: () -> Unit): () -> Unit = {
        isOpen = false
        go()
    }

    AccountButton(state.backup) { isOpen = true }

    if (isOpen) {
        ModalBottomSheet(
            onDismissRequest = { isOpen = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        ) {
            AccountSheetContent(
                state = state,
                links = AccountLinks(
                    onOpenBackup = leaving(links.onOpenBackup),
                    onOpenPrivateFolders = leaving(links.onOpenPrivateFolders),
                    onOpenSettings = leaving(links.onOpenSettings),
                ),
                onSignOut = leaving { isConfirmingSignOut = true },
            )
        }
    }

    if (isConfirmingSignOut) {
        ConfirmDialog(
            title = "Sign out?",
            message = "You'll need to sign in again to access your library.",
            confirmLabel = "Sign out",
            destructive = true,
            onConfirm = {
                isConfirmingSignOut = false
                onSignOut()
            },
            onDismiss = { isConfirmingSignOut = false },
        )
    }
}
