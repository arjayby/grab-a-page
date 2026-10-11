import { DEFAULT_SETTINGS, normalizeSettings } from './lib/settings.js';
const $ = id => document.getElementById(id);
const settings = normalizeSettings((await chrome.storage.local.get('settings')).settings || DEFAULT_SETTINGS);
for (const [name, value] of Object.entries(settings)) $('settings').elements[name].value = value;
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  await chrome.storage.local.set({ settings: normalizeSettings(Object.fromEntries(new FormData(event.target))) });
  $('saved').textContent = 'Saved';
});
async function refresh() {
  const status = await chrome.runtime.sendMessage({ type: 'status' });
  $('running').hidden = !status.running;
  $('full').disabled = $('visible').disabled = status.running;
  $('last').disabled = status.running;
  if (status.running) $('progress').textContent = `${status.tiles} sections captured · ${status.height.toLocaleString()} px`;
}
for (const mode of ['full', 'visible']) $(mode).addEventListener('click', async () => {
  $('error').hidden = true;
  $('full').disabled = $('visible').disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'start', mode });
    if (!response.ok) throw new Error(response.error);
    window.close();
  } catch (error) {
    $('error').textContent = error.message;
    $('error').hidden = false;
    await refresh();
  }
});
for (const action of ['finish', 'cancel']) $(action).addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: action });
  window.close();
});
await refresh();
const { latestCaptureId } = await chrome.storage.local.get('latestCaptureId');
if (latestCaptureId) {
  const session = await chrome.runtime.sendMessage({ type: 'session', id: latestCaptureId });
  if (session?.id) {
    $('last').hidden = false;
    $('last').addEventListener('click', async () => {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`preview.html?id=${encodeURIComponent(latestCaptureId)}`) });
      window.close();
    });
  }
}
setInterval(() => refresh().catch(() => {}), 1000);
