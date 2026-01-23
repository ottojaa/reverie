package com.reverie.app.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.ui.graphics.vector.ImageVector

sealed class Screen(
    val route: String,
    val title: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
) {
    data object Browse : Screen(
        route = "browse",
        title = "Browse",
        selectedIcon = Icons.Filled.Folder,
        unselectedIcon = Icons.Outlined.Folder
    )
    
    data object Upload : Screen(
        route = "upload",
        title = "Upload",
        selectedIcon = Icons.Filled.CloudUpload,
        unselectedIcon = Icons.Outlined.CloudUpload
    )
    
    data object Search : Screen(
        route = "search",
        title = "Search",
        selectedIcon = Icons.Filled.Search,
        unselectedIcon = Icons.Outlined.Search
    )
    
    data object Settings : Screen(
        route = "settings",
        title = "Settings",
        selectedIcon = Icons.Filled.Settings,
        unselectedIcon = Icons.Outlined.Settings
    )
    
    data object Document : Screen(
        route = "document/{id}",
        title = "Document",
        selectedIcon = Icons.Filled.Folder,
        unselectedIcon = Icons.Outlined.Folder
    ) {
        fun createRoute(id: String) = "document/$id"
    }
    
    companion object {
        val bottomNavItems = listOf(Browse, Search, Upload, Settings)
    }
}


