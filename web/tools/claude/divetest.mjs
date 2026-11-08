// node riverview.mjs <outdir> <W> <H> [extra query] : on Earth, find a deep river near the landing site, stand on its
// bank and look across and along it; then hover 25 m over it. Canvas only (no HUD). Times one render per view.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, W = '960', H = '540', extra = ''] = process.argv;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
const logs = []; page.on('pageerror', (e) => logs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 400)); });
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?start=projects&landed=1&q=${process.env.Q || 2}&still${extra}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__expedition.runtime.hud.ship, null, { timeout: 600000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
await frames(4);
await page.evaluate(() => window.__expedition.input.pressed.add('KeyE'));
await frames(6);
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
  // The bank: walk across until dry, both ways; the river runs across that line.
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
    for (let i = 0; i < 3; i++) { const a = performance.now(); if (composer) composer.render(1 / 60); else gl.render(scene, camera); c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px); t.push(performance.now() - a); }
    t.shift(); return { ms: Math.round(Math.min(...t)), url: gl.domElement.toDataURL('image/png'), under: window.__expedition.runtime.underwater };
  });
  fs.writeFileSync(`${out}/${name}.png`, Buffer.from(res.url.split(',')[1], 'base64'));
  console.log(name, res.ms + ' ms', 'under', res.under.toFixed(2));
};
// Swim out to the middle of the river and dive.
const dive = async (name, depthFrac, pitch) => {
  await page.evaluate(([depthFrac, pitch]) => {
    const e = window.__expedition; const w = e.runtime.hud.walker; const b = w.body; const V = b.position.constructor; const f = window.__river;
    const zone = e.landingZoneDirection(b); const t = new V(0, 1, 0).cross(zone).normalize(); const s = new V().crossVectors(zone, t);
    const at = (a, c) => zone.clone().multiplyScalar(b.radius).addScaledVector(t, a).addScaledVector(s, c).normalize();
    const cx = f.cross; const mid = at(f.a + cx.x * (cx.m1 - cx.m2) / 2, f.c + cx.y * (cx.m1 - cx.m2) / 2);
    const depth = e.waterDepth(b, mid);
    w.dive = Math.max(0, (depth - 1.75) * depthFrac);
    w.swimming = true;
    w.position.copy(b.position).addScaledVector(mid, b.radius + e.groundHeight(b, mid) - 1.1 - w.dive);
    const along = new V(cx.y, -cx.x, 0); const dir = t.clone().multiplyScalar(along.x).addScaledVector(s, along.y); dir.addScaledVector(mid, -dir.dot(mid)).normalize();
    w.facing.copy(dir); w.look.copy(dir); w.pitch = pitch; w.velocity.set(0, 0, 0);
    window.__diveDepth = depth;
  }, [depthFrac, pitch]);
  await shot(name);
};
if (found) {
  await page.waitForFunction(() => !!window.__composer, null, { timeout: 1800000, polling: 1000 });
  await dive('dive-level', 1, 0.0);
  await dive('dive-up', 1, 0.7);
  // The ship hovering 12 m over the middle of the river.
  await page.evaluate(() => window.__expedition.input.pressed.add('KeyE'));
  await frames(4);
  await page.evaluate(() => {
    const e = window.__expedition; const r = e.runtime; const b = r.hud.walker ? r.hud.walker.body : e.bodies.find((x) => x.id === 'projects'); const V = b.position.constructor; const f = window.__river;
    const zone = e.landingZoneDirection(b); const t = new V(0, 1, 0).cross(zone).normalize(); const s = new V().crossVectors(zone, t);
    const at = (a, c) => zone.clone().multiplyScalar(b.radius).addScaledVector(t, a).addScaledVector(s, c).normalize();
    const cx = f.cross; const mid = at(f.a + cx.x * (cx.m1 - cx.m2) / 2, f.c + cx.y * (cx.m1 - cx.m2) / 2);
    const pos = b.position.clone().addScaledVector(mid, b.radius + e.groundHeight(b, mid) + 12);
    const facing = t.clone(); facing.addScaledVector(mid, -facing.dot(mid)).normalize();
    r.actions.place(pos, facing, 0, mid); if (r.hud.ship) r.hud.ship.throttle = 0;
  });
  await shot('ship-hover');
}
console.log('logs:', logs.slice(0, 5).join(' | '));
await browser.close();
