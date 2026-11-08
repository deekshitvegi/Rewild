// Usage: PORT=4187 node mouthview.mjs <out.png> <start> <mouthId> [radii=7] [q=1]: the ship parked facing a mouth, a canvas shot.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, start = 'haven', mouthId = 'wormhole-ton618', radii = '7', q = '1'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 })).newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?start=${start}&landed=1&q=${q}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__compiledAt, null, { timeout: 900000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
await frames(10);
await page.evaluate(({ mouthId, radii }) => {
  const e = window.__expedition; const r = e.runtime; const ship = r.player.ship; const V = ship.position.constructor;
  const m = e.wormholes.find((w) => w.id === mouthId);
  const toHole = e.blackHole.position.clone().sub(m.position).normalize();
  const side = new V(0, 1, 0).cross(toHole).normalize();
  const dir = toHole.clone().multiplyScalar(-0.6).addScaledVector(side, 0.8).normalize();
  r.actions.place(m.position.clone().addScaledVector(dir, m.radius * radii), dir.clone().negate(), 0);
}, { mouthId, radii: +radii });
await frames(40);
await page.addStyleTag({ content: '.expedition-hud{display:none!important}' });
await frames(4);
await page.screenshot({ path: out, timeout: 600000 });
console.log(out, logs.join(' | '));
await browser.close();
