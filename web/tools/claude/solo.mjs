// Usage: PORT=4187 node solo.mjs <W> <H> <query> <setup-json> <predicate> — times each matching drawable rendered ALONE.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, W, H, query, setup = '[]', pred = 'true'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?${query}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three, null, { timeout: 180000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
for (const [kind, a] of JSON.parse(setup)) { if (kind === 'eval') await page.evaluate(a); else if (kind === 'evalfile') await page.evaluate(fs.readFileSync(a, 'utf8')); else if (kind === 'frames') await frames(a); }
await frames(8);
const res = await page.evaluate((pred) => {
  const { gl, scene, camera } = window.__three; const c = gl.getContext(); const px = new Uint8Array(4);
  const f = new Function('o', 'm', 'u', 'v', `return (${pred});`);
  const all = []; scene.traverseVisible((o) => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) all.push(o); });
  const time = () => { const t = []; for (let i = 0; i < 3; i++) { const t0 = performance.now(); gl.render(scene, camera); c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px); t.push(performance.now() - t0); } t.shift(); return Math.round(Math.min(...t)); };
  const rows = [];
  all.forEach((o) => { o.visible = false; });
  for (const o of all) {
    const m = Array.isArray(o.material) ? o.material[0] : o.material; const u = m && m.uniforms ? Object.keys(m.uniforms).join(',') : '';
    const g = o.geometry; const v = g ? (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) : 0;
    if (!f(o, m, u, v)) continue;
    o.visible = true; const ms = time(); o.visible = false;
    const tex = m ? Object.entries(m.uniforms || {}).filter(([, x]) => x && x.value && x.value.isTexture).map(([k, x]) => `${k}:${x.value.constructor.name}${x.value.image ? '(' + (x.value.image.width || '?') + 'x' + (x.value.image.height || '?') + (x.value.image.depth ? 'x' + x.value.image.depth : '') + ')' : ''}`) : [];
    let p = o, path = []; for (let i = 0; i < 5 && p; i++) { if (p.name) path.push(p.name); p = p.parent; }
    rows.push({ ms, id: o.id, type: o.type, mat: m ? (m.name || m.type) : '', v, obr: o.onBeforeRender.toString().length > 20, defines: m && m.defines ? JSON.stringify(m.defines).slice(0, 80) : '', tex: tex.join(' '), u: u.split(',').filter((k) => /^u[A-Z]/.test(k)).slice(0, 8).join(','), path: path.join('<') });
  }
  all.forEach((o) => { o.visible = true; });
  rows.sort((a, b) => b.ms - a.ms); return rows;
}, pred);
for (const r of res.slice(0, 40)) console.log(`${String(r.ms).padStart(6)} ms  #${r.id} ${r.type} ${r.mat} v=${r.v}${r.obr ? ' onBeforeRender' : ''} [${r.u}] ${r.defines} ${r.tex} ${r.path}`);
await browser.close();
