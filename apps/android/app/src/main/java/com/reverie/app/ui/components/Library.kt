package com.reverie.app.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.ui.graphics.vector.ImageVector

/** The app's home: its tab and that tab's page. */
const val LIBRARY_NAME = "Library"

/** The root of the folders, wherever it is named: what holds everything stored in Reverie. */
const val ROOT_NAME = "My files"

/** The mark of the Library tab, which also stands for the root of the folders. */
val LibraryIcon: ImageVector get() = Icons.Outlined.GridView
