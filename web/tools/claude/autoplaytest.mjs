// Usage: node autoplaytest.mjs <url> [flag]  — Begin expedition WITHOUT the autoplay flag; log how the opening film's video behaves.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const [,, url, flag] = process.argv;
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];
if (flag) args.push('--autoplay-policy=' + flag);
const browser = await chromium.launch({ args });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const t0 = Date.now(); const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
page.on('pageerror', (e) => log('pageerror ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') log('console ' + m.text().slice(0, 150)); });
await page.addInitScript(() => {
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const muted = this.muted; const p = orig.call(this);
    p.then(() => console.log(`play ok muted=${muted}`)).catch((e) => console.error(`play refused muted=${muted}: ${e.name} ${e.message}`));
    return p;
  };
  document.addEventListener('error', (e) => { if (e.target instanceof HTMLMediaElement) console.error('media error ' + e.target.error?.code + ' ' + e.target.error?.message); }, true);
});
page.on('console', (m) => { if (m.text().startsWith('play')) log(m.text()); });
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
const launcher = page.locator('[data-experience-launcher="true"]:visible').first();
await launcher.waitFor({ state: 'visible', timeout: 300000 });
await launcher.click(); log('clicked');
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1500);
  log(JSON.stringify(await page.evaluate(() => { const v = document.querySelector('.rewild-film video'); return v ? { t: v.currentTime.toFixed(1), paused: v.paused, muted: v.muted, ended: v.ended, ready: v.readyState, net: v.networkState, err: v.error?.code ?? null, detail: document.querySelector('.rewild-film__detail')?.textContent?.slice(0, 40) } : null; })));
}
await browser.close();
