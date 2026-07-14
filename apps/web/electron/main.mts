import { app, BrowserWindow, nativeTheme } from 'electron';
import * as path from 'path';

const isDev = process.env.NODE_ENV === 'development';

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

app.whenReady().then(() => {
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
