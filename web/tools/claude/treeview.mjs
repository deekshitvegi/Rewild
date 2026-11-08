// PORT=4188 node treeview.mjs <out-prefix> <W> <H> [extra query]: on Earth (fully revived), stand at the landing site and
// look four ways at eye height, then from 35 m up; save the canvas and time a full render (best of 3) for each view.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, W = '960', H = '540', extra = ''] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
const logs = []; page.on('pageerror', (e) => logs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?start=projects&landed=1&q=${process.env.Q || 2}&still&revival=${process.env.REV || 1}${extra}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__expedition.runtime.hud.ship, null, { timeout: 900000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
await frames(4);
await page.evaluate(() => window.__expedition.input.pressed.add('KeyE'));
await frames(6);
const views = [['n', 0, 0, -2], ['e', Math.PI / 2, 0, -2], ['s', Math.PI, 0, -2], ['w', -Math.PI / 2, 0, -2], ['up', 0.6, 35, -14]];
for (const [name, turn, height, pitch] of views) {
  await page.evaluate(([turn, height, pitch]) => {
    const e = window.__expedition; const w = e.runtime.hud.walker; const b = w.body; const V = b.position.constructor;
    const zone = e.landingZoneDirection(b); const t = new V(0, 1, 0).cross(zone).normalize(); const s = new V().crossVectors(zone, t);
    const stand = zone.clone().multiplyScalar(b.radius).addScaledVector(t, 60).addScaledVector(s, 40).normalize();
    w.position.copy(b.position).addScaledVector(stand, b.radius + e.groundHeight(b, stand) + 0.2 + height);
    const f = t.clone().multiplyScalar(Math.cos(turn)).addScaledVector(s, Math.sin(turn)); f.addScaledVector(stand, -f.dot(stand)).normalize();
    w.facing.copy(f); w.look.copy(f); w.pitch = pitch * Math.PI / 180;
  }, [turn, height, pitch]);
  await frames(name === 'n' ? 14 : 5);
  const res = await page.evaluate(() => {
    const { gl, scene, camera } = window.__three; const c = gl.getContext(); const px = new Uint8Array(4); const t = [];
    for (let i = 0; i < 4; i++) { const a = performance.now(); gl.render(scene, camera); c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px); t.push(performance.now() - a); }
    t.shift(); return { ms: Math.round(Math.min(...t)), calls: gl.info.render.calls, tris: gl.info.render.triangles, url: gl.domElement.toDataURL('image/png') };
  });
  fs.writeFileSync(`${out}-${name}.png`, Buffer.from(res.url.split(',')[1], 'base64'));
  console.log(JSON.stringify({ view: name, ms: res.ms, calls: res.calls, tris: res.tris }));
}
console.log(logs.slice(0, 5).join('\n'));
await browser.close();
