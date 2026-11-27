package com.reverie.app.data.backup

import com.reverie.app.data.api.ReverieApiException

/** A refusal that says nothing about the files after this one. */
internal fun isOneFilesFault(e: ReverieApiException) = e is ReverieApiException.Http && e.statusCode in 400..499 &&
    !ReverieApiException.isAuthFailure(e) && !isFolderLocked(e) && e.statusCode != 404

/** The server's locked-folder answer, even when it left out which folder. */
internal fun isFolderLocked(e: ReverieApiException) =
    e.lockedFolderId() != null || (e is ReverieApiException.Http && e.code == ReverieApiException.FOLDER_LOCKED_CODE)

/** Plain-words reason a whole pass has to stop for [e]. A locked folder stops only its album, so it isn't one. */
internal fun stopReason(e: ReverieApiException): String = when {
    ReverieApiException.isAuthFailure(e) || e is ReverieApiException.Auth ->
        "You're signed out. Sign in again to resume backup."
    e is ReverieApiException.Network -> "Couldn't reach the server. Backup will try again when the network is back."
    e is ReverieApiException.Http && e.statusCode == 404 -> "The backup folder couldn't be found. Backup will try again later."
    else -> e.userMessage()
}
