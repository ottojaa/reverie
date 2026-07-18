package com.reverie.app.data.api

import kotlinx.serialization.json.Json

/**
 * The single JSON configuration used by the Ktor client and every ad-hoc decode.
 *
 * - `ignoreUnknownKeys`: server may add fields the client doesn't model yet.
 * - `explicitNulls = false`: omit nulls when encoding request bodies.
 * - `coerceInputValues`: fall back to defaults for malformed values instead of throwing.
 * - `isLenient`: tolerate minor spec drift (e.g. numbers as strings).
 */
val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    isLenient = true
}
