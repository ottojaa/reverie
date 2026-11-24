# Collections covers: screenshots

Recorded by Paparazzi (`CollectionsScreenshotTest`); the PNGs the test verifies against are in
`apps/android/app/src/test/snapshots/images/com.reverie.app.ui.screens.collections_CollectionsScreenshotTest_*`.

- `grouped_dark-then-light.png`: the new grouped list in dark, then light.
- `states-dark_board-then-renders.png`: the canvas "C · Locked, private, empty, menu" board, then the locked, private-unlocked, empty and open-menu renders in dark.
- `states-light.png`: the same four renders in light.

The "C · Grouped cards" board (and today's baseline) could not be rendered offline: the canvas boards are templates whose
runtime is not available here. So the grouped render has no board beside it; compare it with the board on the canvas
(https://claude.ai/artifact/GXPaKcnrUGaYueFb7c4oAC).

The private-unlocked render shows the folder icon on its private folder rows on purpose: the server sends no cover for a
private folder, open or not, so it differs from the C-States board there.
