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
  expect(session.imageOutput).toBe('single');
  await expect(preview.locator('.part')).toHaveCount(1);
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
test('gradual scrolling waits for reveals and captures tall sticky content once in document flow', async () => {
  const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/motion');
  const { preview, session } = await capture(page);
  expect(session.status).toBe('complete');
  expect(session.height).toBe(3450);
  for (const [y, color] of [[950, [255,0,0]], [1250, [0,255,0]], [1550, [0,0,255]], [1850, [255,255,0]], [2200, [255,255,255]]]) {
    expect(await pixel(preview, 20, y * session.scale)).toEqual(color);
  }
  for (const y of [1150, 1650, 2150, 2650, 3150]) {
    expect(await pixel(preview, Math.round(session.width * .75 * session.scale), y * session.scale)).toEqual([0,136,255]);
  }
  const restored = await page.locator('#panel').evaluate(el => ({ position: getComputedStyle(el).position, top: getComputedStyle(el).top, style: el.getAttribute('style') }));
  expect(restored).toEqual({ position: 'sticky', top: '60px', style: '' });
  const steps = await page.evaluate(() => scrollSteps);
  expect(steps.length).toBeGreaterThan(session.tiles.length * 3);
  expect(await page.evaluate(() => scrollY)).toBe(0);
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
test('large captures default to one full-resolution PNG and retain that output when reopened', async () => {
  const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/finite?sections=18');
  const { preview, session } = await capture(page);
  expect(session.height).toBe(9050);
  expect(session.imageOutput).toBe('single');
  await expect(preview.locator('.part')).toHaveCount(1);
  const image = preview.locator('.part img');
  expect(await image.evaluate(async img => { await img.decode(); return [img.naturalWidth, img.naturalHeight]; }))
    .toEqual([session.width * session.scale, 18100]);
  expect(await pixel(preview, 20, 18090)).toEqual([34, 51, 68]);
  expect(await preview.locator('.part-header a').getAttribute('download')).not.toContain('-part-');
  await preview.evaluate(() => chrome.storage.local.set({ settings: { imageOutput: 'multiple' } }));
  await preview.reload();
  await expect(preview.locator('#download')).toBeEnabled();
  await expect(preview.locator('.part')).toHaveCount(1);
  await preview.close(); await page.close();
});
test('large captures can still split into numbered full-resolution PNGs', async () => {
  const page = await context.newPage(); await page.goto('http://127.0.0.1:4173/finite?sections=18');
  const { preview, session } = await capture(page, { settings: { imageOutput: 'multiple' } });
  expect(session.height).toBe(9050);
  await expect(preview.locator('.part')).toHaveCount(2);
  const names = await preview.locator('.part-header a').evaluateAll(links => links.map(link => link.download));
  expect(names[0]).toContain('-part-01.png'); expect(names[1]).toContain('-part-02.png');
  await preview.close(); await page.close();
});
test('popup saves and restores the image output setting with single image as the default', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate(() => chrome.storage.local.remove('settings'));
  await popup.reload();
  await popup.locator('body').screenshot({ path: 'test-results/popup.png' });
  await popup.locator('summary').click();
  await expect(popup.locator('select[name="imageOutput"]')).toHaveValue('single');
  await popup.screenshot({ path: 'test-results/settings.png' });
  await popup.locator('select[name="imageOutput"]').selectOption('multiple');
  await popup.locator('button[type="submit"]').click();
  await expect(popup.locator('#saved')).toHaveText('Saved');
  await popup.reload();
  await expect(popup.locator('select[name="imageOutput"]')).toHaveValue('multiple');
  await popup.close();
});
test('settings animation reverses smoothly without clipping focus or shifting the header', async () => {
  const popup = await context.newPage();
  try {
    await popup.setViewportSize({ width: 460, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('summary')).toHaveAttribute('aria-expanded', 'false');
    await popup.evaluate(() => document.fonts.ready);
    const motion = await popup.evaluate(async () => {
      const details = document.querySelector('details');
      const summary = details.querySelector('summary');
      const panel = details.querySelector('.settings-panel');
      summary.focus();
      const top = summary.getBoundingClientRect().top;
      summary.click();
      const animation = panel.getAnimations()[0];
      for (let frame = 0; frame < 4; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
      const before = panel.getBoundingClientRect().height;
      summary.click();
      const after = panel.getBoundingClientRect().height;
      // reverse() applies its pending playback rate on the next animation frame.
      await animation.ready;
      const reversed = panel.getAnimations()[0] === animation && animation.playbackRate < 0;
      summary.click();
      await animation.finished;
      await new Promise(resolve => requestAnimationFrame(resolve));
      return { before, after, reversed, reused: panel.getAnimations().length === 0,
        overflow: getComputedStyle(details).overflow, scroll: details.scrollTop,
        top, finalTop: summary.getBoundingClientRect().top, focused: document.activeElement === summary };
    });
    expect(motion.before).toBeGreaterThan(0);
    expect(Math.abs(motion.after - motion.before)).toBeLessThan(1);
    expect(motion.reversed).toBe(true);
    expect(motion.reused).toBe(true);
    expect(motion.overflow).toBe('visible');
    expect(motion.scroll).toBe(0);
    expect(motion.finalTop).toBe(motion.top);
    expect(motion.focused).toBe(true);
    await popup.locator('summary').dblclick();
    await expect(popup.locator('details')).not.toHaveClass(/is-animating/);
    await expect(popup.locator('details')).toHaveJSProperty('open', true);
    expect(await popup.locator('summary').evaluate(el => el.getBoundingClientRect().top)).toBe(motion.top);
    await popup.locator('select').selectOption('multiple');
    await popup.locator('button[type="submit"]').click();
    await expect(popup.locator('#saved')).toHaveText('Saved');
    await popup.locator('summary').press('Enter');
    await expect(popup.locator('details')).toHaveJSProperty('open', false);
    await expect(popup.locator('form')).toHaveJSProperty('inert', true);
    expect(await popup.locator('.settings-panel').getAttribute('style')).toBeNull();
  } finally { await popup.close(); }
});
test('settings honor reduced motion even when the preference changes during a transition', async () => {
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('summary')).toHaveAttribute('aria-expanded', 'false');
    await popup.locator('summary').click();
    await popup.emulateMedia({ reducedMotion: 'reduce' });
    await expect(popup.locator('details')).not.toHaveClass(/is-animating/);
    await expect(popup.locator('details')).toHaveJSProperty('open', true);
    await popup.locator('summary').press('Space');
    await expect(popup.locator('details')).toHaveJSProperty('open', false);
    await popup.locator('summary').press('Enter');
    await expect(popup.locator('details')).toHaveJSProperty('open', true);
    expect(await popup.locator('.settings-panel').evaluate(el => el.getAnimations().length)).toBe(0);
    await expect(popup.locator('form')).toHaveJSProperty('inert', false);
    await popup.locator('button[type="submit"]').click();
    await expect(popup.locator('#saved')).toHaveText('Saved');
  } finally { await popup.close(); }
});
test('saved sections stitch into one PNG beyond full-canvas height limits', async () => {
  const preview = await context.newPage();
  await preview.goto(`chrome-extension://${extensionId}/popup.html`);
  const id = await preview.evaluate(async () => {
    const { putSession, putTile } = await import('./lib/db.js');
    const id = crypto.randomUUID();
    const tiles = [];
    for (let y = 0; y < 40050; y += 1000) {
      const canvas = document.createElement('canvas');
      canvas.width = 48; canvas.height = Math.min(1000, 40050 - y);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = (y / 1000) % 2 ? '#00ff00' : '#ff0000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const tile = { key: `${id}:${tiles.length}`, sessionId: id, y, width: 48, height: canvas.height,
        pixelWidth: 48, pixelHeight: canvas.height };
      await putTile({ ...tile, blob });
      tiles.push(tile);
    }
    // Legacy captures without an output preference also default to one PNG.
    await putSession({ id, title: 'Tall saved page', createdAt: Date.now(), endedAt: Date.now(), mode: 'full',
      status: 'complete', warnings: [], width: 48, height: 40050, scale: 1, tiles });
    return id;
  });
  await preview.goto(`chrome-extension://${extensionId}/preview.html?id=${id}`);
  await expect(preview.locator('#download')).toBeEnabled();
  await expect(preview.locator('.part')).toHaveCount(1);
  expect(await preview.locator('.part img').evaluate(async img => { await img.decode(); return [img.naturalWidth, img.naturalHeight]; }))
    .toEqual([48, 40050]);
  expect(await pixel(preview, 20, 999)).toEqual([255, 0, 0]);
  expect(await pixel(preview, 20, 1000)).toEqual([0, 255, 0]);
  expect(await pixel(preview, 20, 33000)).toEqual([0, 255, 0]);
  expect(await pixel(preview, 20, 40049)).toEqual([255, 0, 0]);
  await preview.close();
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
