package com.reverie.app.ui.screens.browse

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.ide.common.rendering.api.SessionParams
import com.android.resources.NightMode
import org.junit.Rule
import org.junit.Test

/** The sheet in dark mode, where the stage line's colours have the least contrast to spare. */
class ProcessingSheetNightScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.PIXEL_5.copy(nightMode = NightMode.NIGHT),
        renderingMode = SessionParams.RenderingMode.SHRINK,
    )

    @Test fun populated() = paparazzi.snapshot { ProcessingSheetPopulatedPreview() }
}
