package com.reverie.app.ui.screens.browse

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.api.ReverieApiException
import com.reverie.app.data.api.model.LockAsk
import com.reverie.app.data.api.model.LockSecretKind
import com.reverie.app.data.local.ReverieDatabase
import com.reverie.app.ui.components.awaitForm
import com.reverie.app.ui.screens.destination.node
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

/** The lock on a folder's list, from the server refusing it to its secret opening it. */
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
        session.refuse()
        withTimeout(5_000) { session.ui.first { it.lockedFolderId == "f1" } }

        withTimeout(5_000) { session.unlocker.awaitForm() }
        session.unlocker.submit("password")

        withTimeout(5_000) { readAgain.await() }
        assertEquals(null, withTimeout(5_000) { session.ui.first { it.lockedFolderId == null } }.lockedFolderId)
    }

    @Test fun `a locked list names what the lock takes now`() = runBlocking {
        val world = FavouriteWorld().apply { secretKind = LockSecretKind.PIN }
        val session = session(world)

        session.refuse()

        val ui = withTimeout(5_000) { session.ui.first { it.lockedFolderId == "f1" && it.lockAsk != null } }
        assertEquals("Enter your PIN to open it.", toLockedDescription(ui.lockAsk))
        world.secretKind = LockSecretKind.PASSWORD
        session.unlocker.dismiss()
        session.refuse()
        val changed = withTimeout(5_000) { session.ui.first { it.lockAsk == LockAsk.PASSWORD } }
        assertEquals("Enter your lock password to open it.", toLockedDescription(changed.lockAsk))
    }

    @Test fun `the locked wording falls back to the account password, and to none while unread`() {
        assertEquals("Enter your account password to open it.", toLockedDescription(LockAsk.ACCOUNT_PASSWORD))
        assertEquals("Unlock it to see what is inside.", toLockedDescription(null))
    }

    @Test fun `a list refused before the screen has read anything still names the folder`() = runBlocking {
        val world = FavouriteWorld().apply { tree = listOf(node("Taxes", isPrivate = true).copy(id = "f1")) }
        val session = session(world)
        withTimeout(5_000) { world.folderDao.rows.first { it.isNotEmpty() } }

        session.refuse()

        val prompt = withTimeout(5_000) { session.unlocker.prompt.first { it != null } }
        assertEquals("Taxes", prompt?.folderName)
    }

    private fun BrowseSession.refuse() = onRefreshFailed(
        ReverieApiException.parse(
            403,
            """{"statusCode":403,"error":"FOLDER_LOCKED","message":"Folder is locked","details":{"folder_id":"f1"}}""",
        ),
    )

    private fun session(world: FavouriteWorld = FavouriteWorld(), onRefresh: () -> Unit = {}) = BrowseSession(
        scope = scope,
        folderId = "f1",
        deps = browseDeps(context, database, scope, world),
        refresh = onRefresh,
        onContentChanged = {},
    )
}
