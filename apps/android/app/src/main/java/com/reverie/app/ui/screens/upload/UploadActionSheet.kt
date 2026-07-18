package com.reverie.app.ui.screens.upload

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.reverie.app.data.upload.MediaAsset
import java.io.File
import java.util.UUID

/** FAB action sheet: Scan / Take photo / Photos & videos / Files, each wiring the right picker. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UploadActionSheet(
    onFilesPicked: (List<Uri>) -> Unit,
    loadMedia: suspend () -> List<MediaAsset>,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState()
    var showMediaPicker by remember { mutableStateOf(false) }
    var cameraUri by remember { mutableStateOf<Uri?>(null) }

    val documentsLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        if (uris.isNotEmpty()) { onFilesPicked(uris); onDismiss() }
    }

    val takePicture = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicture(),
    ) { success ->
        val uri = cameraUri
        if (success && uri != null) { onFilesPicked(listOf(uri)); onDismiss() }
    }

    fun launchCamera() {
        val uri = createCaptureUri(context)
        cameraUri = uri
        takePicture.launch(uri)
    }

    val cameraPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (granted) launchCamera() }

    val mediaPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result -> if (result.values.any { it }) showMediaPicker = true }

    val scan = rememberDocumentScanLauncher(
        onScanned = { uris -> onFilesPicked(uris); onDismiss() },
        onUnavailable = { requestCameraThenCapture(context, cameraPermission::launch, ::launchCamera) },
    )

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(bottom = 16.dp),
        ) {
            Text(
                "Add to Reverie",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            ActionRow(Icons.Outlined.DocumentScanner, "Scan document", onClick = scan)
            ActionRow(Icons.Outlined.CameraAlt, "Take photo") {
                requestCameraThenCapture(context, cameraPermission::launch, ::launchCamera)
            }
            ActionRow(Icons.Outlined.PhotoLibrary, "Photos & videos") {
                requestMediaThenPick(context, mediaPermission::launch) { showMediaPicker = true }
            }
            ActionRow(Icons.Outlined.Folder, "Files") {
                documentsLauncher.launch(arrayOf("application/pdf", "image/*", "video/*", "audio/*", "text/*", "application/*"))
            }
        }
    }

    if (showMediaPicker) {
        MediaPickerSheet(
            loadMedia = loadMedia,
            onConfirm = { uris -> onFilesPicked(uris); showMediaPicker = false; onDismiss() },
            onDismiss = { showMediaPicker = false },
        )
    }
}

@Composable
private fun ActionRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 16.dp))
    }
}

private fun createCaptureUri(context: Context): Uri {
    val dir = File(context.filesDir, "captures").apply { mkdirs() }
    val file = File(dir, "capture_${UUID.randomUUID()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
}

private fun requestCameraThenCapture(context: Context, requestPermission: (String) -> Unit, capture: () -> Unit) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
        capture()
    } else {
        requestPermission(Manifest.permission.CAMERA)
    }
}

private fun requestMediaThenPick(context: Context, requestPermissions: (Array<String>) -> Unit, showPicker: () -> Unit) {
    val permissions = mediaPermissions()
    val granted = permissions.any {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }
    if (granted) showPicker() else requestPermissions(permissions)
}

private fun mediaPermissions(): Array<String> = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
    arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.ACCESS_MEDIA_LOCATION)
} else {
    arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.ACCESS_MEDIA_LOCATION)
}
