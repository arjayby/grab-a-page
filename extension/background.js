import { normalizeSettings } from './lib/settings.js';
import { putSession, putTile, getSession, pruneSessions } from './lib/db.js';

let job = null;
let lastCaptureAt = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sessionView = () => ({ running: !!job, tiles: job?.session.tiles.length || 0, height: Math.round(job?.session.height || 0) });

async function page(current, type, data = {}) {
  const result = await chrome.tabs.sendMessage(current.tab.id, { scope: 'grab-a-page', type, id: current.session.id, ...data });
  if (result?.error) throw new Error(result.error);
  return result;
}
async function assertActive(current) {
  const [active] = await chrome.tabs.query({ active: true, windowId: current.tab.windowId });
  if (active?.id !== current.tab.id) throw new Error('The source tab changed. Keep the page active throughout capture.');
  const source = await chrome.tabs.get(current.tab.id);
  if (source.url !== current.tab.url) throw new Error('The page navigated during capture.');
}
function warn(current, text) {
  if (!current.session.warnings.includes(text)) current.session.warnings.push(text);
}
async function takeTile(current, measured) {
  await sleep(Math.max(0, 650 - (Date.now() - lastCaptureAt)));
  if (current.cancelled) return false;
  await assertActive(current);
  let prepared = measured;
  if (current.session.mode === 'full') prepared = await page(current, 'prepare', { first: !current.session.tiles.length });
  lastCaptureAt = Date.now();
  const dataUrl = await chrome.tabs.captureVisibleTab(current.tab.windowId, { format: 'png' });
  await assertActive(current);
  if (current.session.mode === 'full') {
    const after = await page(current, 'metrics');
    if (Math.abs(after.y - prepared.y) > 1 || after.width !== prepared.width || after.height !== prepared.height) {
      throw new Error('The viewport moved or resized during capture. Please try again without resizing the window.');
    }
  }
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const pixelWidth = bitmap.width;
  const pixelHeight = bitmap.height;
  bitmap.close();
  const visible = current.session.mode === 'visible';
  const width = visible ? pixelWidth : prepared.width;
  const height = visible ? pixelHeight : prepared.height;
  const scale = visible ? 1 : pixelWidth / width;
  if (!visible && Math.abs(pixelHeight / height - scale) > .02) throw new Error(`The screenshot size (${pixelWidth} × ${pixelHeight}) did not match the page viewport (${width} × ${height}). Disable device emulation and try again.`);
  if (current.session.scale && (Math.abs(current.session.scale - scale) > .001 || current.session.width !== width)) {
    throw new Error('The browser zoom or viewport width changed during capture.');
  }
  const index = current.session.tiles.length;
  const tile = { key: `${current.session.id}:${index}`, sessionId: current.session.id, y: visible ? 0 : prepared.y,
    width, height, pixelWidth, pixelHeight };
  const target = visible ? height : Math.min(prepared.pageHeight, current.settings.maxHeight, tile.y + height);
  if (tile.y > current.session.height + 1) throw new Error('The page skipped a section while scrolling. The result was stopped to avoid a gap.');
  await putTile({ ...tile, blob });
  current.session.tiles.push(tile);
  current.session.width = width;
  current.session.scale = scale;
  current.session.height = Math.max(current.session.height, target);
  await putSession(current.session);
  if (!visible) await page(current, 'after', { tiles: index + 1, height: current.session.height });
  await chrome.action.setBadgeText({ text: String(index + 1) });
  return true;
}
async function run(current) {
  try {
    // The popup needs time to close before the first screenshot is taken.
    await sleep(250);
    if (current.session.mode === 'visible') {
      if (await takeTile(current, {})) current.session.status = 'complete';
    } else {
      let y = 0;
      let initialViewport;
      while (!current.cancelled && !current.finished) {
        if (Date.now() - current.started >= current.settings.maxDuration * 1000) {
          warn(current, 'Stopped at the maximum capture duration. This is a partial capture.'); break;
        }
        const measured = await page(current, 'settle', { y, budgetMs: current.settings.maxDuration * 1000 - (Date.now() - current.started) });
        if (current.cancelled || current.finished) break;
        if (y > 1 && measured.y < Math.min(y, measured.pageHeight - measured.height) - 1) {
          throw new Error('This page prevented main-document scrolling. Scrollable panels are not expanded by full-page capture.');
        }
        initialViewport ||= { width: measured.width, height: measured.height };
        if (measured.width !== initialViewport.width || measured.height !== initialViewport.height) throw new Error('The viewport was resized during capture.');
        if (measured.pendingImages || measured.fontsPending) warn(current, 'Some images or fonts exceeded the loading wait and may be missing. Increase the loading wait and try again.');
        if (measured.pendingAnimations) warn(current, 'Some reveal animations exceeded the loading wait. Increase the loading wait and try again.');
        if (measured.failedImages) warn(current, 'Some images failed to load on the source page.');
        if (!(await takeTile(current, measured))) break;
        if (current.cancelled || current.finished) break;
        if (current.session.height >= current.settings.maxHeight && measured.pageHeight > current.settings.maxHeight) {
          warn(current, 'Stopped at the maximum page height. This is a partial capture.'); break;
        }
        let latest = measured;
        if (current.session.height >= measured.pageHeight - 1) {
          latest = await page(current, 'settle', { y: measured.y, bottom: true, budgetMs: Math.max(0, current.settings.maxDuration * 1000 - (Date.now() - current.started)) });
          if (current.cancelled || current.finished) break;
          if (latest.pageHeight <= current.session.height + 1) { current.session.status = 'complete'; break; }
        }
        // Reveal observers often wait until content is well inside the viewport.
        // Revisit the lower half so it can be stitched from the later screenshot.
        const overlap = latest.height * .5;
        y = Math.min(current.session.height - overlap, latest.pageHeight - latest.height);
        y = Math.max(0, y);
        if (y <= measured.y + .5) {
          warn(current, 'The page stopped advancing or changed its layout. This is a partial capture.'); break;
        }
      }
    }
    if (current.cancelled) { current.session.status = 'cancelled'; warn(current, 'Capture cancelled. Only the sections already captured are included.'); }
    else if (current.finished) { current.session.status = 'partial'; warn(current, 'Finished early at your request.'); }
    else if (current.session.warnings.length && current.session.status === 'complete') current.session.status = 'partial';
  } catch (error) {
    current.session.status = current.session.tiles.length ? 'partial' : 'error';
    warn(current, error.message || 'Capture failed.');
  } finally {
    if (current.session.mode === 'full') {
      try { await page(current, 'cleanup'); } catch { /* Navigation or tab closure removes the injected UI. */ }
    }
    current.session.endedAt = Date.now();
    try { await putSession(current.session); } catch { /* Preview can still recover the last persisted tiles. */ }
    job = null;
    await chrome.action.setBadgeText({ text: '' });
    await chrome.storage.local.set({ latestCaptureId: current.session.id });
    await chrome.tabs.create({ url: chrome.runtime.getURL(`preview.html?id=${encodeURIComponent(current.session.id)}`) });
  }
}
async function start(mode) {
  if (!['visible', 'full'].includes(mode)) throw new Error('Choose a valid capture mode.');
  if (job) throw new Error('A capture is already running. Finish or cancel it first.');
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('Open the webpage you want to capture.');
  const settings = normalizeSettings((await chrome.storage.local.get('settings')).settings);
  const session = { id: crypto.randomUUID(), title: tab.title || 'Page capture', url: tab.url || '', createdAt: Date.now(),
    mode, imageOutput: settings.imageOutput, status: 'partial', warnings: [], tiles: [], width: 0, height: 0, scale: 0 };
  const current = { tab, settings, session, started: Date.now(), cancelled: false, finished: false };
  job = current;
  try {
    await pruneSessions();
    await putSession(session);
    if (mode === 'full') {
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); }
      catch { throw new Error('Full-page scrolling is unavailable on this page. Try an ordinary website, or use Visible area. Local files require enabling file access in extension settings.'); }
      await page(current, 'begin', { settings });
    }
    await chrome.storage.local.set({ latestCaptureId: session.id });
    await chrome.action.setBadgeBackgroundColor({ color: '#254d3f' });
    void run(current).catch(console.error);
    return { ok: true, id: session.id };
  } catch (error) {
    if (mode === 'full') await page(current, 'cleanup').catch(() => {});
    job = null;
    throw error;
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.scope === 'grab-a-page') return;
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL(''));
  // A content script can only finish/cancel the job belonging to its source tab.
  if (!extensionPage && (!sender.tab || !job || sender.tab.id !== job.tab.id || !['finish', 'cancel'].includes(message.type))) return;
  (async () => {
    switch (message.type) {
      case 'start': return start(message.mode);
      case 'status': return sessionView();
      case 'cancel': if (job) job.cancelled = true; return { ok: true };
      case 'finish': if (job) job.finished = true; return { ok: true };
      case 'session': return getSession(message.id);
      default: throw new Error('Unknown capture request.');
    }
  })().then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
