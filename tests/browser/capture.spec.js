import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
let context, worker, extensionId, temporary;
test.beforeAll(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'grab-a-page-test-'));
  const extension = path.join(temporary, 'extension');
  await cp(path.resolve('extension'), extension, { recursive: true });
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'chromium', headless: true,
    viewport: null,
    args: ['--window-size=1000,900', '--force-device-scale-factor=2', '--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
});
test.afterAll(async () => { await context?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); });

async function capture(page, { mode = 'full', settings = {}, control } = {}) {
  await page.bringToFront();
  const controller = await context.newPage();
  await controller.goto(`chrome-extension://${extensionId}/popup.html`);
  await controller.evaluate(async settings => {
    await chrome.storage.local.set({ settings: { maxDuration: 120, maxHeight: 30000, waitMs: 300, loadTimeout: 2000, ...settings } });
  }, settings);
  await page.bringToFront();
  // Invoke the actual extension action so Chrome grants activeTab to this source.
  const browserCdp = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab' }, { exclude: true }] });
  const targetInfo = targetInfos.find(target => target.url === page.url());
  expect(targetInfo, JSON.stringify(targetInfos)).toBeTruthy();
  await browserCdp.send('Extensions.triggerAction', { id: extensionId, targetId: targetInfo.targetId });
  await browserCdp.detach();
  await page.bringToFront();
  const previewPromise = context.waitForEvent('page', { predicate: p => p !== controller, timeout: 110000 });
  const response = await controller.evaluate(mode => chrome.runtime.sendMessage({ type: 'start', mode }), mode);
  expect(response.ok, response.error).toBe(true);
  if (control) await control(controller);
  const preview = await previewPromise;
  await preview.waitForURL(`chrome-extension://${extensionId}/preview.html*`);
  await preview.waitForLoadState();
  const session = await preview.evaluate(async id => (await import('./lib/db.js')).getSession(id), response.id);
  expect(session.tiles.length, session.warnings.join(' ')).toBeGreaterThan(0);
  await expect(preview.locator('#download')).toBeEnabled({ timeout: 30000 });
  await controller.close();
  return { preview, session };
}
async function pixel(preview, x, y) {
  return preview.evaluate(async ({ x, y }) => {
    const image = document.querySelector('.part img');
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
  }, { x, y });
}
test('full page loads lazy images, stitches seams at Retina scale, and restores the page', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/finite');
  await page.evaluate(() => scrollTo({ top: 430, behavior: 'instant' }));
  const { preview, session } = await capture(page);
  expect(session.status).toBe('complete');
  expect(session.height).toBe(4050);
  expect(session.scale).toBe(2);
  expect(session.tiles.length).toBeGreaterThan(5);
  expect(await page.evaluate(() => scrollY)).toBe(430);
  expect(await page.locator('#header').evaluate(el => el.style.visibility)).toBe('');
  expect(await page.locator('#chat').evaluate(el => el.style.visibility)).toBe('');
  expect(await page.locator('#grab-a-page-controls').count()).toBe(0);
  expect(await page.locator('img[data-loaded="yes"]').count()).toBe(8);
  // Every section's reserved image rectangle contains the lazy-loaded image,
  // including sections absent from the initial viewport.
  for (let i = 0; i < 8; i++) expect(await pixel(preview, 780, (i * 500 + 130) * 2)).toEqual([243, 108, 56]);
  // Sample both sides of all stitching seams away from text and overlays.
  const palette = [[228,189,170],[185,213,201],[175,199,231],[233,212,157],[205,187,220],[229,184,200]];
  for (const tile of session.tiles.slice(1)) {
    const edge = Math.round((tile.y + tile.height) * 2);
    for (const y of [edge - 2, edge + 2]) if (y < 8000) expect(await pixel(preview, 20, y)).toEqual(palette[Math.floor(y / 1000) % 6]);
  }
  await preview.screenshot({ path: 'test-results/preview.png' });
  const downloadPromise = preview.waitForEvent('download');
  await preview.locator('#download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(await download.failure()).toBeNull();
  await preview.close(); await page.close();
});
test('visible area captures exactly the viewport including fixed widgets', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/finite');
  await page.evaluate(() => scrollTo({ top: 1100, behavior: 'instant' }));
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio }));
  const { preview, session } = await capture(page, { mode: 'visible' });
  expect(session.height).toBe(Math.round(viewport.height * viewport.scale)); expect(session.width).toBe(Math.round(viewport.width * viewport.scale));
  expect(session.tiles).toHaveLength(1);
  expect(await page.evaluate(() => scrollY)).toBe(1100);
  expect(await pixel(preview, 10, 10)).toEqual([37, 77, 63]);
  await preview.close(); await page.close();
});
test('height limit returns a labeled partial result on an infinite feed', async () => {
  const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/infinite?sections=2');
  const { preview, session } = await capture(page, { settings: { maxHeight: 2000 } });
  expect(session.height).toBe(2000); expect(session.status).toBe('partial');
  expect(session.warnings.join(' ')).toContain('maximum page height');
  await expect(preview.locator('#badge')).toHaveText('Incomplete');
  await preview.close(); await page.close();
});
test('Finish now and cancellation preserve captured sections and restore scrolling', async () => {
  for (const action of ['finish', 'cancel']) {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/finite?sections=30');
    await page.evaluate(() => scrollTo({ top: 300, behavior: 'instant' }));
    const { preview, session } = await capture(page, { control: async controller => {
      await expect.poll(() => controller.evaluate(() => chrome.runtime.sendMessage({ type: 'status' })).then(s => s.tiles)).toBeGreaterThanOrEqual(2);
      await controller.evaluate(type => chrome.runtime.sendMessage({ type }), action);
    } });
    expect(session.status).toBe(action === 'finish' ? 'partial' : 'cancelled');
    expect(session.height).toBeLessThan(15050);
    expect(await page.evaluate(() => scrollY)).toBe(300);
    await preview.close(); await page.close();
  }
});
test('failed source images produce an explicit incomplete warning', async () => {
  const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/finite?sections=4&broken=1');
  const { preview, session } = await capture(page);
  expect(session.status).toBe('partial');
  expect(session.warnings.join(' ')).toContain('failed to load');
  await preview.close(); await page.close();
});
test('large captures split into numbered full-resolution PNGs', async () => {
  const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/finite?sections=18');
  const { preview, session } = await capture(page);
  expect(session.height).toBe(9050);
  await expect(preview.locator('.part')).toHaveCount(2);
  const names = await preview.locator('.part-header a').evaluateAll(links => links.map(link => link.download));
  expect(names[0]).toContain('-part-01.png'); expect(names[1]).toContain('-part-02.png');
  await preview.close(); await page.close();
});
test('Escape from the source page cancels through the content script', async () => {
  const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/finite?sections=30');
  const { preview, session } = await capture(page, { control: async controller => {
    await expect.poll(() => controller.evaluate(() => chrome.runtime.sendMessage({ type: 'status' })).then(s => s.tiles)).toBeGreaterThanOrEqual(1);
    await page.keyboard.press('Escape');
  } });
  expect(session.status).toBe('cancelled');
  expect(await page.locator('#grab-a-page-controls').count()).toBe(0);
  await preview.close(); await page.close();
});
test('virtualized offscreen sections are captured while rendered', async () => {
  const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/virtual?sections=6');
  const { preview, session } = await capture(page);
  expect(session.status).toBe('complete');
  for (let i = 0; i < 6; i++) expect(await pixel(preview, 780, (i * 500 + 130) * 2)).toEqual([243, 108, 56]);
  await preview.close(); await page.close();
});
test('capture duration is bounded and produces a usable partial PNG', async () => {
  const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/finite?sections=30');
  const { preview, session } = await capture(page, { settings: { maxDuration: 10, waitMs: 5000, loadTimeout: 5000 } });
  expect(session.status).toBe('partial');
  expect(session.warnings.join(' ')).toContain('maximum capture duration');
  expect(session.endedAt - session.createdAt).toBeLessThan(12000);
  await preview.close(); await page.close();
});
