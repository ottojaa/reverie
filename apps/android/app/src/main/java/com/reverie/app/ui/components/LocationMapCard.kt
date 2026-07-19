package com.reverie.app.ui.components

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.maps.GoogleMapOptions
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.MapStyleOptions
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.rememberCameraPositionState
import com.google.maps.android.compose.rememberMarkerState
import com.reverie.app.BuildConfig
import com.reverie.app.R
import com.reverie.app.ui.theme.ReverieTheme

/**
 * A Google-Photos-style location card: a static (lite-mode) map with a pin over a footer row
 * naming the place; tapping the whole card opens Google Maps. Lite mode renders a bitmap (no GL
 * surface, no gesture handling), which is exactly the pattern for a map inside a scrolling
 * container — so there's no gesture conflict with the details panel.
 *
 * Degrades gracefully to the footer row alone (no map) when no [BuildConfig.MAPS_API_KEY] is
 * configured, Play services are unavailable, or coordinates are missing.
 */
@Composable
fun LocationMapCard(
    latitude: Double?,
    longitude: Double?,
    placeName: String,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val hasCoords = latitude != null && longitude != null
    val canShowMap = hasCoords &&
        BuildConfig.MAPS_API_KEY.isNotBlank() &&
        remember { isPlayServicesAvailable(context) }

    val onOpen: () -> Unit = {
        if (hasCoords) openInMaps(context, latitude!!, longitude!!, placeName)
        else openMapsSearch(context, placeName)
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.medium)
            .background(ReverieTheme.cardColor)
            .clickable(onClickLabel = "Open $placeName in Google Maps", onClick = onOpen),
    ) {
        if (canShowMap) {
            MapPreview(latitude = latitude!!, longitude = longitude!!, onTap = onOpen)
        }
        LocationFooter(placeName)
    }
}

@Composable
private fun MapPreview(latitude: Double, longitude: Double, onTap: () -> Unit) {
    val context = LocalContext.current
    // Track the resolved theme, not just the system setting, so a forced light/dark override matches.
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    val latLng = remember(latitude, longitude) { LatLng(latitude, longitude) }
    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(latLng, 13.5f)
    }
    val mapStyle = remember(dark) {
        if (dark) MapStyleOptions.loadRawResourceStyle(context, R.raw.map_style_dark) else null
    }
    // Lite mode still injects its own tap-to-open-Maps behaviour and a map toolbar; disable the
    // toolbar and overlay our own tap target so the whole card opens Maps predictably.
    val uiSettings = remember {
        MapUiSettings(
            compassEnabled = false,
            indoorLevelPickerEnabled = false,
            mapToolbarEnabled = false,
            myLocationButtonEnabled = false,
            rotationGesturesEnabled = false,
            scrollGesturesEnabled = false,
            scrollGesturesEnabledDuringRotateOrZoom = false,
            tiltGesturesEnabled = false,
            zoomControlsEnabled = false,
            zoomGesturesEnabled = false,
        )
    }

    Box(
        Modifier
            .fillMaxWidth()
            .height(168.dp)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        GoogleMap(
            modifier = Modifier.matchParentSize(),
            googleMapOptionsFactory = { GoogleMapOptions().liteMode(true) },
            cameraPositionState = cameraPositionState,
            properties = MapProperties(mapStyleOptions = mapStyle),
            uiSettings = uiSettings,
        ) {
            Marker(state = rememberMarkerState(position = latLng))
        }
        // Transparent overlay: intercepts taps before the lite-mode MapView so the card's onOpen runs.
        Box(Modifier.matchParentSize().clickable(onClick = onTap))
    }
}

@Composable
private fun LocationFooter(placeName: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.Place,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(20.dp),
        )
        Column(Modifier.padding(start = 16.dp).weight(1f)) {
            Text(placeName, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
            Text(
                "Open in Google Maps",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Icon(
            Icons.AutoMirrored.Outlined.OpenInNew,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(16.dp),
        )
    }
}

private fun isPlayServicesAvailable(context: Context): Boolean =
    GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

/** Open a geo: pin (falls back to the Google Maps web URL when no map app handles the intent). */
private fun openInMaps(context: Context, lat: Double, lng: Double, label: String) {
    val query = "$lat,$lng(${Uri.encode(label)})"
    val geo = Intent(Intent.ACTION_VIEW, Uri.parse("geo:$lat,$lng?q=$query"))
    runCatching { context.startActivity(geo) }.onFailure {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=$lat,$lng")),
        )
    }
}

/** Open Maps by place name when we have no coordinates. */
private fun openMapsSearch(context: Context, label: String) {
    val encoded = Uri.encode(label)
    val geo = Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=$encoded"))
    runCatching { context.startActivity(geo) }.onFailure {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=$encoded")),
        )
    }
}
