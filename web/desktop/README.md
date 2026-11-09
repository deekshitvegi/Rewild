# Rewild for Windows (the web version as a desktop app)

The three.js game in `web/` packaged with Electron: its own window, no browser or Claude app around it, and on
laptops with two graphics chips it asks for the fast one (`force_high_performance_gpu`, so the RTX 4070 rather
than the Intel chip). The game is served inside the app from `app://rewild/`, so it loads its models and maps
exactly as it does on a website.

## Build the installer (on the Windows PC)

Needs Node.js 22 or newer (`winget install OpenJS.NodeJS.LTS` if `node --version` fails).

```powershell
cd web
npm install
cd desktop
npm install
npm run app:win
```

The installer lands in `web/desktop/release/` (`Rewild Setup 0.1.0.exe`, about 300 MB). Run it once; Rewild is
then in the Start menu and on the desktop. `npm run app:win-folder` makes an unpacked folder instead
(`release/win-unpacked/Rewild.exe`), handy for trying a build without installing it.

`npm start` builds the site and opens the app straight away (for testing).

## Notes

- F11: full screen. Esc inside the game works as in the browser.
- The app is not code-signed, so Windows SmartScreen asks once ("More info", "Run anyway").
- The first start compiles the game's shaders: later starts are quicker (Chromium keeps a shader cache).
