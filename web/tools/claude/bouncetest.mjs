// Usage: PORT=4188 node bouncetest.mjs <mouthId>: the docked Argo flies into a mouth; logs whether it crosses back after arriving.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const [,, mouthId = 'wormhole-ton618'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 480, height: 270 }, deviceScaleFactor: 1 })).newPage();
await page.goto(`http://127.0.0.1:${process.env.PORT || 4188}/lab/fly-lab.html?start=projects&landed=1&q=0`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__compiledAt, null, { timeout: 900000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
await frames(10);
await page.evaluate((mouthId) => {
  const e = window.__expedition; const r = e.runtime; const ship = r.player.ship; const V = ship.position.constructor;
  r.mothership.docked = true; r.mothership.parked = false;
  const m = e.wormholes.find((w) => w.id === mouthId);
  const dir = new V(1, 0.2, 0.3).normalize();
  r.actions.place(m.position.clone().addScaledVector(dir, m.radius * 1.5), dir.clone().negate(), 1500);
}, mouthId);
for (let i = 0; i < 45; i++) {
  await frames(3);
  console.log(await page.evaluate((i) => {
    const e = window.__expedition; const r = e.runtime; const ship = r.player.ship;
    const d = e.wormholes.map((w) => (ship.position.distanceTo(w.position) / w.radius).toFixed(2)).join('/');
    const v = ship.velocity.length().toFixed(0);
    const out = e.wormholes.map((w) => ship.velocity.dot(ship.position.clone().sub(w.position).normalize()).toFixed(0)).join('/');
    return `${i} transit=${r.transit ? r.transit.t.toFixed(2) + '->' + r.transit.to : '-'} loading=${r.loading} r/R(sat/ton)=${d} speed=${v} radialV=${out} body=${r.currentBody?.id ?? '-'} anchor=${r.motion?.anchor?.id ?? r.motion?.anchorId ?? '?'}`;
  }, i));
}
await browser.close();
