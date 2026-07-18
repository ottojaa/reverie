package com.reverie.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.core.content.IntentCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.reverie.app.domain.model.AuthState
import com.reverie.app.ui.AppViewModel
import com.reverie.app.ui.screens.upload.UploadReviewSheet
import com.reverie.app.ui.screens.upload.UploadViewModel
import com.reverie.app.ui.theme.ReverieTheme
import dagger.hilt.android.AndroidEntryPoint

/** Receives files shared from other apps and drops the user straight into the upload review. */
@AndroidEntryPoint
class ShareReceiverActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val uris = extractUris(intent)

        setContent {
            val appViewModel: AppViewModel = hiltViewModel()
            val uploadViewModel: UploadViewModel = hiltViewModel()
            val settings by appViewModel.settings.collectAsStateWithLifecycle()
            val authState by appViewModel.authState.collectAsStateWithLifecycle()
            val review by uploadViewModel.review.collectAsStateWithLifecycle()
            var started by remember { mutableStateOf(false) }

            ReverieTheme(themeMode = settings.themeMode, dynamicColor = settings.dynamicColor) {
                Surface(modifier = Modifier.fillMaxSize(), color = Color.Transparent) {
                    LaunchedEffect(authState, uris) {
                        when (authState) {
                            is AuthState.Authenticated -> if (!started && uris.isNotEmpty()) {
                                uploadViewModel.beginReview(uris, null)
                                started = true
                            }
                            is AuthState.LoggedOut -> {
                                Toast.makeText(this@ShareReceiverActivity, "Sign in to Reverie first", Toast.LENGTH_LONG).show()
                                finish()
                            }
                            AuthState.Unknown -> Unit
                        }
                    }
                    LaunchedEffect(review, started) {
                        if (started && review == null) finish()
                    }
                    UploadReviewSheet(viewModel = uploadViewModel)
                }
            }
        }
    }

    private fun extractUris(intent: Intent): List<Uri> = when (intent.action) {
        Intent.ACTION_SEND ->
            listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
        Intent.ACTION_SEND_MULTIPLE ->
            IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java) ?: emptyList()
        else -> emptyList()
    }
}
