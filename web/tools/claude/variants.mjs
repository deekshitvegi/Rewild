// Usage: PORT=4187 node variants.mjs <W> <H> <query> <predicate> <variants-json> [setup-json]
// Renders only the first drawable matching <predicate>, with its fragment shader edited per variant: [{name, edits:[[from,to],...]}]
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, W, H, query, pred, variantsJson, setup = '[]'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
const logs = []; page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 400)); });
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?${query}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three, null, { timeout: 180000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
for (const [kind, a] of JSON.parse(setup)) { if (kind === 'eval') await page.evaluate(a); else if (kind === 'evalfile') await page.evaluate(fs.readFileSync(a, 'utf8')); else if (kind === 'frames') await frames(a); }
await frames(18);
for (const v of JSON.parse(variantsJson)) {
  const res = await page.evaluate(([pred, v]) => {
    const { gl, scene, camera } = window.__three; const c = gl.getContext(); const px = new Uint8Array(4);
    const f = new Function('o', 'm', 'u', 'vv', `return (${pred});`);
    const all = []; scene.traverseVisible((o) => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) all.push(o); });
    const target = all.find((o) => { const m = o.material; const u = m && m.uniforms ? Object.keys(m.uniforms).join(',') : ''; const g = o.geometry; const vv = g ? (g.index ? g.index.count : 0) : 0; return f(o, m, u, vv); });
    if (!target) return { error: 'none' };
    const time = () => { const t = []; for (let i = 0; i < 3; i++) { const t0 = performance.now(); gl.render(scene, camera); c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px); t.push(performance.now() - t0); } t.shift(); return Math.round(Math.min(...t)); };
    all.forEach((o) => { o.visible = false; }); target.visible = true;
    const m = target.material; const mv = m.clone(); let fs = m.fragmentShader; let vs = m.vertexShader; const missed = [];
    for (const [a, b, which] of v.edits) { if (which === 'v') { if (!vs.includes(a)) missed.push(a.slice(0, 40)); vs = vs.split(a).join(b); } else { if (!fs.includes(a)) missed.push(a.slice(0, 40)); fs = fs.split(a).join(b); } }
    mv.fragmentShader = fs; mv.vertexShader = vs; mv.needsUpdate = true; mv.onBeforeCompile = m.onBeforeCompile; mv.customProgramCacheKey = () => 'variant-' + v.name;
    target.material = mv; time(); const ms = time();
    target.material = m; all.forEach((o) => { o.visible = true; });
    return { name: v.name, ms, missed };
  }, [pred, v]);
  console.log(JSON.stringify(res));
}
console.log('logs', logs.slice(0, 3).join(' | '));
await browser.close();
