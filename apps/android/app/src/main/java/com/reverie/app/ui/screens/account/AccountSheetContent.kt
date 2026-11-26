package com.reverie.app.ui.screens.account

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.reverie.app.data.api.model.UserDto
import com.reverie.app.ui.components.StorageMeter
import com.reverie.app.ui.components.backupIcon
import com.reverie.app.ui.components.backupLine
import com.reverie.app.ui.theme.ReverieTheme


/** Who is signed in, backup and storage, and the ways on from there. */
@Composable
internal fun AccountSheetContent(state: AccountState, links: AccountLinks, onSignOut: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 20.dp),
    ) {
        state.user?.let { Identity(it) }
        Column(
            Modifier.padding(top = 20.dp, bottom = 12.dp).fillMaxWidth().clip(MaterialTheme.shapes.large)
                .background(ReverieTheme.cardColor),
        ) {
            BackupRow(state, links.onOpenBackup)
            state.user?.let {
                StorageMeter(it.storage_used_bytes, it.storage_quota_bytes, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp))
            }
        }
        SheetRow(Icons.Outlined.Lock, "Private folders", links.onOpenPrivateFolders)
        SheetRow(Icons.Outlined.Tune, "Settings", links.onOpenSettings)
        SheetRow(Icons.AutoMirrored.Outlined.Logout, "Sign out", onSignOut)
    }
}

@Composable
private fun Identity(user: UserDto) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Circle(48, MaterialTheme.colorScheme.surfaceContainerHighest) {
            Icon(Icons.Outlined.Person, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column {
            Text(user.display_name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Secondary(user.email)
        }
    }
}

@Composable
private fun BackupRow(state: AccountState, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Circle(40, MaterialTheme.colorScheme.primaryContainer) {
            Icon(
                backupIcon(state.backup),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(22.dp),
            )
        }
        Column(Modifier.weight(1f)) {
            Text(backupLine(state.backup, total = null) ?: "Photo backup", fontSize = 15.sp, fontWeight = FontWeight.Medium)
            if (state.backupDetail.isNotEmpty()) Secondary(state.backupDetail)
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun Circle(size: Int, color: Color, content: @Composable () -> Unit) {
    Box(Modifier.size(size.dp).background(color, CircleShape), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun Secondary(text: String) {
    Text(
        text,
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun SheetRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clip(MaterialTheme.shapes.medium).clickable(role = Role.Button, onClick = onClick)
            .heightIn(min = 52.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
        Text(label, fontSize = 15.sp)
    }
}
