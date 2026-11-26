package com.reverie.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

/** The corner of a thumbnail, a row's picture, a field or a panel; also what a selected grid tile rounds to. */
val MEDIUM_CORNER = 12.dp

/**
 * One radius per role: meter bars extraSmall; badges on pictures small; thumbnails, row pictures,
 * fields and inline panels medium; cards and cover tiles large; sheets extraLarge. Chips, pills and
 * round buttons are fully round (`CircleShape`).
 */
val ReverieShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(MEDIUM_CORNER),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(24.dp),
)
