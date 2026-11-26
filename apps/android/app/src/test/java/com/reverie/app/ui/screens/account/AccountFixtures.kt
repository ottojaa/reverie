package com.reverie.app.ui.screens.account

import com.reverie.app.data.api.model.UserDto
import com.reverie.app.data.api.model.UserRole
import com.reverie.app.data.backup.BackupStatus

private const val GIB = 1024L * 1024 * 1024

internal val signedIn = AccountState(
    user = UserDto(
        id = "u1", email = "maria.oliveira-santos@example.com", display_name = "Maria Oliveira-Santos",
        storage_quota_bytes = 1024 * GIB, storage_used_bytes = 22 * GIB + GIB * 3 / 10, is_active = true,
        role = UserRole.ADMIN, created_at = "2026-01-04T10:00:00.000Z",
    ),
    backup = BackupStatus.Complete,
    backupDetail = "Camera · Wi-Fi only",
)
