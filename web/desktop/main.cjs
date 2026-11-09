// Rewild for Windows (and Linux/macOS): the web game in its own window, on the graphics card it deserves.
const { app, BrowserWindow, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Laptops with two graphics chips (the owner's: Intel plus an RTX 4070): ask for the fast one.
app.commandLine.appendSwitch('force_high_performance_gpu');
// The game draws a great deal: do not fall back to software drawing on an unknown driver.
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// The game is served from app://rewild/ (its own origin), so it can fetch its models and maps as on a website.
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const siteRoot = app.isPackaged ? path.join(process.resourcesPath, 'site') : path.join(__dirname, 'site');

const createWindow = () => {
    const win = new BrowserWindow({
        width: 1600,
        height: 900,
        title: 'Rewild',
        backgroundColor: '#000000',
        autoHideMenuBar: true,
        show: false,
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    win.once('ready-to-show', () => {
        win.maximize();
        win.show();
    });
    // F11 toggles full screen; links that leave the game open in the browser.
    win.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'F11') {
            win.setFullScreen(!win.isFullScreen());
            event.preventDefault();
        }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    win.loadURL('app://rewild/index.html');
};

app.whenReady().then(() => {
    protocol.handle('app', (request) => {
        const { pathname } = new URL(request.url);
        const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
        const file = path.normalize(path.join(siteRoot, relative));
        if (!file.startsWith(siteRoot)) return new Response('Not found', { status: 404 });
        return net.fetch(pathToFileURL(file).toString());
    });
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
