package com.reverie.app.ui.screens.account

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.reverie.app.ui.snapshotThemes
import org.junit.Rule
import org.junit.Test

/** The avatar's sheet, dark and light, drawn where the bottom sheet puts it. */
class AccountScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5)

    @Test fun accountSheet() {
        paparazzi.snapshotThemes("accountSheet") {
            Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), Alignment.BottomCenter) {
                Box(
                    Modifier.background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                        .padding(top = 24.dp),
                ) {
                    AccountSheetContent(signedIn, AccountLinks({}, {}, {}), onSignOut = {})
                }
            }
        }
    }
}
