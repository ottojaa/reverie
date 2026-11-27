package com.reverie.app.ui

import android.text.InputType
import android.view.inputmethod.EditorInfo
import androidx.compose.runtime.Composable
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.platform.InterceptPlatformTextInput
import kotlinx.coroutines.awaitCancellation
import org.junit.Assert.assertEquals

/** What the keyboard is told about the field that took the focus last, for content under [Capturing]. */
internal class CapturedKeyboard {
    @Volatile var inputType: Int? = null

    @OptIn(ExperimentalComposeUiApi::class)
    @Composable
    fun Capturing(content: @Composable () -> Unit) {
        InterceptPlatformTextInput(
            interceptor = { request, _ ->
                val info = EditorInfo()
                request.createInputConnection(info)
                inputType = info.inputType
                awaitCancellation()
            },
            content = content,
        )
    }

    /** A masked number keyboard. */
    fun assertForPin() = assertEquals(InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD, kind())

    /** A password keyboard that neither corrects nor suggests. */
    fun assertForPassword() {
        assertEquals(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD, kind())
        assertEquals(0, checkNotNull(inputType) and InputType.TYPE_TEXT_FLAG_AUTO_CORRECT)
    }

    private fun kind(): Int = checkNotNull(inputType) { "No field has asked for a keyboard" } and
        (InputType.TYPE_MASK_CLASS or InputType.TYPE_MASK_VARIATION)
}
