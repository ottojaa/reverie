package com.reverie.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFFB4C5E4),
    onPrimary = Color(0xFF1E2E4A),
    primaryContainer = Color(0xFF354562),
    onPrimaryContainer = Color(0xFFD6E3FF),
    secondary = Color(0xFFC1C6DD),
    onSecondary = Color(0xFF2B3042),
    secondaryContainer = Color(0xFF414659),
    onSecondaryContainer = Color(0xFFDDE1F9),
    tertiary = Color(0xFFE2BBDB),
    onTertiary = Color(0xFF422740),
    tertiaryContainer = Color(0xFF5A3D57),
    onTertiaryContainer = Color(0xFFFFD7F5),
    background = Color(0xFF111318),
    onBackground = Color(0xFFE2E2E9),
    surface = Color(0xFF111318),
    onSurface = Color(0xFFE2E2E9),
    surfaceVariant = Color(0xFF44474E),
    onSurfaceVariant = Color(0xFFC4C6D0),
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF4C5D7A),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFD6E3FF),
    onPrimaryContainer = Color(0xFF061A33),
    secondary = Color(0xFF595D71),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFDDE1F9),
    onSecondaryContainer = Color(0xFF161A2C),
    tertiary = Color(0xFF73546F),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFFD7F5),
    onTertiaryContainer = Color(0xFF2A1229),
    background = Color(0xFFFAF8FF),
    onBackground = Color(0xFF1A1B21),
    surface = Color(0xFFFAF8FF),
    onSurface = Color(0xFF1A1B21),
    surfaceVariant = Color(0xFFE1E2EC),
    onSurfaceVariant = Color(0xFF44474E),
)

@Composable
fun ReverieTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}



