package com.reverie.app.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/** User-selectable theme preference (persisted in settings). */
enum class ThemeMode { LIGHT, DARK, SYSTEM }

/**
 * Reverie's Material 3 theme. Brand palette is the default; when [dynamicColor] is enabled
 * (Android 12+) the app adopts the wallpaper-derived scheme wholesale. Extended colors
 * (success/warning/info) stay brand-fixed in every mode.
 */
@Composable
fun ReverieTheme(
    themeMode: ThemeMode = ThemeMode.SYSTEM,
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val darkTheme = when (themeMode) {
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
    }

    val colorScheme: ColorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> ReverieDarkColorScheme
        else -> ReverieLightColorScheme
    }

    val baseExtended = if (darkTheme) DarkExtendedColors else LightExtendedColors
    // Keep the "card" alias consistent with the active scheme even in dynamic mode.
    val extendedColors = baseExtended.copy(
        card = if (darkTheme) colorScheme.surfaceContainer else colorScheme.surfaceContainerLowest,
    )

    // Match system-bar icon contrast to the resolved theme (skipped in @Preview).
    val view = LocalView.current
    if (!LocalInspectionMode.current) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !darkTheme
                isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }

    CompositionLocalProvider(LocalReverieColors provides extendedColors) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = Typography,
            shapes = ReverieShapes,
            content = content,
        )
    }
}

/** Accessors for brand tokens that live outside the standard [MaterialTheme] roles. */
object ReverieTheme {
    val extendedColors: ReverieExtendedColors
        @Composable @ReadOnlyComposable
        get() = LocalReverieColors.current

    /** Semantic "card" surface — a different container level in light vs dark. */
    val cardColor: Color
        @Composable @ReadOnlyComposable
        get() = LocalReverieColors.current.card
}
