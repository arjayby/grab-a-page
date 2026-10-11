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
      if (css.position === 'sticky') {
        // Keep the normal-flow footprint, even when only part of a tall panel is
        // visible. Hiding it after it pins duplicates its first fragment and can
        // discard the rest. Relative positioning preserves stacking and layout.
        remember(element, 'position', 'relative');
        for (const edge of ['top', 'bottom', 'left', 'right']) remember(element, edge, 'auto');
      } else {
        if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight) continue;
        const isHeader = rect.top <= 2 && rect.width >= innerWidth * .6 && rect.height < innerHeight * .4;
        if (!isHeader || !first) hide(element);
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
    saved.motionStyle.remove();
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
    style.textContent = 'html,body,*{scroll-behavior:auto!important;scroll-snap-type:none!important;overflow-anchor:none!important}';
    document.documentElement.append(style);
    const motionStyle = document.createElement('style');
    motionStyle.textContent = '*{animation-play-state:paused!important;transition:none!important}';
    motionStyle.media = 'not all';
    document.documentElement.append(motionStyle);
    const host = document.createElement('div');
    host.id = 'grab-a-page-controls';
    host.style.cssText = 'all:initial!important;position:fixed!important;bottom:20px!important;left:50%!important;transform:translateX(-50%)!important;z-index:2147483647!important;display:block!important;visibility:visible!important;width:max-content!important;max-width:calc(100vw - 24px)!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    // Keep the design isolated from the captured page's styles and fonts.
    shadow.innerHTML = `<style>
      :host{color-scheme:dark}
      *{box-sizing:border-box}
      section{font:12px/1.5 system-ui,sans-serif;color:#f9f8f7;background:#111;border:1px solid #666;padding:14px 16px;display:flex;align-items:center;gap:16px;box-shadow:0 8px 32px #0005}
      .mark{width:25px;height:25px;flex-shrink:0;fill:none;stroke:#eea052;stroke-width:1.5}
      .copy{min-width:0;flex:1}
      strong{font-weight:500;display:block}
      small{display:block;color:#b2b0ad;font-size:10px;margin-top:3px}
      .actions{display:flex;gap:8px}
      button{font:10px/1.5 ui-monospace,monospace;text-transform:uppercase;border:1px solid #666;padding:9px 12px;min-height:36px;background:transparent;color:#f9f8f7;cursor:pointer;white-space:nowrap}
      #finish{background:#f9f8f7;color:#111;border-color:#f9f8f7}
      button:hover{border-color:#f9f8f7;background:#202020}
      #finish:hover{background:#dedbd6}
      button:focus-visible{outline:2px solid #eea052;outline-offset:3px}
      @media(max-width:540px){section{flex-wrap:wrap;gap:12px;padding:12px}.copy{flex-basis:calc(100% - 40px)}.actions{width:100%}.actions button{flex:1}}
    </style><section aria-label="Screenshot capture"><svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M2 10V2h8m12 0h8v8M2 22v8h8m12 0h8v-8M11 8h10v16H11zM14 12h4m-4 4h4m-4 4h4"/></svg><span class="copy"><strong role="status">Loading the page…</strong><small>Keep this tab active · Esc to cancel</small></span><div class="actions"><button id="finish">Finish now</button><button id="cancel">Cancel</button></div></section>`;
    document.documentElement.append(host);
    state = { id, settings, original, style, motionStyle, host, label: shadow.querySelector('strong'), styles: [], heartbeat: Date.now(), stopping: false };
    for (const type of ['finish', 'cancel']) shadow.getElementById(type).addEventListener('click', () => sendControl(type));
    for (const type of ['wheel', 'touchmove', 'keydown']) document.addEventListener(type, blockScroll, { capture: true, passive: false });
    state.watchdog = setInterval(() => { if (state && Date.now() - state.heartbeat > 25000) cleanup(); }, 5000);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    inspectPinned(true);
    await paint();
    return metrics();
  }
  async function scrollGradually(current, y, budgetMs) {
    const from = window.scrollY;
    const distance = y - from;
    if (Math.abs(distance) < 1) return;
    const duration = Math.min(Math.max(0, budgetMs), Math.min(650, Math.max(180, Math.abs(distance) * .6)));
    const start = performance.now();
    let progress = 0;
    while (state === current && !current.stopping && progress < 1) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      progress = duration ? Math.min(1, (performance.now() - start) / duration) : 1;
      const eased = 1 - (1 - progress) ** 3;
      window.scrollTo({ top: from + distance * eased, left: 0, behavior: 'instant' });
    }
  }
  function pendingAnimations() {
    return document.getAnimations().filter(animation => {
      if (animation.playState !== 'running' || !(animation.timeline instanceof DocumentTimeline)) return false;
      const effect = animation.effect;
      if (!effect?.target || !Number.isFinite(effect.getComputedTiming().endTime)) return false;
      if (state.host.contains(effect.target)) return false;
      const rect = effect.target.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    }).length;
  }
  async function settle(y, bottom = false, budgetMs = Infinity) {
    const current = state;
    const started = Date.now();
    await scrollGradually(current, y, budgetMs);
    await paint();
    const start = Date.now();
    budgetMs = Math.max(0, budgetMs - (start - started));
    const minimum = Math.min(budgetMs, bottom ? Math.max(current.settings.waitMs, 1800) : current.settings.waitMs);
    const limit = Math.min(budgetMs, Math.max(minimum, current.settings.loadTimeout));
    let previous = metrics();
    let stableSince = start;
    let pending = [];
    let failed = [];
    let animations = 0;
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
      animations = pendingAnimations();
      if (elapsed >= limit || (elapsed >= minimum && pending.length === 0 && animations === 0 && document.fonts.status !== 'loading' && Date.now() - stableSince >= 250)) break;
      await sleep(Math.min(100, Math.max(1, limit - elapsed)));
    }
    await paint();
    return { ...metrics(), pendingImages: pending.length, failedImages: failed.length, pendingAnimations: animations, fontsPending: document.fonts.status === 'loading' };
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
          state.motionStyle.media = 'all';
          state.host.style.setProperty('visibility', 'hidden', 'important');
          await paint();
          return metrics();
        case 'after':
          state.motionStyle.media = 'not all';
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
