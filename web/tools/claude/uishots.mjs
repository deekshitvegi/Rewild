// Usage: PORT=4187 node uishots.mjs <outdir> [viewport names,comma] [panels,comma]
// Opens the expedition (landed on Earth, low detail, small render scale so SwiftShader keeps up) at each
// viewport and screenshots the HUD plus each panel it can open with a key. Touch viewports get touch input.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';

const [,, outDir, only, panelsArg] = process.argv;
const VIEWPORTS = [
  { name: 'phone-p', width: 390, height: 844, touch: true },
  { name: 'phone-l', width: 844, height: 390, touch: true },
  { name: 'phone-small', width: 360, height: 640, touch: true },
  { name: 'tablet-p', width: 820, height: 1180, touch: true },
  { name: 'tablet-l', width: 1180, height: 820, touch: true },
  { name: 'claude-pane', width: 640, height: 860, touch: false },
  { name: 'laptop', width: 1366, height: 768, touch: false },
  { name: 'desktop', width: 1920, height: 1080, touch: false },
  { name: 'ultrawide', width: 2560, height: 1080, touch: false },
];
const PANELS = [
  { name: 'story', key: 'KeyJ' },
  { name: 'graphics', key: 'KeyO' },
  { name: 'map', key: 'KeyM' },
  { name: 'craft', key: 'KeyC' },
  { name: 'help', key: 'KeyH' },
];
const wanted = only ? only.split(',') : null;
const panels = panelsArg ? PANELS.filter((p) => panelsArg.split(',').includes(p.name)) : PANELS;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
for (const v of VIEWPORTS.filter((v) => !wanted || wanted.includes(v.name))) {
  const ctx = await browser.newContext({
    viewport: { width: v.width, height: v.height }, deviceScaleFactor: 1, hasTouch: v.touch, isMobile: v.touch,
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('expedition-graphics', JSON.stringify({ detail: 0, resolution: 0.35 })); } catch {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await page.goto(`http://127.0.0.1:${process.env.PORT || 4187}/lab/fly-lab.html?start=earth&landed=1&q=0`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!document.querySelector('.expedition-hud'), null, { timeout: 600000, polling: 1000 });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${outDir}/${v.name}-hud.png`, timeout: 600000 });
  const overflow = await page.evaluate(() => {
    // Elements that stick out of the viewport, or text that is clipped inside its box.
    const out = [];
    const W = innerWidth, H = innerHeight;
    for (const el of document.querySelectorAll('.expedition-hud *, [class*="panel"] *')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > W + 1 || r.left < -1 || r.bottom > H + 1 || r.top < -1) out.push(`${el.className || el.tagName} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]`);
    }
    return [...new Set(out)].slice(0, 12);
  });
  console.log(`${v.name}: hud ok${overflow.length ? ' · off-screen: ' + overflow.join(' | ') : ''}`);
  for (const p of panels) {
    await page.keyboard.press(p.key);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${outDir}/${v.name}-${p.name}.png`, timeout: 600000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }
  if (errors.length) console.log(`  errors: ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}
await browser.close();
