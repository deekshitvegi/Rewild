// PORT=.. REFL=mirror|sky node mirrortest.mjs <outdir> [W H]: Earth (revived), High. A river bank looking across and along
// (banks, trees mirrored), then a beach looking out to sea. Whole composer per picture, timed.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, W = '640', H = '360'] = process.argv;
const REFL = process.env.REFL || 'mirror';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
await ctx.addInitScript((refl) => { try { localStorage.setItem('expedition-graphics', JSON.stringify({ detail: 'auto', resolution: 'auto', features: { clouds: 'auto', water: 'auto', grass: 'auto', reflections: refl } })); } catch {} }, REFL);
const page = await ctx.newPage();
const logs = []; page.on('pageerror', (e) => logs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 400)); });
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?start=projects&landed=1&q=2&still&revival=1`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__expedition.runtime.hud.ship, null, { timeout: 1800000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
await frames(4);
await page.evaluate(() => window.__expedition.input.pressed.add('KeyE'));
await frames(6);
await page.waitForFunction(() => !!window.__composer, null, { timeout: 1800000, polling: 1000 });
console.log('features', JSON.stringify(await page.evaluate(() => window.__expedition.runtime.features)));
const found = await page.evaluate(() => {
  const e = window.__expedition; const b = e.runtime.hud.walker.body; const V = b.position.constructor;
  const zone = e.landingZoneDirection(b); const t = new V(0, 1, 0).cross(zone).normalize(); const s = new V().crossVectors(zone, t);
  const at = (a, c) => zone.clone().multiplyScalar(b.radius).addScaledVector(t, a).addScaledVector(s, c).normalize();
  let best = null;
  for (let r = 40; r < 4000 && !best; r += 40) for (let k = 0; k < 64; k++) {
    const ang = k / 64 * Math.PI * 2; const a = Math.cos(ang) * r, c = Math.sin(ang) * r;
    const d = at(a, c); const depth = e.waterDepth(b, d);
    if (depth > 1.6) { best = { a, c, depth }; break; }
  }
  if (!best) return null;
  const dirs = [[1, 0], [0, 1], [0.7, 0.7], [0.7, -0.7]]; let cross = null;
  for (const [x, y] of dirs) {
    let m1 = 0, m2 = 0; while (m1 < 60 && e.waterDepth(b, at(best.a + x * m1, best.c + y * m1)) > 0) m1 += 0.5;
    while (m2 < 60 && e.waterDepth(b, at(best.a - x * m2, best.c - y * m2)) > 0) m2 += 0.5;
    if (!cross || m1 + m2 < cross.w) cross = { x, y, w: m1 + m2, m1, m2 };
  }
  window.__river = { ...best, cross };
  return window.__river;
});
console.log('river', JSON.stringify(found));
const shot = async (name) => {
  await frames(+(process.env.SETTLE || 6));
  const res = await page.evaluate(() => {
    const { gl, scene, camera } = window.__three; const c = gl.getContext(); const px = new Uint8Array(4); const t = [];
    const composer = window.__composer;
    for (let i = 0; i < 3; i++) { const a = performance.now(); composer.render(1 / 60); c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px); t.push(performance.now() - a); }
    let on = null; scene.traverse((o) => { if (o.material && o.material.uniforms && o.material.uniforms.uMirrorOn && o.visible) on = o.material.uniforms.uMirrorOn.value; });
    t.shift(); return { ms: Math.round(Math.min(...t)), url: gl.domElement.toDataURL('image/png'), on, calls: gl.info.render.calls };
  });
  fs.writeFileSync(`${out}/${name}.png`, Buffer.from(res.url.split(',')[1], 'base64'));
  console.log(name, res.ms + ' ms', 'mirrorOn', res.on, 'calls', res.calls);
};
const riverView = (side, height, alongTurn, pitch) => page.evaluate(([side, height, alongTurn, pitch]) => {
  const e = window.__expedition; const w = e.runtime.hud.walker; const b = w.body; const V = b.position.constructor; const f = window.__river;
  const zone = e.landingZoneDirection(b); const t = new V(0, 1, 0).cross(zone).normalize(); const s = new V().crossVectors(zone, t);
  const at = (a, c) => zone.clone().multiplyScalar(b.radius).addScaledVector(t, a).addScaledVector(s, c).normalize();
  const cx = f.cross; const off = cx.m1 + side;
  const stand = at(f.a + cx.x * off, f.c + cx.y * off);
  w.position.copy(b.position).addScaledVector(stand, b.radius + e.groundHeight(b, stand) + 0.2 + height);
  const mid = b.position.clone().addScaledVector(at(f.a + cx.x * (cx.m1 - cx.m2) / 2, f.c + cx.y * (cx.m1 - cx.m2) / 2), b.radius);
  const up = stand.clone(); let to = mid.sub(w.position); to.addScaledVector(up, -to.dot(up)).normalize();
  to.applyAxisAngle(up, alongTurn);
  w.facing.copy(to); w.look.copy(to); w.pitch = pitch; w.velocity.set(0, 0, 0);
}, [side, height, alongTurn, pitch]);
if (found) {
  await riverView(2, 0, 0, -0.15); await shot('1-across');
  await riverView(2, 0, 1.2, -0.1); await shot('2-along');
  await riverView(5, 15, 0.4, -0.45); await shot('3-above');
  // The ship hovering 8 m over the middle of the river: its reflection, the downdraft's rings and spray.
  await page.evaluate(() => window.__expedition.input.pressed.add('KeyE'));
  await frames(4);
  await page.evaluate(() => {
    const e = window.__expedition; const r = e.runtime; const b = r.hud.walker ? r.hud.walker.body : e.bodies.find((x) => x.id === 'projects'); const V = b.position.constructor; const f = window.__river;
    const zone = e.landingZoneDirection(b); const t = new V(0, 1, 0).cross(zone).normalize(); const s = new V().crossVectors(zone, t);
    const at = (a, c) => zone.clone().multiplyScalar(b.radius).addScaledVector(t, a).addScaledVector(s, c).normalize();
    const cx = f.cross; const mid = at(f.a + cx.x * (cx.m1 - cx.m2) / 2, f.c + cx.y * (cx.m1 - cx.m2) / 2);
    const pos = b.position.clone().addScaledVector(mid, b.radius + e.groundHeight(b, mid) + 8);
    const facing = t.clone(); facing.addScaledVector(mid, -facing.dot(mid)).normalize();
    r.actions.place(pos, facing, 0, mid); if (r.hud.ship) r.hud.ship.throttle = 0;
  });
  process.env.SETTLE = '12';
  await shot('4-ship-hover');
}
console.log('logs:', logs.slice(0, 5).join(' | '));
await browser.close();
