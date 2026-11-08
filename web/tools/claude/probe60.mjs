import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const [,, W, H, query, pred] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?${query}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three, null, { timeout: 180000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
await page.evaluate(async () => { const f0 = window.__fc; while (window.__fc < f0 + 18) await new Promise((r) => setTimeout(r, 100)); });
const res = await page.evaluate((pred) => {
  const { gl, scene, camera } = window.__three; const c = gl.getContext(); const px = new Uint8Array(4);
  const f = new Function('o', 'm', 'u', 'v', `return (${pred});`);
  const all = []; scene.traverseVisible((o) => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) all.push(o); });
  const target = all.find((o) => { const m = o.material; const u = m && m.uniforms ? Object.keys(m.uniforms).join(',') : ''; const g = o.geometry; const v = g ? (g.index ? g.index.count : 0) : 0; return f(o, m, u, v); });
  if (!target) return { error: 'none' };
  const time = () => { const t = []; for (let i = 0; i < 3; i++) { const t0 = performance.now(); gl.render(scene, camera); c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px); t.push(performance.now() - t0); } t.shift(); return Math.round(Math.min(...t)); };
  all.forEach((o) => { o.visible = false; }); target.visible = true;
  const g = target.geometry; const m = target.material;
  const info = { id: target.id, geo: g.type, instanceCount: g.instanceCount, drawRange: g.drawRange, attrs: Object.keys(g.attributes), defines: m.defines, frustumCulled: target.frustumCulled, parent: target.parent && target.parent.type, ud: JSON.stringify(target.userData).slice(0, 200), globeReady: m.uniforms.uGlobeReady && m.uniforms.uGlobeReady.value, globeFade: m.uniforms.uGlobeFade && m.uniforms.uGlobeFade.value, ord: target.renderOrder, depthTest: m.depthTest, depthWrite: m.depthWrite, side: m.side };
  const full = time();
  // Same vertex shader, flat fragment shader.
  const flat = m.clone(); flat.fragmentShader = `#include <common>\n#include <logdepthbuf_pars_fragment>\nvoid main(){\n#include <logdepthbuf_fragment>\ngl_FragColor=vec4(1.0,0.0,1.0,1.0);}`; flat.needsUpdate = true;
  target.material = flat; time(); const flatMs = time();
  // Count the pixels it covers.
  gl.setClearColor(0x000000, 1); gl.render(scene, camera);
  const W2 = gl.domElement.width, H2 = gl.domElement.height; const all2 = new Uint8Array(W2 * H2 * 4); c.readPixels(0, 0, W2, H2, c.RGBA, c.UNSIGNED_BYTE, all2);
  let covered = 0; for (let i = 0; i < W2 * H2; i++) if (all2[i * 4] > 200 && all2[i * 4 + 2] > 200 && all2[i * 4 + 1] < 50) covered++;
  target.material = m;
  all.forEach((o) => { o.visible = true; });
  return { ...info, full, flatMs, coverage: (covered / (W2 * H2)).toFixed(3) };
}, pred);
console.log(JSON.stringify(res, null, 1));
await browser.close();
