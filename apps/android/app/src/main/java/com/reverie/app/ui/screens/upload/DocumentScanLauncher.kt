package com.reverie.app.ui.screens.upload

import android.app.Activity
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import com.google.mlkit.vision.documentscanner.GmsDocumentScanner
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult

/**
 * Returns a lambda that launches the ML Kit document scanner (GMS-provided edge detection,
 * multi-page, JPEG output — no camera permission). [onScanned] receives the page image URIs;
 * [onUnavailable] fires when GMS/the module isn't available so callers can fall back.
 */
@Composable
fun rememberDocumentScanLauncher(
    onScanned: (List<Uri>) -> Unit,
    onUnavailable: () -> Unit,
): () -> Unit {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) { result ->
        val pages = GmsDocumentScanningResult.fromActivityResultIntent(result.data)?.pages
        val uris = pages?.mapNotNull { it.imageUri } ?: emptyList()
        if (uris.isNotEmpty()) onScanned(uris)
    }

    return start@{
        val activity = context as? Activity ?: run { onUnavailable(); return@start }
        val options = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(false)
            .setPageLimit(20)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build()
        val scanner: GmsDocumentScanner = GmsDocumentScanning.getClient(options)
        scanner.getStartScanIntent(activity)
            .addOnSuccessListener { intentSender ->
                launcher.launch(IntentSenderRequest.Builder(intentSender).build())
            }
            .addOnFailureListener { onUnavailable() }
    }
}
