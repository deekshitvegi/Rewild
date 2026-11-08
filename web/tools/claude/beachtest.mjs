// PORT=4187 node beachtest.mjs <outdir> [W H]: Earth (revived): find the nearest beach to the landing site; stand on the sand
// looking out to sea, swim out among the breakers, dive in deeper water; the ship hovering over the sea.
// Each picture through the whole composer.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, W = '640', H = '360'] = process.argv;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
const logs = []; page.on('pageerror', (e) => logs.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?start=projects&landed=1&q=2&still&revival=1`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__expedition.runtime.hud.ship, null, { timeout: 1800000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
await frames(4);
await page.evaluate(() => window.__expedition.input.pressed.add('KeyE'));
await frames(6);
const beach = await page.evaluate(() => {
  const e = window.__expedition; const b = e.runtime.hud.walker.body; const V = b.position.constructor;
  const zone = e.landingZoneDirection(b); const t = new V(0, 1, 0).cross(zone).normalize(); const s = new V().crossVectors(zone, t);
  const at = (a, c) => zone.clone().multiplyScalar(b.radius).addScaledVector(t, a).addScaledVector(s, c).normalize();
  for (let r = 100; r < 9000; r += 100) for (let k = 0; k < 96; k++) {
    const ang = k / 96 * Math.PI * 2; const a = Math.cos(ang) * r, c = Math.sin(ang) * r;
    const spot = e.groundSpot(b, at(a, c));
    if (spot.water > 0.4 && spot.shore < -4 && spot.shore > -25) {
      // Which way is the sea: the shore field's slope.
      const h = 3; const s0 = spot.shore;
      const sa = e.groundSpot(b, at(a + h, c)).shore; const sc = e.groundSpot(b, at(a, c + h)).shore;
      let ga = (sa - s0) / h, gc = (sc - s0) / h; const n = Math.hypot(ga, gc) || 1; ga /= n; gc /= n;  // towards the land
      window.__beach = { a, c, ga, gc };
      return { a, c, shore: s0, depth: spot.water, r };
    }
  }
  return null;
});
console.log('beach', JSON.stringify(beach));
const shot = async (name) => {
  await frames(+(process.env.SETTLE || 6));
  const res = await page.evaluate(() => {
    const { gl, scene, camera } = window.__three; const c = gl.getContext(); const px = new Uint8Array(4); const t = [];
    const composer = window.__composer;
    for (let i = 0; i < 3; i++) { const a = performance.now(); if (composer) composer.render(1 / 60); else gl.render(scene, camera); c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px); t.push(performance.now() - a); }
    t.shift(); return { ms: Math.round(Math.min(...t)), url: gl.domElement.toDataURL('image/png'), under: window.__expedition.runtime.underwater };
  });
  fs.writeFileSync(`${out}/${name}.png`, Buffer.from(res.url.split(',')[1], 'base64'));
  console.log(name, res.ms + ' ms', 'under', (res.under ?? 0).toFixed(2));
};
// Stand at `along` metres from the found spot along the landward direction (negative: out to sea), facing the sea or the land.
const standAt = (along, faceSea, pitch, dive) => page.evaluate(([along, faceSea, pitch, dive]) => {
  const e = window.__expedition; const w = e.runtime.hud.walker; const b = w.body; const V = b.position.constructor; const f = window.__beach;
  const zone = e.landingZoneDirection(b); const t = new V(0, 1, 0).cross(zone).normalize(); const s = new V().crossVectors(zone, t);
  const at = (a, c) => zone.clone().multiplyScalar(b.radius).addScaledVector(t, a).addScaledVector(s, c).normalize();
  const spot = at(f.a + f.ga * along, f.c + f.gc * along);
  const depth = e.waterDepth(b, spot);
  w.dive = dive ? Math.max(0, depth - 1.75) * dive : 0;
  w.swimming = depth > 1.15;
  w.position.copy(b.position).addScaledVector(spot, b.radius + e.groundHeight(b, spot) - Math.min(depth, 1.1) - w.dive + 0.05);
  const land = t.clone().multiplyScalar(f.ga).addScaledVector(s, f.gc); land.addScaledVector(spot, -land.dot(spot)).normalize();
  const dir = faceSea ? land.clone().negate() : land;
  w.facing.copy(dir); w.look.copy(dir); w.pitch = pitch; w.velocity.set(0, 0, 0);
  return depth;
}, [along, faceSea, pitch, dive]);
if (beach) {
  await page.waitForFunction(() => !!window.__composer, null, { timeout: 1800000, polling: 1000 });
  // Find the sand: walk landward until dry.
  let dry = 0; for (let k = 0; k < 60; k++) { const d = await page.evaluate(([x]) => { const e = window.__expedition; const b = e.runtime.hud.walker.body; const V = b.position.constructor; const f = window.__beach; const zone = e.landingZoneDirection(b); const t = new V(0, 1, 0).cross(zone).normalize(); const s = new V().crossVectors(zone, t); return e.waterDepth(b, zone.clone().multiplyScalar(b.radius).addScaledVector(t, f.a + f.ga * x).addScaledVector(s, f.c + f.gc * x).normalize()); }, [dry]); if (d <= 0) break; dry += 2; }
  console.log('sand at', dry);
  await standAt(dry + 4, true, -0.05, 0); await shot('beach');
  console.log('depth', await standAt(dry - 25, false, -0.02, 0)); await shot('swim-breakers');
  let deep = dry - 60; for (let k = 0; k < 40; k++) { const d = await standAt(deep, true, 0, 0); if (d > 6) break; deep -= 20; }
  console.log('deep at', deep, await standAt(deep, true, 0.0, 1)); await shot('dive-level');
  await standAt(deep, true, 0.75, 1); await shot('dive-up');
}
console.log('logs:', logs.slice(0, 5).join(' | '));
await browser.close();
