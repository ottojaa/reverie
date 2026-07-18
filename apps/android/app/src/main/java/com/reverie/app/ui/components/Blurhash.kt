package com.reverie.app.ui.components

import android.graphics.Bitmap
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.graphics.painter.Painter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.cos
import kotlin.math.PI
import kotlin.math.withSign

/**
 * Minimal BlurHash decoder (Wolt algorithm). Decodes to a tiny bitmap used as an instant
 * placeholder behind the real thumbnail. Kept small (32×24) and cached so fast-scrolling
 * grids stay smooth.
 */
object BlurhashDecoder {
    private val charMap = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#\$%*+,-.:;=?@[]^_{|}~"
        .withIndex().associate { (i, c) -> c to i }

    fun decode(blurHash: String?, width: Int, height: Int, punch: Float = 1f): Bitmap? {
        if (blurHash == null || blurHash.length < 6) return null
        val numCompEnc = decode83(blurHash, 0, 1) ?: return null
        val numCompX = (numCompEnc % 9) + 1
        val numCompY = (numCompEnc / 9) + 1
        if (blurHash.length != 4 + 2 * numCompX * numCompY) return null

        val maxAcEnc = decode83(blurHash, 1, 2) ?: return null
        val maxAc = (maxAcEnc + 1) / 166f
        val colors = Array(numCompX * numCompY) { i ->
            if (i == 0) {
                decodeDc(decode83(blurHash, 2, 6) ?: return null)
            } else {
                val from = 4 + i * 2
                decodeAc(decode83(blurHash, from, from + 2) ?: return null, maxAc * punch)
            }
        }

        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val cosX = FloatArray(width * numCompX)
        val cosY = FloatArray(height * numCompY)
        for (x in 0 until width) for (i in 0 until numCompX) {
            cosX[x * numCompX + i] = cos(PI * x * i / width).toFloat()
        }
        for (y in 0 until height) for (j in 0 until numCompY) {
            cosY[y * numCompY + j] = cos(PI * y * j / height).toFloat()
        }

        for (y in 0 until height) {
            for (x in 0 until width) {
                var r = 0f; var g = 0f; var b = 0f
                for (j in 0 until numCompY) {
                    for (i in 0 until numCompX) {
                        val basis = cosX[x * numCompX + i] * cosY[y * numCompY + j]
                        val color = colors[j * numCompX + i]
                        r += color[0] * basis
                        g += color[1] * basis
                        b += color[2] * basis
                    }
                }
                bitmap.setPixel(x, y, 0xFF shl 24 or (linearToSrgb(r) shl 16) or (linearToSrgb(g) shl 8) or linearToSrgb(b))
            }
        }
        return bitmap
    }

    private fun decode83(str: String, from: Int, to: Int): Int? {
        var result = 0
        for (i in from until to) {
            val value = charMap[str[i]] ?: return null
            result = result * 83 + value
        }
        return result
    }

    private fun decodeDc(colorEnc: Int): FloatArray = floatArrayOf(
        srgbToLinear(colorEnc shr 16 and 0xFF),
        srgbToLinear(colorEnc shr 8 and 0xFF),
        srgbToLinear(colorEnc and 0xFF),
    )

    private fun decodeAc(value: Int, maxAc: Float): FloatArray {
        val r = value / (19 * 19)
        val g = value / 19 % 19
        val b = value % 19
        return floatArrayOf(
            signPow((r - 9) / 9f) * maxAc,
            signPow((g - 9) / 9f) * maxAc,
            signPow((b - 9) / 9f) * maxAc,
        )
    }

    private fun signPow(value: Float): Float = (value * value).withSign(value)

    private fun srgbToLinear(value: Int): Float {
        val v = value / 255f
        return if (v <= 0.04045f) v / 12.92f else Math.pow(((v + 0.055) / 1.055), 2.4).toFloat()
    }

    private fun linearToSrgb(value: Float): Int {
        val v = value.coerceIn(0f, 1f)
        val srgb = if (v <= 0.0031308f) v * 12.92f else 1.055f * Math.pow(v.toDouble(), 1 / 2.4).toFloat() - 0.055f
        return (srgb * 255 + 0.5f).toInt().coerceIn(0, 255)
    }
}

private val painterCache = LruCache<String, BitmapPainter>(128)

/** Decodes [blurhash] off the main thread and remembers the resulting painter, cached by hash. */
@Composable
fun rememberBlurhashPainter(blurhash: String?): Painter? {
    if (blurhash.isNullOrBlank()) return null
    val state = produceState<Painter?>(initialValue = painterCache.get(blurhash), blurhash) {
        if (value != null) return@produceState
        val bitmap = withContext(Dispatchers.Default) { BlurhashDecoder.decode(blurhash, 32, 24) }
        if (bitmap != null) {
            val painter = BitmapPainter(bitmap.asImageBitmap())
            painterCache.put(blurhash, painter)
            value = painter
        }
    }
    return state.value
}
