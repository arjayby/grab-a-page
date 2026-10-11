import { DEFAULT_SETTINGS, normalizeSettings } from './lib/settings.js';
const $ = id => document.getElementById(id);
const settings = normalizeSettings((await chrome.storage.local.get('settings')).settings || DEFAULT_SETTINGS);
for (const [name, value] of Object.entries(settings)) $('settings').elements[name].value = value;
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  const settings = normalizeSettings(Object.fromEntries(new FormData(event.target)));
  await chrome.storage.local.set({ settings });
  for (const [name, value] of Object.entries(settings)) event.target.elements[name].value = value;
  $('saved').textContent = 'Saved';
});
$('settings').addEventListener('input', () => { $('saved').textContent = ''; });
const disclosure = $('settings').closest('details');
const summary = disclosure.querySelector('summary');
const settingsPanel = disclosure.querySelector('.settings-panel');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let settingsExpanded = disclosure.open;
let settingsAnimation;

function finishSettingsAnimation() {
  // Restore natural layout before removing the animation's final frame.
  disclosure.open = settingsExpanded;
  disclosure.classList.remove('is-animating', 'is-closing');
  settingsAnimation?.cancel();
  settingsAnimation = null;
}

summary.setAttribute('aria-expanded', String(settingsExpanded));
$('settings').inert = !settingsExpanded;
summary.addEventListener('click', event => {
  event.preventDefault();
  settingsExpanded = !(settingsAnimation ? settingsExpanded : disclosure.open);
  disclosure.classList.toggle('is-closing', !settingsExpanded);
  summary.setAttribute('aria-expanded', String(settingsExpanded));
  $('settings').inert = !settingsExpanded;

  if (reducedMotion.matches) { finishSettingsAnimation(); return; }
  if (settingsAnimation) {
    // Reverse the same timeline without restarting its easing or layout.
    settingsAnimation.reverse();
    return;
  }

  // Keep the content rendered until closing finishes; never clip the summary.
  disclosure.open = true;
  const expandedHeight = settingsPanel.getBoundingClientRect().height;
  disclosure.classList.add('is-animating');
  const animation = settingsPanel.animate(
    { height: ['0px', `${expandedHeight}px`] },
    { duration: 220, easing: 'ease-in-out', fill: 'both' },
  );
  if (!settingsExpanded) {
    animation.currentTime = 220;
    animation.reverse();
  }
  settingsAnimation = animation;
  animation.onfinish = () => {
    if (settingsAnimation !== animation) return;
    finishSettingsAnimation();
  };
});
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches && settingsAnimation) finishSettingsAnimation();
});

async function refresh() {
  const status = await chrome.runtime.sendMessage({ type: 'status' });
  $('running').hidden = !status.running;
  $('full').disabled = $('visible').disabled = status.running;
  $('last').disabled = status.running;
  $('state-label').textContent = status.running ? 'Capturing' : $('error').hidden ? 'Ready' : 'Check page';
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
