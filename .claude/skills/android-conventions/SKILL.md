---
name: android-conventions
description: Android app conventions (Kotlin + Jetpack Compose) — MVVM + repositories, Hilt DI, Ktor/OkHttp networking, Room + DataStore, socket.io realtime, Coil/Media3, the viewer registry, and Material 3 theming. Load before writing or reviewing any code under `apps/android`.
---

# Android App (Kotlin + Jetpack Compose)

Native Android app (package root `com.reverie.app`), single Activity, Material 3.

## Architecture

MVVM with a repository layer (no use-case layer — ViewModels call repositories directly):

```
data/
  api/           # Ktor APIs + hand-written DTOs (api/model/)
  auth/          # session + token storage
  local/         # Room DB (dao/, entity/) + file cache
  realtime/      # socket.io job-event stream
  repository/    # repositories (the ViewModel's data source)
  settings/      # DataStore preferences
  upload/        # WorkManager upload jobs
  image/         # Coil authed thumbnails · connectivity/
domain/model/    # domain models (also domain/search/) — no usecase/
ui/
  screens/       # Screen composables + ViewModels (auth, browse, collections,
                 #   document, search, settings, upload, viewer)
  components/     navigation/     theme/
util/
di/              # Hilt modules
```

## Key Technologies

- **UI**: Jetpack Compose + Material 3
- **DI**: Hilt (incl. `hilt-work` for WorkManager)
- **Navigation**: Navigation Compose (single Activity)
- **Networking**: Ktor Client on the **OkHttp** engine (shared with Coil + socket.io), kotlinx.serialization
- **Local**: Room (offline cache) + DataStore (preferences)
- **Realtime**: socket.io-client for job events
- **Media**: Coil (+ telephoto zoomable) for images, Media3/ExoPlayer for video
- **Maps**: Google Maps Compose (lite-mode location card in the viewer)
- **Async**: Coroutines + Flow

## Screen + ViewModel pattern

```kotlin
@Composable
fun SomeScreen(viewModel: SomeViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    // Compose UI based on state
}

@HiltViewModel
class SomeViewModel @Inject constructor(
    private val repository: SomeRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(SomeUiState())
    val uiState = _uiState.asStateFlow()
}
```

`UiState` is a plain `data class` per screen.

## API integration

DTOs are **hand-written** (`data/api/model/*Dtos.kt`) and kept aligned with the backend
`@reverie/shared` Zod schemas — there is no OpenAPI codegen. The Ktor client mirrors the web
interceptor: attach bearer token → on 401 refresh once → retry (see `ReverieClientFactory`).

## Viewer registry

`ViewerRegistry.kt` dispatches a document to the right viewer by MIME (+ extension fallback):
`ImageViewer` / `VideoViewer` / `PdfViewer` / `TextViewer` / `FallbackViewer` under
`ui/screens/viewer/viewers/`. Mirrors the web viewer registry — add new formats here.

## Theming & design

- **Brand palette is the default**; Material You dynamic color is opt-in (`ReverieTheme(dynamicColor = …)`, gated to Android 12+). See `brand-guidelines`.
- Bottom sheets (`ModalBottomSheet`) are the common surface for document actions/details.
- Single Activity; pull-to-refresh on lists.

## Gotchas

- **Lint under JDK 21** crashes some Compose detectors — disabled by active issue id in build config.
- `compileSdk 36`. Geist font is aliased to system fonts. socket.io dep excludes `org.json`.
- Maps needs `MAPS_API_KEY` in `apps/android/local.properties` (gitignored) or `-PMAPS_API_KEY=…`.
