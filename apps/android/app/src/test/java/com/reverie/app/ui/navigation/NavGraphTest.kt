package com.reverie.app.ui.navigation

import android.content.Context
import androidx.navigation.NavHostController
import androidx.navigation.compose.ComposeNavigator
import androidx.navigation.compose.DialogNavigator
import androidx.navigation.createGraph
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The app's real navigation graph, so a route with no screen behind it is noticed before it is opened. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NavGraphTest {
    @Test fun `every place the pill floats over has a screen`() {
        val controller = NavHostController(ApplicationProvider.getApplicationContext<Context>()).apply {
            navigatorProvider.addNavigator(ComposeNavigator())
            navigatorProvider.addNavigator(DialogNavigator())
        }
        val graph = controller.createGraph(startDestination = Routes.LIBRARY) { reverieDestinations(controller) }

        val missing = Routes.pillRoutes.filter { graph.findNode(it) == null }

        assertEquals(emptyList<String>(), missing)
    }
}
