import { chromium } from '@playwright/test';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Run against the current out/ build. Hold an optional download to prove the initial city
// is visible independently, then check that the full scene resumes and mobile stays bounded.
const url = process.env.TEST_URL ?? 'http://localhost:3000';
await mkdir('test-results', { recursive: true });
let trafficChunk, glbChunk;
for (const file of await readdir('out/_next/static/chunks')) {
  if (!file.endsWith('.js')) continue;
  const source = await readFile(`out/_next/static/chunks/${file}`, 'utf8');
  if (source.includes('vehicle-traffic')) trafficChunk = file;
  if (source.includes('A GLB URL is required.')) glbChunk = file;
}
assert.ok(trafficChunk && glbChunk, 'Build the app before running the startup check');
const browser = await chromium.launch({
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
page.setDefaultTimeout(120000);
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'gpu', { value: undefined });
  // Count actual GPU draw submissions, not requestAnimationFrame callbacks or DOM updates.
  window.startupDraws = 0;
  for (const method of ['drawElements', 'drawElementsInstanced', 'drawArrays']) {
    const original = WebGL2RenderingContext.prototype[method];
    WebGL2RenderingContext.prototype[method] = function (...args) {
      window.startupDraws++;
      return original.apply(this, args);
    };
  }
});
const requests = [],
  errors = [];
page.on('request', (r) => requests.push(r.url()));
page.on('pageerror', (e) => errors.push(e.message));
let release;
const held = new Promise((resolve) => {
  release = resolve;
});
await page.route(`**/${trafficChunk}`, async (route) => {
  await held;
  await route.continue().catch(() => {}); // The page can close while a failed assertion cleans up.
});
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('canvas')?.dataset.preview === 'ready');
  // The staged overlay stays up over the rendered preview while the rest of the city fills in,
  // and it reports which chapter it is on.
  const overlay = page.locator('.loading-screen');
  await overlay.waitFor({ state: 'visible' });
  assert.equal(await overlay.getAttribute('data-preview'), 'ready');
  assert.ok(await overlay.getAttribute('data-stage'), 'the overlay reports a startup chapter');
  assert.equal(
    await page.getByRole('button', { name: 'Next stop', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.locator('canvas').getAttribute('data-backend'), null);
  const previewDraws = await page.evaluate(() => window.startupDraws);
  await page.waitForFunction((before) => window.startupDraws > before, previewDraws, {
    timeout: 15000,
  });
  console.log(
    'PASS: the starting city keeps rendering while traffic is still downloading; tour controls wait.',
  );
  release();
  await page.waitForFunction(() => document.querySelector('canvas')?.dataset.backend);
  // Only a city that is finished and compiled replaces the loading screen.
  await overlay.waitFor({ state: 'hidden' });
  assert.equal(
    requests.some((r) => r.endsWith(glbChunk)),
    true,
    'every district uses the GLB loader',
  );
  assert.equal(
    requests.some((r) => r.includes('fonts.googleapis') || r.includes('fonts.gstatic')),
    false,
  );
  await page.screenshot({ path: 'test-results/optimized-desktop-hub.png' });
  await page.getByRole('button', { name: 'Next stop', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('canvas')?.dataset.selected === 'glm');
  await page.screenshot({ path: 'test-results/optimized-desktop-shop.png' });
  await page.getByRole('button', { name: 'Night mode', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('canvas')?.dataset.lighting === 'night');
  await page.screenshot({ path: 'test-results/optimized-desktop-night.png' });
  // Release the desktop GPU workload before checking the independent mobile scene.
  await page.close();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    reducedMotion: 'reduce',
  });
  mobile.setDefaultTimeout(120000);
  mobile.on('pageerror', (e) => errors.push(e.message));
  await mobile.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
  await mobile.goto(url);
  await mobile.waitForFunction(() => document.querySelector('canvas')?.dataset.backend);
  const density = await mobile.locator('canvas').evaluate((c) => c.width / c.clientWidth);
  assert.ok(density <= 1.25 && density > 1.2, `mobile GPU density: ${density}`);
  await mobile.screenshot({ path: 'test-results/optimized-mobile-hub.png' });
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'PASS: deferred GLB loading, local fonts, day/night views, mobile pixel budget, no browser errors.',
  );
} finally {
  release();
  await browser.close();
}
