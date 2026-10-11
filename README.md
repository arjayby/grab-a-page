# Grab a Page

A Chrome Manifest V3 extension that captures the visible webpage or scrolls through the main document, waits for lazy-loaded content, and stitches the rendered sections into a full-page PNG. All capture processing stays on your computer.

## Install

1. Open `chrome://extensions` in Chrome 120 or newer.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` directory inside this project:
   `/Users/arj/100k/grab-a-page/extension`
4. Pin **Grab a Page** using Chrome’s Extensions menu.

There is no build step, account, or server. The unpacked extension can also be tried in Chromium browsers such as Edge and Brave; automated verification uses Chromium. Select the directory containing `manifest.json`, not the project root. After changing the extension files, click its Reload button on the extensions page.

## Use

Open the webpage you want to capture, then click the extension icon:

- **Full page** starts at the top and scrolls through overlapping viewports, waiting for visible images and page layout to settle before capturing each section. Keep the source tab active and leave the window size and zoom unchanged.
- **Visible area** captures the current viewport, including its fixed headers and floating widgets, without scrolling or changing the page.

Full-page capture displays progress with **Finish now** and **Cancel** buttons. Escape also cancels. Finish now keeps the captured sections. Cancellation keeps any sections already captured and labels the result as cancelled. Both restore the original scroll position and temporarily modified styles. A preview opens after capture, where you can download the PNG or delete the temporary capture. **Open last capture** in the popup reopens your latest saved result, including sections saved before an interruption.

Full-page captures keep top fixed headers once and temporarily hide other fixed overlays. Sticky elements are kept on their first captured appearance and hidden when they would repeat. This is a layout heuristic; unusual CSS can need a different policy in a future version.

The default safety limits are **120 seconds** and **30,000 CSS pixels** of page height. The popup’s settings let you change these, the minimum pause after each scroll (700 ms), and the loading timeout (5 seconds). If a page loads content slowly after it enters view, increase the pause and loading timeout.

Large captures split into numbered PNGs at the original screenshot resolution. Parts are ordered from top to bottom (and left to right for exceptionally wide images). You can download each part separately. If Chrome asks to allow multiple downloads when using **Download all**, allow them or use the individual download links.

## Supported pages and limits

- Ordinary websites, including authenticated pages you have already opened, are captured using the pixels Chrome renders.
- Only the main document scrolls. Independently scrolling panels and embedded frames are captured as currently visible. Horizontal page overflow is not expanded.
- Browser internal pages and the Chrome Web Store generally prevent the script injection needed for full-page scrolling. Visible capture is available where Chrome allows it. Local `file://` pages require enabling **Allow access to file URLs** in the extension’s Chrome settings.
- Lazy-loaded images are waited on while visible. Failed or timed-out images produce an incomplete result with an explanation. Arbitrary application requests, cross-origin frame loading, background images, video playback, and content delayed beyond the configured wait cannot be guaranteed complete.
- Sections are captured as you scroll, which helps with virtualized content that disappears when offscreen. Page reflows, recycled content whose size changes, unusually tall sticky elements, protected video, or sites that override scrolling can still affect fidelity. Detected scroll gaps, viewport changes, and tab switches stop the capture and preserve its usable portion.
- Infinite feeds stop at your configured duration/height limit. Reaching a limit is explicitly labeled as a partial capture.

## Privacy and permissions

The production manifest requests only `activeTab`, `scripting`, and `storage`. Access is granted when you invoke the extension; it does not request permanent access to every website. There are no analytics, upload endpoints, remote scripts, or external fonts. Image export uses local extension pages and browser storage.

Captured image tiles, titles, and page URLs are temporarily held in extension-local IndexedDB. Captures older than 24 hours are deleted the next time another capture starts; **Delete capture** removes a capture immediately. Downloaded PNGs remain wherever you save them. The capture does not operate independently after the browser is closed.

## Development and verification

```sh
npm install
npx playwright install chromium
npm run check
npm test
npm run test:browser
```

The extension itself has no runtime package dependencies. Node and Playwright are only needed for development. `node scripts/generate-icons.mjs` regenerates the included toolbar icons.

Browser tests load the actual extension into an isolated Chromium profile and exercise PNG capture, lazy-image loading, seam colors, browser scaling, page restoration, infinite-page limits, early finish/cancellation, failed images, and split exports. The tests use the unchanged production manifest and invoke the actual toolbar action through Chromium’s extension debugging API, granting temporary active-tab access. A smoke test on your own sites is still useful for checking their particular layouts.

## Source layout

- `extension/background.js`: capture orchestration and Chrome API rate limiting.
- `extension/content.js`: scroll/loading controller, temporary layout changes, and restoration.
- `extension/preview.js`: local PNG stitching, splitting, and download UI.
- `extension/lib/`: settings, stitching coordinates, and IndexedDB storage.
- `tests/`: unit checks and a local lazy-loading browser fixture.

Official references: [Chrome captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab), [activeTab access](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [Load unpacked](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked), and [canvas size limits](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas#maximum_canvas_size).
