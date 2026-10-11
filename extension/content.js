(() => {
  if (globalThis.__grabAPageController) return;
  globalThis.__grabAPageController = true;
  let state;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  function metrics() {
    const root = document.scrollingElement || document.documentElement;
    return { x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight,
      pageHeight: Math.max(root.scrollHeight, document.documentElement.scrollHeight, document.body?.scrollHeight || 0) };
  }
  function remember(element, property, value) {
    if (!state.styles.some(item => item.element === element && item.property === property)) {
      state.styles.push({ element, property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) });
    }
    element.style.setProperty(property, value, 'important');
  }
  function hide(element) { remember(element, 'visibility', 'hidden'); }
  function inspectPinned(first) {
    // Re-scan for widgets added by lazy-loaded sections. Avoid touching descendants of
    // already hidden elements, or our own controls.
    for (const element of document.querySelectorAll('body *')) {
      if (element === state.host || state.host.contains(element)) continue;
      const css = getComputedStyle(element);
      if (css.visibility === 'hidden' || css.display === 'none' || !['fixed', 'sticky'].includes(css.position)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight) continue;
      if (css.position === 'fixed') {
        const isHeader = rect.top <= 2 && rect.width >= innerWidth * .6 && rect.height < innerHeight * .4;
        if (isHeader && first) state.seenPinned.add(element);
        else hide(element);
      } else {
        const top = Number.parseFloat(css.top);
        const bottom = Number.parseFloat(css.bottom);
        const pinned = (Number.isFinite(top) && Math.abs(rect.top - top) <= 2) ||
          (Number.isFinite(bottom) && Math.abs(innerHeight - rect.bottom - bottom) <= 2);
        if (pinned) {
          if (state.seenPinned.has(element)) hide(element);
          else state.pendingPinned.add(element);
        }
      }
    }
  }
  function cleanup() {
    if (!state) return;
    const saved = state;
    clearInterval(saved.watchdog);
    document.removeEventListener('wheel', blockScroll, true);
    document.removeEventListener('touchmove', blockScroll, true);
    document.removeEventListener('keydown', blockScroll, true);
    for (const item of saved.styles.reverse()) {
      if (item.value) item.element.style.setProperty(item.property, item.value, item.priority);
      else item.element.style.removeProperty(item.property);
    }
    saved.host.remove();
    // Keep smooth scrolling disabled until the original position is restored.
    window.scrollTo({ left: saved.original.x, top: saved.original.y, behavior: 'instant' });
    saved.style.remove();
    state = null;
  }
  function blockScroll(event) {
    if (event.type !== 'keydown' || ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) event.preventDefault();
    if (event.type === 'keydown' && event.key === 'Escape') sendControl('cancel');
  }
  function sendControl(type) {
    if (state) state.stopping = true;
    chrome.runtime.sendMessage({ type }).catch(cleanup);
  }
  async function begin(settings, id) {
    cleanup();
    const original = metrics();
    const style = document.createElement('style');
    style.textContent = 'html,body,*{scroll-behavior:auto!important;scroll-snap-type:none!important;overflow-anchor:none!important}*{animation-play-state:paused!important;transition:none!important}';
    document.documentElement.append(style);
    const host = document.createElement('div');
    host.id = 'grab-a-page-controls';
    host.style.cssText = 'all:initial!important;position:fixed!important;bottom:20px!important;left:50%!important;transform:translateX(-50%)!important;z-index:2147483647!important;display:block!important;visibility:visible!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>:host{color-scheme:light}section{font:13px system-ui;color:#fff;background:#203d33;border:1px solid #607a66;border-radius:14px;padding:12px 15px;display:flex;align-items:center;gap:12px;box-shadow:0 8px 35px #0003}span{white-space:nowrap}button{font:12px system-ui;border:1px solid #6b8373;border-radius:7px;padding:8px 10px;background:#345b49;color:white;cursor:pointer}button:focus-visible{outline:2px solid #c9df9f}small{display:block;color:#c7d6c9;font-size:10px;margin-top:3px}</style><section aria-label="Screenshot capture"><span><strong>Loading the page…</strong><small>Keep this tab active · Esc to cancel</small></span><button id="finish">Finish now</button><button id="cancel">Cancel</button></section>`;
    document.documentElement.append(host);
    state = { id, settings, original, style, host, label: shadow.querySelector('strong'), styles: [], seenPinned: new Set(), pendingPinned: new Set(), heartbeat: Date.now(), stopping: false };
    for (const type of ['finish', 'cancel']) shadow.getElementById(type).addEventListener('click', () => sendControl(type));
    for (const type of ['wheel', 'touchmove', 'keydown']) document.addEventListener(type, blockScroll, { capture: true, passive: false });
    state.watchdog = setInterval(() => { if (state && Date.now() - state.heartbeat > 25000) cleanup(); }, 5000);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await paint();
    return metrics();
  }
  async function settle(y, bottom = false, budgetMs = Infinity) {
    const current = state;
    window.scrollTo({ top: y, left: 0, behavior: 'instant' });
    await paint();
    const start = Date.now();
    const minimum = Math.min(budgetMs, bottom ? Math.max(current.settings.waitMs, 1800) : current.settings.waitMs);
    const limit = Math.min(budgetMs, Math.max(minimum, current.settings.loadTimeout));
    let previous = metrics();
    let stableSince = start;
    let pending = [];
    let failed = [];
    while (state === current && !current.stopping) {
      pending = [];
      failed = [];
      for (const image of document.images) {
        const rect = image.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue;
        if (!image.complete) pending.push(image);
        else if (image.currentSrc && image.naturalWidth === 0) failed.push(image);
      }
      const measured = metrics();
      if (measured.pageHeight !== previous.pageHeight || measured.y !== previous.y) stableSince = Date.now();
      previous = measured;
      const elapsed = Date.now() - start;
      if (elapsed >= limit || (elapsed >= minimum && pending.length === 0 && document.fonts.status !== 'loading' && Date.now() - stableSince >= 250)) break;
      await sleep(Math.min(100, Math.max(1, limit - elapsed)));
    }
    await paint();
    return { ...metrics(), pendingImages: pending.length, failedImages: failed.length, fontsPending: document.fonts.status === 'loading' };
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.scope !== 'grab-a-page') return;
    (async () => {
      if (message.type === 'begin') return begin(message.settings, message.id);
      if (message.type === 'cleanup') { cleanup(); return { ok: true }; }
      if (!state || state.id !== message.id) throw new Error('The page capture session ended.');
      state.heartbeat = Date.now();
      switch (message.type) {
        case 'settle': return settle(message.y, message.bottom, message.budgetMs);
        case 'prepare':
          inspectPinned(message.first);
          state.host.style.setProperty('visibility', 'hidden', 'important');
          await paint();
          return metrics();
        case 'after':
          for (const element of state.pendingPinned) state.seenPinned.add(element);
          state.pendingPinned.clear();
          state.host.style.setProperty('visibility', 'visible', 'important');
          state.label.textContent = `${message.tiles} sections · ${Math.round(message.height).toLocaleString()} px`;
          return metrics();
        case 'metrics': return metrics();
        default: throw new Error('Unknown page capture request.');
      }
    })().then(respond, error => respond({ error: error.message }));
    return true;
  });
  window.addEventListener('pagehide', cleanup);
})();
