// Usage: PORT=4187 node halcytest.mjs <outdir>
// The Halcyon: approach her bay, dock (U), undock (U), the fighter turned back at the wormhole, the Halcyon crossing.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const [,, out] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +(process.env.W || 960), height: +(process.env.H || 540) }, deviceScaleFactor: 1 })).newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') logs.push('console: ' + m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?start=projects&landed=1`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three && !!window.__expedition.runtime.hud.ship, null, { timeout: 180000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
const state = (label) => page.evaluate((label) => {
  const r = window.__expedition.runtime; const h = r.mothership; const ship = r.player.ship;
  const V = ship.position.constructor; const Q = ship.quaternion.constructor;
  return `${label} | mode=${r.mode} body=${r.currentBody ? r.currentBody.id : '-'} alt=${Math.round(r.altitude)} docked=${h.docked} docking=${!!h.docking} speed=${Math.round(ship.velocity.length())} notice="${ship.notice}" toTON=${(ship.position.distanceTo(window.__expedition.blackHole.position) / 1e6).toFixed(1)}M`;
}, label);
const shot = async (name) => { await frames(10); await page.screenshot({ path: `${out}/${name}.png`, timeout: 600000 }); };
await frames(30);
console.log(await state('start'));
// Off the ground, in front of her bay, facing her.
const placed = await page.evaluate(() => {
  const e = window.__expedition; const r = e.runtime; const h = r.mothership; const ship = r.player.ship;
  const V = ship.position.constructor; const Q = ship.quaternion.constructor;
  if (!h.placed) return 'not placed';
  const p = new V(); const q = new Q();
  // shipPose of the held Halcyon via the module's own export is not on window: use the parked pose (Earth is the anchor: identity).
  // Held in Earth's frame (from its centre); Earth is the anchor, unturned.
  p.copy(h.ship.position).add(h.home.position); q.copy(h.ship.quaternion);
  const fwd = new V(0, 0, -1).applyQuaternion(q);
  const bay = new V(0, 0, -166).applyQuaternion(q).add(p);
  const at = bay.clone().addScaledVector(fwd, 120);
  r.actions.place(at, fwd.clone().negate(), 0, new V(0, 1, 0).applyQuaternion(q));
  ship.velocity.set(0, 0, 0); ship.throttle = 0;
  return `placed ${Math.round(at.distanceTo(bay))} m from bay`;
});
console.log(placed);
await frames(20);
console.log(await state('at bay'));
await shot('1-approach');
await page.evaluate(() => window.__expedition.input.pressed.add('KeyU'));
await frames(70);
console.log(await state('after U'));
await shot('2-docked');
// Fly her a little: throttle up.
await page.keyboard.down('KeyW'); await frames(25); await page.keyboard.up('KeyW');
console.log(await state('flying her'));
await shot('3-flying-halcyon');
await page.evaluate(() => window.__expedition.input.pressed.add('KeyU'));
await frames(25);
console.log(await state('undocked'));
await shot('4-undocked');
// The fighter alone at the wormhole by Saturn.
await page.evaluate(() => {
  const e = window.__expedition; const r = e.runtime; const ship = r.player.ship; const V = ship.position.constructor;
  const m = e.wormholes.find((w) => w.id === 'wormhole-saturn');
  const dir = new V(1, 0.2, 0.3).normalize();
  r.actions.place(m.position.clone().addScaledVector(dir, m.radius * 1.6), dir.clone().negate(), 900);
});
await frames(40);
console.log(await state('fighter at throat'), await page.evaluate(() => { const e = window.__expedition; const m = e.wormholes.find((w) => w.id === 'wormhole-saturn'); return 'r/radius=' + (e.runtime.player.ship.position.distanceTo(m.position) / m.radius).toFixed(2); }));
await shot('5-turned-back');
// The Halcyon at the wormhole (test harness: docked in place) flies in and crosses.
await page.evaluate(() => {
  const e = window.__expedition; const r = e.runtime; const ship = r.player.ship; const V = ship.position.constructor;
  r.mothership.docked = true; r.mothership.parked = false;
  const m = e.wormholes.find((w) => w.id === 'wormhole-saturn');
  const dir = new V(1, 0.2, 0.3).normalize();
  r.actions.place(m.position.clone().addScaledVector(dir, m.radius * 1.5), dir.clone().negate(), 1500);
});
for (let i = 0; i < 8; i++) { await frames(15); console.log(await state('argo in ' + i)); }
await shot('6-crossed');
console.log('logs:', logs.slice(0, 6).join(' | '));
await browser.close();
