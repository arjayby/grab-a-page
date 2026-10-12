# Grab a Page

A Chrome extension that saves a webpage as a PNG. Capture the visible area or scroll through the page to load content and create a full-page screenshot. Everything stays on your computer—no account, uploads, or analytics.

## Why this extension?

Chrome’s normal **Capture full size screenshot** can miss content that only loads when it enters the viewport. Grab a Page scrolls through the page, waits for content to load, and captures each section before combining them into one image.

## Use

Open a webpage, click the extension icon, and choose:

- **Full page** to scroll and capture the page. Keep the tab active and leave the window size and zoom unchanged.
- **Visible area** to capture what you currently see without scrolling.

Download the PNG from the preview. **Open last capture** reopens your latest result; **Delete capture** removes its temporary stored copy.

During full-page capture, use **Finish now** to stop early or **Cancel** / Escape to cancel. Both keep any sections already captured and restore the page’s original scroll position and temporary style changes.

In **Capture settings**, adjust the time and height limits or increase the scroll pause and loading timeout for slow pages. Output defaults to one full-page PNG; choose **Multiple PNGs for large pages** to split large captures into numbered parts. Save settings before capturing.

## Supported pages and limits

- Works on ordinary websites, including pages you’re signed into. Local `file://` pages need **Allow access to file URLs** enabled in Chrome’s extension settings.
- Browser internal pages and the Chrome Web Store restrict full-page capture. Visible capture works where Chrome allows it.
- Only the main page scrolls. Scrollable panels, embedded frames, and horizontal overflow aren’t expanded.
- Slow or failed loading, changing layouts, video, and unusual sticky elements can leave content missing or misplaced. Fixed headers are kept once, and other fixed overlays are temporarily hidden.
- Captures stop at **120 seconds** or **30,000 CSS pixels** by default, including infinite feeds. Limits, loading failures, tab switches, or window changes can produce a partial capture with an explanation.

## Privacy and permissions

The extension uses `activeTab` to capture the tab you invoke it on, `scripting` to scroll and prepare the page, and `storage` to save settings. It does not request permanent access to every website or send captures anywhere.

Images, page titles, and URLs are stored temporarily in local IndexedDB. Captures older than 24 hours are deleted when another capture starts; **Delete capture** removes them immediately. Downloaded PNGs stay wherever you save them.

## Development and verification

### Install locally

1. Open `chrome://extensions` in Chrome 120 or newer.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project’s `extension` directory, which contains `manifest.json`.
4. Pin **Grab a Page** from Chrome’s Extensions menu.

No build step is needed. After editing extension files, click **Reload** on the extensions page. You can also try the extension in Edge or Brave.

### Run checks

Node and Playwright are needed only for development:

```sh
npm install
npx playwright install chromium
npm run check
npm test
npm run test:browser
```

These commands check the source, run unit tests, and test the actual extension in Chromium. Browser tests cover capture, lazy loading, page restoration, partial captures, and PNG exports. Also try it on your own sites to check their layouts.

To regenerate toolbar icons, run `node scripts/generate-icons.mjs`.

## Source layout

- `extension/design-system.css`: shared palette, typography, components, and keyboard focus styles; see [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for usage.
- `extension/popup.html` and `extension/popup.css`: capture actions, progress, and settings.
- `extension/preview.html` and `extension/preview.css`: responsive capture preview and export controls.
- `extension/background.js`: capture orchestration and Chrome API rate limiting.
- `extension/content.js`: scroll/loading controller, temporary layout changes, and restoration.
- `extension/preview.js`: local PNG stitching, splitting, and download UI.
- `extension/lib/`: settings, stitching coordinates, and IndexedDB storage.
- `tests/`: unit checks and a local lazy-loading browser fixture.

Official references: [Chrome captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab), [activeTab access](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [Load unpacked](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked), and [canvas size limits](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas#maximum_canvas_size).
