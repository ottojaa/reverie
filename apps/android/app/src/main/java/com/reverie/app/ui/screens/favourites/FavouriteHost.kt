package com.reverie.app.ui.screens.favourites

import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarVisuals
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.reverie.app.ui.components.StarIcon
import com.reverie.app.ui.components.UnlockSheetHost
import kotlinx.coroutines.launch

/** A snackbar confirming that a star was added or removed. */
private class FavouriteConfirmation(override val message: String) : SnackbarVisuals {
    override val actionLabel: String? = null
    override val withDismissAction: Boolean = false
    override val duration: SnackbarDuration = SnackbarDuration.Short
}

/**
 * A screen's half of its [FavouriteController]: the unlock prompt, the messages (into
 * [snackbarHostState]) and, through [onGo], where an opened favourite leads.
 */
@Composable
fun FavouriteHost(
    controller: FavouriteController,
    snackbarHostState: SnackbarHostState,
    onGo: (FavouriteDestination) -> Unit = {},
) {
    val currentOnGo by rememberUpdatedState(onGo)
    LaunchedEffect(controller, snackbarHostState) {
        controller.events.collect { event ->
            when (event) {
                is FavouriteEvent.Go -> currentOnGo(event.destination)
                is FavouriteEvent.Message -> {
                    snackbarHostState.currentSnackbarData?.dismiss()
                    // Not awaited: showing lasts until the snackbar leaves.
                    launch { snackbarHostState.show(event) }
                }
            }
        }
    }
    UnlockSheetHost(controller.unlocker, onDismiss = controller::dismissUnlock)
}

private suspend fun SnackbarHostState.show(message: FavouriteEvent.Message) {
    if (message.isConfirmation) showSnackbar(FavouriteConfirmation(message.text)) else showSnackbar(message.text)
}

/**
 * A [SnackbarHost] that draws a favourite confirmation as a pill with a star, placed by
 * [pillModifier], and anything else as usual.
 */
@Composable
fun ReverieSnackbarHost(state: SnackbarHostState, modifier: Modifier = Modifier, pillModifier: Modifier = Modifier) {
    SnackbarHost(state, modifier) { data ->
        if (data.visuals is FavouriteConfirmation) FavouritePill(data.visuals.message, pillModifier) else Snackbar(data)
    }
}

@Composable
fun FavouritePill(message: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.padding(bottom = 12.dp),
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        shadowElevation = 6.dp,
    ) {
        Row(
            Modifier.height(44.dp).padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            StarIcon(filled = true, modifier = Modifier.size(16.dp))
            Text(message, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
