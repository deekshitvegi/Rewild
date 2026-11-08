// Usage: PORT=4187 node crosstest2.mjs <outdir> [start=projects]   (FilmPlayer version: logs bar, caption, Skip; presses Skip once ready)
// The Argo crosses the wormhole from the start system to the other one and back: the region swap, the
// film over it, the crossing held until the other system is ready, then opening out. Logs state and shots.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, start = 'projects'] = process.argv;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: +(process.env.W || 640), height: +(process.env.H || 360) }, deviceScaleFactor: 1 })).newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?start=${start}&landed=1&q=${process.env.Q || 0}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__expedition && !!window.__three && !!window.__compiledAt, null, { timeout: 900000, polling: 500 });
await page.evaluate(() => { window.__fc = 0; const loop = () => { window.__fc++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
const frames = (n) => page.evaluate(async (n) => { const f0 = window.__fc; while (window.__fc < f0 + n) await new Promise((r) => setTimeout(r, 100)); }, n);
const t0 = Date.now();
const state = (label) => page.evaluate((label) => {
  const e = window.__expedition; const r = e.runtime; const ship = r.player.ship; const gl = window.__three.gl;
  const film = document.querySelector('.rewild-film');
  let objects = 0; window.__three.scene.traverse(() => { objects++; });
  const video = film?.querySelector('video');
  return `${label} | region=${r.region} loading=${r.loading} transit=${r.transit ? r.transit.t.toFixed(2) + '->' + r.transit.to : '-'} film=${film ? (film.className.replace('rewild-film', '').trim() || 'on') + ' ' + (film.querySelector('.rewild-film__percent')?.textContent ?? '') + (film.querySelector('.rewild-film__skip') ? ' [skip]' : '') + ' «' + (film.querySelector('.rewild-film__caption')?.textContent ?? '') + '»' : '-'} video=${video ? (video.currentTime.toFixed(1) + '/' + (video.duration || 0).toFixed(1) + (video.paused ? ' paused' : '')) : '-'} body=${r.currentBody?.id ?? '-'} programs=${gl.info.programs.length} geoms=${gl.info.memory.geometries} objects=${objects} toTON=${(ship.position.distanceTo(e.blackHole.position) / 1e6).toFixed(1)}M`;
}, label);
const log = async (label) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${await state(label)}`);
await frames(20);
await log('start');
const cross = async (mouthId, tag) => {
  await page.evaluate((mouthId) => {
    const e = window.__expedition; const r = e.runtime; const ship = r.player.ship; const V = ship.position.constructor;
    r.mothership.docked = true; r.mothership.parked = false;
    const m = e.wormholes.find((w) => w.id === mouthId);
    const dir = new V(1, 0.2, 0.3).normalize();
    r.actions.place(m.position.clone().addScaledVector(dir, m.radius * 1.5), dir.clone().negate(), 1500);
  }, mouthId);
  let shots = 0;
  for (let i = 0; i < 200; i++) {
    await frames(4);
    await log(`${tag} ${i}`);
    const s = await page.evaluate(() => {
      const f = document.querySelector('.rewild-film'); const v = f?.querySelector('video');
      return { transit: !!window.__expedition.runtime.transit, film: !!f, t: v ? v.currentTime : 0, caption: !!f?.querySelector('.rewild-film__caption'), skip: !!f?.querySelector('.rewild-film__skip') };
    });
    if (shots === 0 && s.film && s.t > 1.5) { await page.screenshot({ path: `${out}/${tag}-1-film.png`, timeout: 600000 }); shots = 1; }
    if (shots === 1 && s.caption) { await page.screenshot({ path: `${out}/${tag}-2-caption.png`, timeout: 600000 }); shots = 2; }
    if (shots >= 1 && shots < 3 && s.skip) { await page.screenshot({ path: `${out}/${tag}-3-ready.png`, timeout: 600000 }); shots = 3; await page.keyboard.press('Enter'); await log(`${tag} Enter pressed`); }
    if (shots >= 1 && !s.film && !s.transit) { await frames(6); await page.screenshot({ path: `${out}/${tag}-4-arrived.png`, timeout: 600000 }); break; }
  }
};
const first = start === 'haven' ? 'wormhole-ton618' : 'wormhole-saturn';
const second = first === 'wormhole-saturn' ? 'wormhole-ton618' : 'wormhole-saturn';
await cross(first, 'there');
await frames(10);
await log('there, settled');
await cross(second, 'back');
await frames(10);
await log('back, settled');
console.log('logs:', [...new Set(logs)].slice(0, 12).join(' | '));
await browser.close();
