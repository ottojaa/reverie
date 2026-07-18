package com.reverie.app.ui.screens.settings

import android.os.Build
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.BuildConfig
import com.reverie.app.data.api.model.UserDto
import com.reverie.app.domain.model.AuthState
import com.reverie.app.ui.components.ConfirmDialog
import com.reverie.app.ui.components.ServerUrlDialog
import com.reverie.app.ui.components.StorageMeter
import com.reverie.app.ui.theme.ReverieTheme
import com.reverie.app.ui.theme.ThemeMode

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
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
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
