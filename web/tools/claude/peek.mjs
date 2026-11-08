// Usage: PORT=4187 node peek.mjs <out-prefix> <W> <H> <query> <setup-json> <views-json>
// views: [{name, target: bodyId, fov, hide: "<predicate over o,m,u>"}]: renders the frozen scene straight at a world
// through a narrow lens (the game's own camera, put back after), and saves each picture.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, W, H, query, setup = '[]', viewsJson = '[]'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?${query}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three, null, { timeout: 180000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
for (const [kind, a] of JSON.parse(setup)) {
  if (kind === 'eval') console.log('eval', JSON.stringify(await page.evaluate(a)));
  else if (kind === 'evalfile') console.log('eval', JSON.stringify(await page.evaluate(fs.readFileSync(a, 'utf8'))));
  else if (kind === 'frames') await frames(a);
}
for (const view of JSON.parse(viewsJson)) {
  const res = await page.evaluate((view) => {
    const { gl, scene, camera } = window.__three; const e = window.__expedition; const r = e.runtime;
    const t = e.bodies.find((b) => b.id === view.target);
    const saved = { fov: camera.fov, q: camera.quaternion.clone() };
    const dir = t.position.clone().sub(r.origin).sub(camera.position).normalize();
    const up = camera.up.clone();
    if (view.below) { const shipUp = r.hud.ship ? r.hud.ship.position.clone().sub((r.currentBody || t).position).normalize() : up; const right = dir.clone().cross(shipUp).normalize(); dir.applyAxisAngle(right, -view.below * Math.PI / 180); }
    const m = new camera.matrix.constructor().lookAt(camera.position, camera.position.clone().add(dir), r.hud.ship ? r.hud.ship.position.clone().sub((r.currentBody || t).position).normalize() : up);
    camera.quaternion.setFromRotationMatrix(m); camera.fov = view.fov ?? 4; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    const hidden = []; if (view.hide) { const f = new Function('o', 'm', 'u', `return (${view.hide});`); scene.traverseVisible((o) => { if (!(o.isMesh || o.isPoints)) return; const mm = Array.isArray(o.material) ? o.material[0] : o.material; const u = mm && mm.uniforms ? Object.keys(mm.uniforms).join(',') : ''; if (f(o, mm, u)) hidden.push(o); }); hidden.forEach((o) => { o.visible = false; }); }
    gl.render(scene, camera); const url = gl.domElement.toDataURL('image/png');
    hidden.forEach((o) => { o.visible = true; });
    camera.fov = saved.fov; camera.quaternion.copy(saved.q); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    return { url, hidden: hidden.length, dist: Math.round(t.position.clone().sub(r.origin).sub(camera.position).length()) };
  }, view);
  fs.writeFileSync(`${out}-${view.name}.png`, Buffer.from(res.url.split(',')[1], 'base64'));
  console.log('view', view.name, 'hidden', res.hidden, 'dist', res.dist);
}
console.log('logs:', logs.slice(0, 5).join(' | '));
await browser.close();
