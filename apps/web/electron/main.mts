import { app, BrowserWindow, nativeTheme, session, type Cookie } from 'electron';
import * as path from 'path';

const isDev = process.env.NODE_ENV === 'development';

// Name of the API's cookie that holds the folder locks the user has opened. It has no expiry, so
// it is meant to last only for one app run: private folders must be locked again after a quit.
const VAULT_COOKIE_NAME = 'vault_session';

function toCookieUrl(cookie: Cookie): string {
    const host = (cookie.domain ?? '').replace(/^\./, '');

    return `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path ?? '/'}`;
}

/**
 * Drops the open-lock cookie from the window's session (the default session, whose cookies live
 * in the persistent userData store). Chromium can restore session cookies from that store on the
 * next launch, so quitting would not reliably re-lock by itself; this makes it deterministic.
 */
async function clearVaultCookies(): Promise<void> {
    const cookies = await session.defaultSession.cookies.get({ name: VAULT_COOKIE_NAME });

    await Promise.all(cookies.map((cookie) => session.defaultSession.cookies.remove(toCookieUrl(cookie), cookie.name)));
}

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(import.meta.dirname, 'preload.cjs'),
        },
        titleBarStyle: 'hiddenInset',
        // The window background shows through whenever the renderer can't
        // produce a frame in time (heavy navigations, WebGL context creation)
        // — hardcoded white read as a flash in dark mode. Matches --background.
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#121212' : '#f8f7f4',
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:4200');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(import.meta.dirname, '../dist/index.html'));
    }
}

app.whenReady().then(async () => {
    // Also clear at startup: a crash or force-quit never reaches the before-quit handler below.
    await clearVaultCookies().catch(() => undefined);
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

let vaultCookiesCleared = false;

// Quit is paused once so the async cookie removal can finish, then resumed.
app.on('before-quit', (event) => {
    if (vaultCookiesCleared) return;

    event.preventDefault();
    clearVaultCookies()
        .catch(() => undefined)
        .finally(() => {
            vaultCookiesCleared = true;
            app.quit();
        });
});
