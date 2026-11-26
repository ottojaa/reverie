package com.reverie.app.ui.screens.browse

import android.content.Context
import android.os.Looper
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.reverie.app.data.local.ReverieDatabase
import com.reverie.app.ui.components.FolderFormData
import com.reverie.app.ui.screens.destination.node
import com.reverie.app.ui.screens.favourites.FavouriteWorld
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.launchIn
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The root page's real view model: a folder page with no folder id. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class MyFilesViewModelTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val database = Room.inMemoryDatabaseBuilder(context, ReverieDatabase::class.java).build()
    private val world = FavouriteWorld().apply { tree = listOf(node("Travel")) }
    private lateinit var viewModel: FolderViewModel

    @Before fun setUp() {
        viewModel = FolderViewModel(SavedStateHandle(), browseDeps(context, database, scope, world))
        viewModel.state.launchIn(scope)
    }

    @After fun tearDown() {
        viewModel.viewModelScope.cancel()
        scope.cancel()
        database.close()
    }

    /** The view model's work resumes on the main looper, which Robolectric runs only when told to. */
    private fun await(condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 5_000
        while (!condition()) {
            check(System.currentTimeMillis() < deadline) { "Timed out" }
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }
    }

    @Test fun `opening it reads the folder tree and lists the top-level folders`() {
        await { viewModel.state.value.children.map { it.id } == listOf("Travel") }
    }

    @Test fun `a folder made here is made at the top level, and appears`() {
        viewModel.createFolder(FolderFormData("Taxes", emoji = null, description = null, isPrivate = false))

        await { viewModel.state.value.children.map { it.name }.toSet() == setOf("Travel", "Taxes") }
        val made = world.requests.single { it.startsWith("POST folders ") }
        check("parent_id" !in made || "\"parent_id\":null" in made) { made }
    }
}
