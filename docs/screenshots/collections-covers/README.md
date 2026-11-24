# Collections covers: screenshots

Recorded by Paparazzi (`CollectionsScreenshotTest`); the PNGs the test verifies against are in
`apps/android/app/src/test/snapshots/images/com.reverie.app.ui.screens.collections_CollectionsScreenshotTest_*`.

- `grouped_today-then-dark-then-light.png`: today's screen (the canvas "Today (baseline)" board), then the new grouped list in dark and light.
- `states-dark_board-then-renders.png`: the canvas "C · Locked, private, empty, menu" board, then the locked, private-unlocked, empty and open-menu renders in dark.
- `states-light.png`: the same four renders in light.

The "C · Grouped cards" board could not be rendered offline (its template runtime is not available), so the grouped
render sits beside today's baseline; compare it with the board on the canvas.

The private-unlocked render shows the folder icon on its private folder rows on purpose: the server sends no cover for a
private folder, open or not, so it differs from the C-States board there.
