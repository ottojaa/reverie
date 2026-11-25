# Favourites: screenshots

Recorded by Paparazzi (`FavouritesScreenshotTest`); the PNGs the test verifies against are in
`apps/android/app/src/test/snapshots/images/com.reverie.app.ui.screens.favourites_FavouritesScreenshotTest_*`.
The boards are from the design canvas (https://claude.ai/artifact/GXPaKcnrUGaYueFb7c4oAC), filled with their own sample
data. Blurhashes stand in for thumbnails, and menus are drawn in place because a screenshot test draws no popup.

- `stars_dark_board-then-renders.png`: the stars board, then the viewer star and its message, the folder and file menus,
  and the badges on photo and video cards, file rows, a collection and its folder rows.
- `shelf_dark_board-then-renders.png`: the shelf board and Collections with the shelf; below, every kind of card,
  including a private one locked and open.
- `dashboard-strip_dark_board-then-renders.png`: the dashboard board and the Files dashboard with the strip, then with an
  empty library; below, every kind of tile. Only the strip is ported from that board.
- `screen_dark_board-then-renders.png`: the screen board, then the screen under All, Folders and Files.
- `states-dark.png`: nothing starred, a failed first load, and a narrow phone at a large font size.
- `light.png`: the same renders in light.

Where the app differs from the boards, on purpose:

- Long-press stays selection; it does not toggle a star.
- The Favourites screen has no sort button: there is one order, newest-starred first.
- A private item keeps its nameless padlock after an unlock ("Tap to open"); private items stay inside their own folder.
- The unstar button on a grid card has a faint dark circle behind the star, so it stays visible on a bright photo.
