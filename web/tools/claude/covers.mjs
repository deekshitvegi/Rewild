// Usage: PORT=4187 node covers.mjs <query> <skyview-json> <targetId>
// Places the camera with evals/skyview.js, projects the target's centre to the screen, then hides each visible
// drawable in turn and reports how much the pixel there changes: what covers the target.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, query, sv, targetId] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 })).newPage();
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?${query}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three, null, { timeout: 180000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
await frames(6);
await page.evaluate((s) => { window.__sv = JSON.parse(s); }, sv);
console.log(JSON.stringify(await page.evaluate(fs.readFileSync(new URL('./evals/skyview.js', import.meta.url).pathname, 'utf8'))));
await frames(40);
const res = await page.evaluate((targetId) => {
  const { gl, scene, camera } = window.__three; const e = window.__expedition; const r = e.runtime;
  const b = e.bodies.find((x) => x.id === targetId);
  const p = b.position.clone().sub(r.origin).project(camera);
  const W = gl.domElement.width, H = gl.domElement.height;
  const px = Math.round((p.x * 0.5 + 0.5) * W), py = Math.round((p.y * 0.5 + 0.5) * H);
  const c = gl.getContext(); const buf = new Uint8Array(4);
  const read = () => { gl.render(scene, camera); c.readPixels(px, py, 1, 1, c.RGBA, c.UNSIGNED_BYTE, buf); return [buf[0], buf[1], buf[2]]; };
  const base = read();
  const list = []; scene.traverseVisible((o) => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) list.push(o); });
  const out = [];
  for (const o of list) { o.visible = false; const v = read(); o.visible = true;
    const d = Math.abs(v[0] - base[0]) + Math.abs(v[1] - base[1]) + Math.abs(v[2] - base[2]);
    if (d > 3) { const m = Array.isArray(o.material) ? o.material[0] : o.material; const u = m && m.uniforms ? Object.keys(m.uniforms).slice(0, 5).join(',') : '';
      out.push({ id: o.id, type: o.type, order: o.renderOrder, mat: m && (m.name || m.type), u, without: v, d }); } }
  return { ndc: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(4)], px, py, base, changes: out.sort((a, b) => b.d - a.d).slice(0, 8) };
}, targetId);
console.log(JSON.stringify(res, null, 1));
await browser.close();
