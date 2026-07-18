package com.reverie.app.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/*
 * Reverie brand palette, ported from apps/web/src/styles.css.
 *
 * The web aesthetic builds depth by layering `background → card → secondary` rather
 * than drawing borders. That maps directly onto Material 3's `surfaceContainer` ladder,
 * which is the load-bearing part of this mapping. Container/on-container tones that the
 * brand doesn't define are derived from the brand hues.
 *
 * Note the deliberate light/dark inversion of the "card" surface: in light mode cards are
 * the *lowest* container (pure white above a warm background); in dark mode they are a
 * *raised* container (#242424 above #121212). Components must not hardcode a container
 * level — use [com.reverie.app.ui.theme.ReverieTheme.cardColor].
 */

// ---- Light ----
private val LightPrimary = Color(0xFF0D9488) // teal
private val LightOnPrimary = Color(0xFFFFFFFF)
private val LightPrimaryContainer = Color(0xFFC6EBE6)
private val LightOnPrimaryContainer = Color(0xFF083F3A)
private val LightSecondary = Color(0xFF5C5C5C) // warm gray — keeps teal scarce
private val LightOnSecondary = Color(0xFFFFFFFF)
private val LightSecondaryContainer = Color(0xFFF0EFE9)
private val LightOnSecondaryContainer = Color(0xFF1A1A1A)
private val LightTertiary = Color(0xFF4F46E5) // indigo accent
private val LightOnTertiary = Color(0xFFFFFFFF)
private val LightTertiaryContainer = Color(0xFFE3E1FB)
private val LightOnTertiaryContainer = Color(0xFF25217A)
private val LightError = Color(0xFFDC2626)
private val LightOnError = Color(0xFFFFFFFF)
private val LightErrorContainer = Color(0xFFFEE2E2)
private val LightOnErrorContainer = Color(0xFF7F1D1D)
private val LightBackground = Color(0xFFF8F7F4) // warm off-white
private val LightOnBackground = Color(0xFF1A1A1A)
private val LightSurface = Color(0xFFF8F7F4)
private val LightOnSurface = Color(0xFF1A1A1A)
private val LightSurfaceVariant = Color(0xFFE8E6E1)
private val LightOnSurfaceVariant = Color(0xFF5C5C5C)
private val LightSurfaceDim = Color(0xFFE2E0DA)
private val LightSurfaceBright = Color(0xFFF8F7F4)
private val LightSurfaceContainerLowest = Color(0xFFFFFFFF) // cards
private val LightSurfaceContainerLow = Color(0xFFF4F3EF)
private val LightSurfaceContainer = Color(0xFFF0EFE9) // nav bar, chips
private val LightSurfaceContainerHigh = Color(0xFFECEAE4)
private val LightSurfaceContainerHighest = Color(0xFFE8E6E1)
private val LightOutline = Color(0xFFD4D2CC)
private val LightOutlineVariant = Color(0xFFE8E6E1)
private val LightInverseSurface = Color(0xFF2E2E2E)
private val LightInverseOnSurface = Color(0xFFF5F5F5)
private val LightInversePrimary = Color(0xFF4FD1C5)
private val LightScrim = Color(0xFF000000)

// ---- Dark ----
private val DarkPrimary = Color(0xFF4FD1C5) // brighter teal
private val DarkOnPrimary = Color(0xFF1A1A1A)
private val DarkPrimaryContainer = Color(0xFF0B4F49)
private val DarkOnPrimaryContainer = Color(0xFFA9E6E0)
private val DarkSecondary = Color(0xFFA0A0A0)
private val DarkOnSecondary = Color(0xFF1A1A1A)
private val DarkSecondaryContainer = Color(0xFF2E2E2E)
private val DarkOnSecondaryContainer = Color(0xFFF5F5F5)
private val DarkTertiary = Color(0xFF667EEA) // indigo
private val DarkOnTertiary = Color(0xFFFFFFFF)
private val DarkTertiaryContainer = Color(0xFF33307E)
private val DarkOnTertiaryContainer = Color(0xFFDDE2FB)
private val DarkError = Color(0xFFF56565)
private val DarkOnError = Color(0xFF1A1A1A)
private val DarkErrorContainer = Color(0xFF5C1D1D)
private val DarkOnErrorContainer = Color(0xFFFECACA)
private val DarkBackground = Color(0xFF121212)
private val DarkOnBackground = Color(0xFFF5F5F5)
private val DarkSurface = Color(0xFF121212)
private val DarkOnSurface = Color(0xFFF5F5F5)
private val DarkSurfaceVariant = Color(0xFF2A2A2A)
private val DarkOnSurfaceVariant = Color(0xFFA0A0A0)
private val DarkSurfaceDim = Color(0xFF121212)
private val DarkSurfaceBright = Color(0xFF3A3A3A)
private val DarkSurfaceContainerLowest = Color(0xFF0D0D0D)
private val DarkSurfaceContainerLow = Color(0xFF1C1C1C)
private val DarkSurfaceContainer = Color(0xFF242424) // cards, nav bar
private val DarkSurfaceContainerHigh = Color(0xFF2E2E2E) // sheets, menus
private val DarkSurfaceContainerHighest = Color(0xFF383838)
private val DarkOutline = Color(0xFF3A3A3A)
private val DarkOutlineVariant = Color(0xFF2A2A2A)
private val DarkInverseSurface = Color(0xFFF5F5F5)
private val DarkInverseOnSurface = Color(0xFF1A1A1A)
private val DarkInversePrimary = Color(0xFF0D9488)
private val DarkScrim = Color(0xFF000000)

val ReverieLightColorScheme: ColorScheme = lightColorScheme(
    primary = LightPrimary,
    onPrimary = LightOnPrimary,
    primaryContainer = LightPrimaryContainer,
    onPrimaryContainer = LightOnPrimaryContainer,
    secondary = LightSecondary,
    onSecondary = LightOnSecondary,
    secondaryContainer = LightSecondaryContainer,
    onSecondaryContainer = LightOnSecondaryContainer,
    tertiary = LightTertiary,
    onTertiary = LightOnTertiary,
    tertiaryContainer = LightTertiaryContainer,
    onTertiaryContainer = LightOnTertiaryContainer,
    error = LightError,
    onError = LightOnError,
    errorContainer = LightErrorContainer,
    onErrorContainer = LightOnErrorContainer,
    background = LightBackground,
    onBackground = LightOnBackground,
    surface = LightSurface,
    onSurface = LightOnSurface,
    surfaceVariant = LightSurfaceVariant,
    onSurfaceVariant = LightOnSurfaceVariant,
    surfaceDim = LightSurfaceDim,
    surfaceBright = LightSurfaceBright,
    surfaceContainerLowest = LightSurfaceContainerLowest,
    surfaceContainerLow = LightSurfaceContainerLow,
    surfaceContainer = LightSurfaceContainer,
    surfaceContainerHigh = LightSurfaceContainerHigh,
    surfaceContainerHighest = LightSurfaceContainerHighest,
    outline = LightOutline,
    outlineVariant = LightOutlineVariant,
    inverseSurface = LightInverseSurface,
    inverseOnSurface = LightInverseOnSurface,
    inversePrimary = LightInversePrimary,
    scrim = LightScrim,
)

val ReverieDarkColorScheme: ColorScheme = darkColorScheme(
    primary = DarkPrimary,
    onPrimary = DarkOnPrimary,
    primaryContainer = DarkPrimaryContainer,
    onPrimaryContainer = DarkOnPrimaryContainer,
    secondary = DarkSecondary,
    onSecondary = DarkOnSecondary,
    secondaryContainer = DarkSecondaryContainer,
    onSecondaryContainer = DarkOnSecondaryContainer,
    tertiary = DarkTertiary,
    onTertiary = DarkOnTertiary,
    tertiaryContainer = DarkTertiaryContainer,
    onTertiaryContainer = DarkOnTertiaryContainer,
    error = DarkError,
    onError = DarkOnError,
    errorContainer = DarkErrorContainer,
    onErrorContainer = DarkOnErrorContainer,
    background = DarkBackground,
    onBackground = DarkOnBackground,
    surface = DarkSurface,
    onSurface = DarkOnSurface,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = DarkOnSurfaceVariant,
    surfaceDim = DarkSurfaceDim,
    surfaceBright = DarkSurfaceBright,
    surfaceContainerLowest = DarkSurfaceContainerLowest,
    surfaceContainerLow = DarkSurfaceContainerLow,
    surfaceContainer = DarkSurfaceContainer,
    surfaceContainerHigh = DarkSurfaceContainerHigh,
    surfaceContainerHighest = DarkSurfaceContainerHighest,
    outline = DarkOutline,
    outlineVariant = DarkOutlineVariant,
    inverseSurface = DarkInverseSurface,
    inverseOnSurface = DarkInverseOnSurface,
    inversePrimary = DarkInversePrimary,
    scrim = DarkScrim,
)

/**
 * Colors Material 3 has no role for: success / warning / info, plus the "card" alias whose
 * container level differs between light and dark. Provided via [LocalReverieColors].
 */
@Immutable
data class ReverieExtendedColors(
    val success: Color,
    val onSuccess: Color,
    val successContainer: Color,
    val onSuccessContainer: Color,
    val warning: Color,
    val onWarning: Color,
    val warningContainer: Color,
    val onWarningContainer: Color,
    val info: Color,
    val onInfo: Color,
    val infoContainer: Color,
    val onInfoContainer: Color,
    /** The semantic "card" surface — resolves to a different container level per theme. */
    val card: Color,
)

val LightExtendedColors = ReverieExtendedColors(
    success = Color(0xFF16A34A),
    onSuccess = Color(0xFFFFFFFF),
    successContainer = Color(0xFFDCF3E3),
    onSuccessContainer = Color(0xFF0A3D1E),
    warning = Color(0xFFD97706),
    onWarning = Color(0xFFFFFFFF),
    warningContainer = Color(0xFFFBEEDC),
    onWarningContainer = Color(0xFF5A3206),
    info = Color(0xFF2563EB),
    onInfo = Color(0xFFFFFFFF),
    infoContainer = Color(0xFFDEE9FC),
    onInfoContainer = Color(0xFF11296B),
    card = LightSurfaceContainerLowest,
)

val DarkExtendedColors = ReverieExtendedColors(
    success = Color(0xFF48BB78),
    onSuccess = Color(0xFF0A2313),
    successContainer = Color(0xFF173B26),
    onSuccessContainer = Color(0xFFC3EFD3),
    warning = Color(0xFFED8936),
    onWarning = Color(0xFF2A1705),
    warningContainer = Color(0xFF42301A),
    onWarningContainer = Color(0xFFFBDCB8),
    info = Color(0xFF4299E1),
    onInfo = Color(0xFF07223B),
    infoContainer = Color(0xFF16324A),
    onInfoContainer = Color(0xFFC9E1F7),
    card = DarkSurfaceContainer,
)

val LocalReverieColors = staticCompositionLocalOf { LightExtendedColors }
