// PORT=4187 Q=2 node havenview.mjs <out-prefix> <W> <H> [views-json]
// On Haven, on foot: each view stands `dist` metres from the landing zone at `at` degrees from the
// direction of TON 618 (positive = right), `height` metres up, facing `face` degrees from it, pitch `pitch`.
// dist 'shore' walks out along `at` to the first water and stands `back` metres short of it.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, W = '1280', H = '720', viewsJson] = process.argv;
const views = viewsJson ? JSON.parse(viewsJson) : [
  { name: 'hill-hole', at: 180, dist: 30, height: 0, face: 0, pitch: -4 },
  { name: 'hill-bay', at: 180, dist: 30, height: 0, face: -50, pitch: -6 },
  { name: 'shore', at: -50, dist: 'shore', back: 12, height: 0, face: -50, pitch: -3 },
  { name: 'shore-back', at: -50, dist: 'shore', back: 6, height: 0, face: 130, pitch: 4 },
  { name: 'above', at: 0, dist: 0, height: 140, face: -50, pitch: -22 },
];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
const logs = []; page.on('pageerror', (e) => logs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?start=haven&landed=1&q=${process.env.Q ?? 2}&still`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__expedition.runtime.hud.ship, null, { timeout: 900000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
await frames(4);
await page.evaluate(() => window.__expedition.input.pressed.add('KeyE'));
await frames(6);
for (const v of views) {
  const where = await page.evaluate((v) => {
    const e = window.__expedition; const w = e.runtime.hud.walker; const b = w.body; const V = b.position.constructor;
    const zone = e.landingZoneDirection(b); const R = b.radius; const rad = Math.PI / 180;
    const hole = b.sunDirection.clone().addScaledVector(zone, -b.sunDirection.dot(zone)).normalize();
    const right = new V().crossVectors(hole, zone).normalize();
    const along = (deg) => hole.clone().multiplyScalar(Math.cos(deg * rad)).addScaledVector(right, Math.sin(deg * rad));
    const at = (dir, m) => zone.clone().multiplyScalar(R).addScaledVector(dir, m).normalize();
    if (v.x !== undefined) {
      // Map frame (as the scratch maps): x east, y north of the landing zone, metres; face = azimuth from north.
      const north = e.openingHeading(b).clone(); const east = new V().crossVectors(north, zone).normalize();
      const r = Math.hypot(v.x, v.y); const a = r / R;
      const t = r > 1e-6 ? east.clone().multiplyScalar(v.x / r).addScaledVector(north, v.y / r) : east.clone();
      const stand = zone.clone().multiplyScalar(Math.cos(a)).addScaledVector(t, Math.sin(a)).normalize();
      const g = e.groundHeight(b, stand);
      w.position.copy(b.position).addScaledVector(stand, R + g + 0.2 + (v.height ?? 0));
      const f = north.clone().multiplyScalar(Math.cos(v.face * rad)).addScaledVector(east, Math.sin(v.face * rad)); f.addScaledVector(stand, -f.dot(stand)).normalize();
      w.facing.copy(f); w.look.copy(f); w.pitch = (v.pitch ?? 0) * rad;
      return { x: v.x, y: v.y, ground: +g.toFixed(1) };
    }
    let m = v.dist;
    const level = b.biome.liquid ? b.biome.liquid.level : -1e9;
    if (m === 'shore') { m = 0; while (m < 3000 && e.groundHeight(b, at(along(v.at), m)) > level + 0.05) m += 2; m = Math.max(0, m - (v.back ?? 10)); }
    const stand = at(along(v.at), m);
    const g = e.groundHeight(b, stand);
    w.position.copy(b.position).addScaledVector(stand, R + g + 0.2 + (v.height ?? 0));
    const f = along(v.face); f.addScaledVector(stand, -f.dot(stand)).normalize();
    w.facing.copy(f); w.look.copy(f); w.pitch = (v.pitch ?? 0) * rad;
    return { m: Math.round(m), ground: +g.toFixed(1) };
  }, v);
  await frames(v === views[0] ? 16 : 8);
  const res = await page.evaluate(() => {
    const { gl, scene, camera } = window.__three; const c = gl.getContext(); const px = new Uint8Array(4); const t = [];
    for (let i = 0; i < 3; i++) { const a = performance.now(); gl.render(scene, camera); c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px); t.push(performance.now() - a); }
    t.shift(); return { ms: Math.round(Math.min(...t)), calls: gl.info.render.calls, tris: gl.info.render.triangles, url: gl.domElement.toDataURL('image/png') };
  });
  fs.writeFileSync(`${out}-${v.name}.png`, Buffer.from(res.url.split(',')[1], 'base64'));
  console.log(JSON.stringify({ view: v.name, ...where, ms: res.ms, calls: res.calls, tris: res.tris }));
}
console.log(logs.slice(0, 6).join('\n'));
await browser.close();
