package com.reverie.app.ui.screens.settings

import android.os.Build
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.BuildConfig
import com.reverie.app.data.api.model.UserDto
import com.reverie.app.data.settings.AppSettings
import com.reverie.app.data.settings.MOSAIC_FEATURE_EVERY_MAX
import com.reverie.app.data.settings.MOSAIC_FEATURE_EVERY_MIN
import com.reverie.app.domain.model.AuthState
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.components.ServerUrlDialog
import com.reverie.app.ui.components.StorageMeter
import com.reverie.app.ui.navigation.EasingPreset
import com.reverie.app.ui.navigation.bottomBarInset
import com.reverie.app.ui.navigation.toEasingPreset
import com.reverie.app.ui.theme.ReverieTheme
import com.reverie.app.ui.theme.ThemeMode
import kotlin.math.roundToInt

@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    onChangePassword: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val authState by viewModel.authState.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val vault by viewModel.vault.collectAsStateWithLifecycle()
    val user = (authState as? AuthState.Authenticated)?.user
    val context = androidx.compose.ui.platform.LocalContext.current

    var showSignOut by remember { mutableStateOf(false) }
    var showServerDialog by remember { mutableStateOf(false) }
    var showVaultUnlock by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 16.dp + bottomBarInset()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = "Settings",
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.padding(start = 4.dp, top = 8.dp),
        )

        if (user != null) {
            SettingsCard(title = "Account") {
                AccountRow(user)
                Spacer(Modifier.height(16.dp))
                StorageMeter(usedBytes = user.storage_used_bytes, quotaBytes = user.storage_quota_bytes)
            }
        }

        SettingsCard(title = "Appearance") {
            Text("Theme", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(8.dp))
            ThemeModeSelector(
                selected = settings.themeMode,
                onSelect = viewModel::setThemeMode,
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Spacer(Modifier.height(16.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Use device colors", style = MaterialTheme.typography.titleSmall)
                        Text(
                            "Match your wallpaper (Material You)",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = settings.dynamicColor,
                        onCheckedChange = viewModel::setDynamicColor,
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Hide navigation while scrolling", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "Slide the bottom bar away as you scroll down a list",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = settings.hideNavOnScroll,
                    onCheckedChange = viewModel::setHideNavOnScroll,
                )
            }
            Spacer(Modifier.height(4.dp))
            var featureEvery by remember(settings.mosaicFeatureEvery) { mutableStateOf(settings.mosaicFeatureEvery.toFloat()) }
            LabeledSlider(
                label = "Featured tiles in Files",
                description = "How often a photo gets a larger tile in the grid. Lower is livelier; higher is calmer.",
                valueLabel = "every ${featureEvery.roundToInt()} photos",
                value = featureEvery,
                range = MOSAIC_FEATURE_EVERY_MIN.toFloat()..MOSAIC_FEATURE_EVERY_MAX.toFloat(),
                steps = MOSAIC_FEATURE_EVERY_MAX - MOSAIC_FEATURE_EVERY_MIN - 1,
                onChange = { featureEvery = it },
                onCommit = { viewModel.setMosaicFeatureEvery(featureEvery.roundToInt()) },
            )
        }

        if (vault?.has_password == true) {
            SettingsCard(title = "Privacy") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Hide private items", style = MaterialTheme.typography.titleSmall)
                        Text(
                            "Keep private files out of the sidebar until unlocked",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = vault?.hide_enabled == true,
                        onCheckedChange = { enabled ->
                            if (!enabled && vault?.unlocked != true) showVaultUnlock = true
                            else viewModel.setHidePrivate(enabled)
                        },
                    )
                }
                if (vault?.hide_enabled == true) {
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (vault?.unlocked == true) "Private items are visible" else "Private items are hidden",
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f),
                        )
                        if (vault?.unlocked == true) {
                            TextButton(onClick = viewModel::lockVault) { Text("Lock now") }
                        } else {
                            TextButton(onClick = { showVaultUnlock = true }) { Text("Reveal") }
                        }
                    }
                }
            }
        }

        SettingsCard(title = "Security") {
            Row(
                modifier = Modifier.fillMaxWidth().clickable(onClick = onChangePassword),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Change password", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        SettingsCard(title = "Storage & data") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Clear cache", style = MaterialTheme.typography.titleSmall)
                    Text("Remove cached previews and files", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = {
                    viewModel.clearCache {
                        android.widget.Toast.makeText(context, "Cache cleared", android.widget.Toast.LENGTH_SHORT).show()
                    }
                }) { Text("Clear") }
            }
        }

        SettingsCard(title = "Server") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Outlined.Dns,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Server address", style = MaterialTheme.typography.titleSmall)
                    Text(
                        text = settings.serverUrlOverride ?: BuildConfig.DEFAULT_SERVER_URL,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                TextButton(onClick = { showServerDialog = true }) { Text("Edit") }
            }
        }

        // TEMPORARY / DEV TUNING — collapsible animation controls (debug builds only). See MotionSpec.kt.
        if (BuildConfig.DEBUG) {
            var animExpanded by remember { mutableStateOf(false) }
            SettingsCard(title = "Animation settings") {
                Row(
                    modifier = Modifier.fillMaxWidth().clickable { animExpanded = !animExpanded },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Transition tuning", style = MaterialTheme.typography.titleSmall)
                        Text(
                            "Fine-tune the durations and curves used across the app's animations.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    val rotation by animateFloatAsState(if (animExpanded) 180f else 0f, label = "chevron")
                    Icon(
                        Icons.Outlined.KeyboardArrowDown,
                        contentDescription = if (animExpanded) "Collapse" else "Expand",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.rotate(rotation),
                    )
                }
                AnimatedVisibility(visible = animExpanded) {
                    Column {
                        Spacer(Modifier.height(12.dp))
                        MotionDevControls(
                            settings = settings,
                            onCommit = viewModel::setMotion,
                            onReset = viewModel::resetMotion,
                        )
                    }
                }
            }
        }

        OutlinedButton(
            onClick = { showSignOut = true },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(
                Icons.AutoMirrored.Outlined.Logout,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.size(8.dp))
            Text("Sign out")
        }

        Text(
            text = "Reverie ${BuildConfig.VERSION_NAME}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp, bottom = 24.dp),
        )
    }

    if (showSignOut) {
        ConfirmDialog(
            title = "Sign out?",
            message = "You'll need to sign in again to access your documents.",
            confirmLabel = "Sign out",
            destructive = true,
            onConfirm = {
                showSignOut = false
                viewModel.signOut()
            },
            onDismiss = { showSignOut = false },
        )
    }

    if (showServerDialog) {
        ServerUrlDialog(
            currentUrl = settings.serverUrlOverride ?: BuildConfig.DEFAULT_SERVER_URL,
            onConfirm = {
                viewModel.setServerUrl(it.ifBlank { null })
                showServerDialog = false
            },
            onDismiss = { showServerDialog = false },
        )
    }

    if (showVaultUnlock) {
        com.reverie.app.ui.components.VaultUnlockSheet(
            onUnlock = { password, onResult -> viewModel.unlockVault(password, onResult) },
            onDismiss = { showVaultUnlock = false },
        )
    }
}

@Composable
private fun SettingsCard(title: String, content: @Composable () -> Unit) {
    Column {
        Text(
            text = title,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
        )
        Surface(
            color = ReverieTheme.cardColor,
            shape = MaterialTheme.shapes.medium,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp)) { content() }
        }
    }
}

@Composable
private fun AccountRow(user: UserDto) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(
            color = MaterialTheme.colorScheme.primaryContainer,
            shape = CircleShape,
            modifier = Modifier.size(44.dp),
        ) {
            Text(
                text = user.display_name.take(1).uppercase(),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp),
            )
        }
        Spacer(Modifier.size(12.dp))
        Column(Modifier.weight(1f)) {
            Text(user.display_name, style = MaterialTheme.typography.titleSmall)
            Text(
                user.email,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ThemeModeSelector(
    selected: ThemeMode,
    onSelect: (ThemeMode) -> Unit,
) {
    val options = listOf(ThemeMode.SYSTEM to "System", ThemeMode.LIGHT to "Light", ThemeMode.DARK to "Dark")
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        options.forEachIndexed { index, (mode, label) ->
            SegmentedButton(
                selected = selected == mode,
                onClick = { onSelect(mode) },
                shape = SegmentedButtonDefaults.itemShape(index = index, count = options.size),
            ) {
                Text(label)
            }
        }
    }
}

// TEMPORARY / DEV TUNING — live motion controls. Delete along with MotionSpec.kt once tuned.
@Composable
private fun MotionDevControls(
    settings: AppSettings,
    onCommit: (AppSettings) -> Unit,
    onReset: () -> Unit,
) {
    // Local slider state, re-seeded whenever the persisted value changes (commit or reset), so
    // dragging never persists mid-gesture yet reset snaps the sliders back to defaults.
    var navMs by remember(settings.motionNavMs) { mutableStateOf(settings.motionNavMs.toFloat()) }
    var slideFraction by remember(settings.motionSlideFraction) { mutableStateOf(settings.motionSlideFraction) }
    var popScale by remember(settings.motionPopScale) { mutableStateOf(settings.motionPopScale) }
    var diveMs by remember(settings.motionDiveMs) { mutableStateOf(settings.motionDiveMs.toFloat()) }
    var barEnterMs by remember(settings.motionBarEnterMs) { mutableStateOf(settings.motionBarEnterMs.toFloat()) }
    var toolbarExitMs by remember(settings.motionToolbarExitMs) { mutableStateOf(settings.motionToolbarExitMs.toFloat()) }

    Text(
        "Directional transitions preview on the next navigation; dive/bar/toolbar update live.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(12.dp))

    LabeledSlider("Nav duration", "Length of page-to-page transitions (tabs, opening a folder).",
        "${navMs.toInt()} ms", navMs, 100f..600f,
        onChange = { navMs = it }, onCommit = { onCommit(settings.copy(motionNavMs = navMs.toInt())) })
    LabeledSlider("Slide fraction", "How far pages travel as they slide (0 = a pure fade).",
        String.format(java.util.Locale.US, "%.2f", slideFraction), slideFraction, 0f..0.30f,
        onChange = { slideFraction = it }, onCommit = { onCommit(settings.copy(motionSlideFraction = slideFraction)) })
    LabeledSlider("Pop scale", "How much the previous screen shrinks during a back-swipe.",
        String.format(java.util.Locale.US, "%.2f", popScale), popScale, 0.80f..1.0f,
        onChange = { popScale = it }, onCommit = { onCommit(settings.copy(motionPopScale = popScale)) })
    LabeledSlider("Dive duration", "Length of the document open/close expand.",
        "${diveMs.toInt()} ms", diveMs, 150f..700f,
        onChange = { diveMs = it }, onCommit = { onCommit(settings.copy(motionDiveMs = diveMs.toInt())) })
    LabeledSlider("Bar enter", "How quickly the bottom navigation slides back in.",
        "${barEnterMs.toInt()} ms", barEnterMs, 100f..500f,
        onChange = { barEnterMs = it }, onCommit = { onCommit(settings.copy(motionBarEnterMs = barEnterMs.toInt())) })
    LabeledSlider("Toolbar exit", "How quickly the viewer's top bar slides away on back.",
        "${toolbarExitMs.toInt()} ms", toolbarExitMs, 100f..400f,
        onChange = { toolbarExitMs = it }, onCommit = { onCommit(settings.copy(motionToolbarExitMs = toolbarExitMs.toInt())) })

    Spacer(Modifier.height(12.dp))
    EasingSetting(
        title = "Directional easing",
        description = "Speed curve for page-to-page transitions.",
        selected = settings.motionDirectionalEasing.toEasingPreset(),
        onSelect = { onCommit(settings.copy(motionDirectionalEasing = it.name)) },
    )
    Spacer(Modifier.height(12.dp))
    EasingSetting(
        title = "Dive easing",
        description = "Speed curve for the document open/close expand.",
        selected = settings.motionDiveEasing.toEasingPreset(),
        onSelect = { onCommit(settings.copy(motionDiveEasing = it.name)) },
    )

    Spacer(Modifier.height(8.dp))
    TextButton(onClick = onReset) { Text("Reset to defaults") }
}

@Composable
private fun EasingSetting(
    title: String,
    description: String,
    selected: EasingPreset,
    onSelect: (EasingPreset) -> Unit,
) {
    Text(title, style = MaterialTheme.typography.titleSmall)
    Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Spacer(Modifier.height(6.dp))
    EasingChips(selected = selected, onSelect = onSelect)
}

@Composable
private fun LabeledSlider(
    label: String,
    description: String,
    valueLabel: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    onChange: (Float) -> Unit,
    onCommit: () -> Unit,
    steps: Int = 0,
) {
    Column(Modifier.padding(top = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Text(valueLabel, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Slider(
            value = value,
            onValueChange = onChange,
            valueRange = range,
            steps = steps,
            onValueChangeFinished = onCommit,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EasingChips(selected: EasingPreset, onSelect: (EasingPreset) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        EasingPreset.entries.forEach { preset ->
            FilterChip(
                selected = selected == preset,
                onClick = { onSelect(preset) },
                label = { Text(preset.displayName(), style = MaterialTheme.typography.labelSmall) },
            )
        }
    }
}
