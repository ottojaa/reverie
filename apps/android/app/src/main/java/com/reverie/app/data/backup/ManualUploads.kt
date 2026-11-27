package com.reverie.app.data.backup

/** The uploads the user started by hand. Backup makes way for them. */
fun interface ManualUploads {
    suspend fun isRunning(): Boolean
}
