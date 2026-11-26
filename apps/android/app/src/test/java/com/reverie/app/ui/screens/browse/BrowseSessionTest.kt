package com.reverie.app.ui.screens.browse

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.local.ReverieDatabase
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The lock on a folder's list, from the server refusing it to the password opening it. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class BrowseSessionTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val database = Room.inMemoryDatabaseBuilder(context, ReverieDatabase::class.java).build()

    @After fun tearDown() {
        scope.cancel()
        database.close()
    }

    @Test fun `unlocking forgets the lock and reads the list again`() = runBlocking {
        val readAgain = CompletableDeferred<Unit>()
        val session = session(onRefresh = { readAgain.complete(Unit) })
        session.onRefreshFailed(
            ReverieApiException.parse(
                403,
                """{"statusCode":403,"error":"FOLDER_LOCKED","message":"Folder is locked","details":{"folder_id":"f1"}}""",
            ),
        )
        withTimeout(5_000) { session.ui.first { it.lockedFolderId == "f1" } }

        session.unlocker.submit("password")

        withTimeout(5_000) { readAgain.await() }
        assertEquals(null, withTimeout(5_000) { session.ui.first { it.lockedFolderId == null } }.lockedFolderId)
    }

    private fun session(onRefresh: () -> Unit) = BrowseSession(
        scope = scope,
        folderId = "f1",
        deps = browseDeps(context, database, scope, FavouriteWorld()),
        refresh = onRefresh,
        onContentChanged = {},
    )
}
