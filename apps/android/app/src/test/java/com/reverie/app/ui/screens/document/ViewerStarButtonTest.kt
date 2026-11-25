package com.reverie.app.ui.screens.document

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import com.reverie.app.data.api.model.FavouriteKey
import com.reverie.app.data.repository.FavouritesState
import com.reverie.app.ui.screens.favourites.FavouriteFixtures
import com.reverie.app.ui.theme.ReverieTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ViewerStarButtonTest {
    @get:Rule
    val compose = createComposeRule()

    private var favourites by mutableStateOf(FavouritesState())
    private val toggled = mutableListOf<FavouriteKey>()

    private fun show() = compose.setContent {
        ReverieTheme { ViewerStarButton(favourites, FavouriteFixtures.invoice.id, onToggle = { toggled += it }) }
    }

    @Test fun `the star is disabled until the favourites have loaded`() {
        show()

        compose.onNodeWithContentDescription("Add to favourites").assertIsNotEnabled().performClick()
        assertEquals(emptyList<FavouriteKey>(), toggled)

        favourites = FavouriteFixtures.loaded

        compose.onNodeWithContentDescription("Remove from favourites").assertIsEnabled().performClick()
        assertEquals(listOf(FavouriteFixtures.invoice.key), toggled)
    }

    @Test fun `a document that is not starred offers to add it`() {
        favourites = FavouriteFixtures.state()
        show()

        compose.onNodeWithContentDescription("Add to favourites").assertIsEnabled()
    }
}
