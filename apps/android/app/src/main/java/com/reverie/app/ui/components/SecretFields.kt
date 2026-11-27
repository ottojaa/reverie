package com.reverie.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

const val PIN_LENGTH = 4

/** What was typed, as far as it is a PIN: its first four digits, 0 to 9. */
fun toPinDigits(typed: String): String = typed.filter { it in '0'..'9' }.take(PIN_LENGTH)

/** What the keyboard is told about a secret, so it neither suggests nor learns what is typed. */
private fun toSecretKeyboard(digits: Boolean, imeAction: ImeAction) = KeyboardOptions(
    keyboardType = if (digits) KeyboardType.NumberPassword else KeyboardType.Password,
    autoCorrectEnabled = false,
    imeAction = imeAction,
)

/** A masked field for a password, or with [digits] for a PIN. */
@Composable
fun SecretField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    digits: Boolean = false,
    enabled: Boolean = true,
    isError: Boolean = false,
    imeAction: ImeAction = ImeAction.Done,
    onDone: () -> Unit = {},
) {
    OutlinedTextField(
        shape = MaterialTheme.shapes.medium,
        value = value,
        onValueChange = { onValueChange(if (digits) toPinDigits(it) else it) },
        label = { Text(label) },
        singleLine = true,
        isError = isError,
        enabled = enabled,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = toSecretKeyboard(digits, imeAction),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * A PIN as four dots over an unseen field, which takes the focus as it appears. [onPinChange] gets at
 * most four digits.
 */
@Composable
fun PinEntry(pin: String, onPinChange: (String) -> Unit, isError: Boolean) {
    val focus = remember { FocusRequester() }
    BasicTextField(
        value = pin,
        onValueChange = { onPinChange(toPinDigits(it)) },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = toSecretKeyboard(digits = true, ImeAction.Done),
        cursorBrush = SolidColor(Color.Transparent),
        modifier = Modifier.fillMaxWidth().focusRequester(focus).semantics { contentDescription = "PIN" },
        decorationBox = { field ->
            Box(contentAlignment = Alignment.Center) {
                // The field has to be laid out for the keyboard to reach it.
                Box(Modifier.matchParentSize().alpha(0f)) { field() }
                PinDots(pin.length, isError)
            }
        },
    )
    LaunchedEffect(focus) { focus.requestFocus() }
}

@Composable
private fun PinDots(filled: Int, isError: Boolean) {
    val colour = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
    Row(Modifier.padding(vertical = 16.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
        repeat(PIN_LENGTH) { index ->
            val fill = if (index < filled) colour else Color.Transparent
            Box(Modifier.size(18.dp).background(fill, CircleShape).border(2.dp, colour, CircleShape))
        }
    }
}
