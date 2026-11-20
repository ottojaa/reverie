package com.reverie.app.data.backup

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/** How much of the photo library the app is allowed to see. */
enum class MediaAccess {
    /** All photos and videos. */
    Full,

    /** Android 14+ "selected photos" (or only photos or only videos): backup can only see part of the library. */
    Limited,

    None,
}

private fun Context.isGranted(permission: String) =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

fun Context.mediaAccess(): MediaAccess {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        return if (isGranted(Manifest.permission.READ_EXTERNAL_STORAGE)) MediaAccess.Full else MediaAccess.None
    }
    val images = isGranted(Manifest.permission.READ_MEDIA_IMAGES)
    val video = isGranted(Manifest.permission.READ_MEDIA_VIDEO)
    if (images && video) return MediaAccess.Full
    // Android 14 adds a third grant, "selected photos", which can't see the whole library.
    val selected = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
        isGranted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
    return if (images || video || selected) MediaAccess.Limited else MediaAccess.None
}

/** Reading an original with its GPS position needs this on Android 10+; older versions have no such rule. */
fun Context.canReadLocation(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || isGranted(Manifest.permission.ACCESS_MEDIA_LOCATION)

/** What to ask the user for in one go, for this Android version. */
fun backupPermissionsToRequest(): Array<String> = buildList {
    when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> {
            add(Manifest.permission.READ_MEDIA_IMAGES)
            add(Manifest.permission.READ_MEDIA_VIDEO)
            add(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
        }
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> {
            add(Manifest.permission.READ_MEDIA_IMAGES)
            add(Manifest.permission.READ_MEDIA_VIDEO)
        }
        else -> add(Manifest.permission.READ_EXTERNAL_STORAGE)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) add(Manifest.permission.ACCESS_MEDIA_LOCATION)
}.toTypedArray()
