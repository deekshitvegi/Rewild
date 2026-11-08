// node film.mjs <out dir> <scene earth|moon|jump> [W=640] [H=360] [port=4195] [physics=new|old] [every=1]
// Films viewer.html frame by frame (30 a second of game time, each frame stepped by hand, so a
// slow software renderer still gives smooth motion) as JPEGs out/f00000.jpg...; then e.g.
//   ffmpeg -framerate 30 -i out/f%05d.jpg -c:v libx264 -pix_fmt yuv420p -crf 20 out.mp4
// Also logs the time each frame took to step (the explorer's per-frame work) to out/steps.json.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, out, scene = 'earth', W = '640', H = '360', port = '4195', physics = 'new', everyArg = '1'] = process.argv;
const every = +everyArg;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${port}/source_assets/astronaut/viewer.html?scene=${scene}&physics=${physics}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__viewer && window.__viewer.ready(), null, { timeout: 300000, polling: 500 });
const duration = await page.evaluate(() => window.__viewer.duration);
const frames = Math.round(duration * 30);
console.log('ready; frames', frames);
const steps = [];
for (let n = 0; n < frames; n++) {
  const res = await page.evaluate((shoot) => {
    const t0 = performance.now();
    window.__viewer.step(1);
    const ms = performance.now() - t0;
    const url = shoot ? document.querySelector('canvas').toDataURL('image/jpeg', 0.9) : null;
    return { ms, url, t: window.__viewer.time() };
  }, n % every === 0);
  steps.push(+res.ms.toFixed(2));
  if (res.url) fs.writeFileSync(`${out}/f${String(n / every | 0).padStart(5, '0')}.jpg`, Buffer.from(res.url.split(',')[1], 'base64'));
  if (n % 150 === 0) console.log('frame', n, 't', res.t.toFixed(2), 'step ms', res.ms.toFixed(1));
}
fs.writeFileSync(`${out}/steps.json`, JSON.stringify(steps));
console.log('done', frames, 'logs:', logs.slice(0, 8).join(' | '));
await browser.close();
