// Usage: PORT=4188 node loadtime.mjs <label> <W> <H> <query> [settleFrames]
// Start-up cost of the expedition: time to the first drawn frame (after CompileGate), programs compiled,
// geometries/textures held, JS heap; then the mean wall-clock frame interval over a run of frames
// (JS + SwiftShader render), and a full gl.render timed by hand.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const [,, label, W, H, query, settle = '30'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-precise-memory-info'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${process.env.PORT || 4188}/lab/fly-lab.html?${query}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three, null, { timeout: 300000, polling: 200 });
const tScene = Date.now() - t0;
// The compile gate holds R3F's drawing until the shaders are in (the experience marks the moment it opens).
await page.waitForFunction(() => !!window.__compiledAt, null, { timeout: 900000, polling: 200 });
const tFirst = Date.now() - t0;
const atFirst = await page.evaluate(() => {
  const { gl } = window.__three;
  return { programs: gl.info.programs.length, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures };
});
// Let it settle, then time a run of frames.
await page.evaluate((n) => new Promise((resolve) => { let k = 0; const loop = () => { if (++k >= n) resolve(); else requestAnimationFrame(loop); }; requestAnimationFrame(loop); }), +settle);
const run = await page.evaluate(() => new Promise((resolve) => {
  const stamps = []; const loop = (t) => { stamps.push(t); if (stamps.length >= 9) resolve(stamps); else requestAnimationFrame(loop); }; requestAnimationFrame(loop);
}));
const gaps = run.slice(1).map((t, i) => t - run[i]).sort((a, b) => a - b);
const after = await page.evaluate(() => {
  const { gl, scene, camera } = window.__three; const c = gl.getContext(); const px = new Uint8Array(4); const t = [];
  for (let i = 0; i < 4; i++) { const s = performance.now(); gl.render(scene, camera); c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px); t.push(performance.now() - s); }
  t.shift();
  let objects = 0; scene.traverse(() => { objects++; });
  return { programs: gl.info.programs.length, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, renderMs: Math.round(Math.min(...t)), calls: gl.info.render.calls, tris: gl.info.render.triangles, objects, heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576) };
});
console.log(JSON.stringify({ label, tScene, tFirst, atFirst, frameMedianMs: Math.round(gaps[Math.floor(gaps.length / 2)]), ...after, errors: errors.slice(0, 5) }));
await browser.close();
