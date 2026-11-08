// Usage: node sitecheck.mjs <label> <W> <H> <detail 0|1|2> <seconds-in-game> [port]
// Opens the served preview copy, begins the expedition, flies forward for a while, and reports CSP violations,
// page errors, failed requests, and frame times. Writes <label>.log and <label>-*.png.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const [,, label, W, H, detail = '2', seconds = '40', port = '4190'] = process.argv;
const out = [];
const log = (s) => { out.push(s); console.log(s); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
await ctx.addInitScript((detail) => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  try { localStorage.setItem('expedition-graphics', JSON.stringify({ detail: Number(detail), resolution: 'auto' })); } catch {}
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 12 });
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { const m = this.muted; const p = play.call(this); p.then(() => console.log('media: play ok muted=' + m)).catch((e) => console.log('media: play refused muted=' + m + ' ' + e.name)); return p; };
  for (const ev of ['error', 'ended', 'stalled', 'emptied', 'abort']) document.addEventListener(ev, (e) => { if (e.target instanceof HTMLMediaElement) console.log('media: ' + ev + ' t=' + e.target.currentTime.toFixed(1) + ' err=' + (e.target.error ? e.target.error.code + ' ' + e.target.error.message : '-') + ' src=' + e.target.currentSrc.split('/').pop()); }, true);
}, detail);
const page = await ctx.newPage();
const t0 = Date.now();
page.on('pageerror', (e) => log('pageerror: ' + e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') log('console error: ' + m.text().slice(0, 300)); else if (m.text().startsWith('media:')) log(`${Math.round((Date.now() - t0) / 1000)} s ${m.text()}`); });
page.on('requestfailed', (r) => log('request failed: ' + r.url().slice(0, 160) + ' ' + (r.failure()?.errorText ?? '')));
page.on('response', (r) => { if (r.status() >= 400) log(`http ${r.status()}: ${r.url().slice(0, 160)}`); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(8000);
const begin = page.getByRole('button', { name: /begin expedition/i }).first();
await begin.waitFor({ timeout: 180000 });
// The button does nothing until the intro has finished: press until the loading screen shows.
for (let attempt = 0; attempt < 6; attempt++) {
  await page.waitForTimeout(4000);
  await begin.click({ timeout: 60000, force: true }).catch(() => {});
  await page.waitForTimeout(4000);
  const started = await page.evaluate(() => /Preparing the expedition/.test(document.body.innerText) || !!document.querySelector('.expedition-hud'));
  if (started) break;
}
log(`clicked begin at ${Math.round((Date.now() - t0) / 1000)} s`);
// In the game: the canvas and the HUD.
await page.waitForFunction(() => !!document.querySelector('.expedition-hud'), null, { timeout: 600000, polling: 1000 });
log(`hud at ${Math.round((Date.now() - t0) / 1000)} s`);
await page.waitForTimeout(6000);
await page.screenshot({ path: `${label}-start.png`, timeout: 600000 });
await page.evaluate(() => { window.__gaps = []; let last = performance.now(); const loop = (t) => { window.__gaps.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
await page.keyboard.down('KeyW');
await page.waitForTimeout(+seconds * 1000);
await page.keyboard.up('KeyW');
await page.screenshot({ path: `${label}-flown.png`, timeout: 600000 });
const gaps = (await page.evaluate(() => window.__gaps)).sort((a, b) => a - b);
const q = (p) => Math.round(gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] ?? 0);
log(`frames ${gaps.length} median ${q(0.5)} ms p90 ${q(0.9)} ms max ${q(1)} ms`);
const csp = await page.evaluate(() => window.__csp);
log(`csp violations: ${csp.length}${csp.length ? ' · ' + [...new Set(csp)].slice(0, 8).join(' | ') : ''}`);
fs.writeFileSync(`${label}.log`, out.join('\n') + '\n');
await browser.close();
