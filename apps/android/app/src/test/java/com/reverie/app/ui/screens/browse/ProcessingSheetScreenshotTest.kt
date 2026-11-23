package com.reverie.app.ui.screens.browse

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.android.ide.common.rendering.api.SessionParams
import org.junit.Rule
import org.junit.Test

class ProcessingSheetScreenshotTest {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = DeviceConfig.PIXEL_5, renderingMode = SessionParams.RenderingMode.SHRINK)

    @Test fun populated() = paparazzi.snapshot { ProcessingSheetPopulatedPreview() }

    @Test fun loadingMore() = paparazzi.snapshot { ProcessingSheetLoadingMorePreview() }

    @Test fun empty() = paparazzi.snapshot { ProcessingSheetEmptyPreview() }
}
