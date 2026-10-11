import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
await mkdir('extension/icons', { recursive: true });
for (const size of [16, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="16" fill="#111111"/><g stroke="#eea052" stroke-width="6" fill="none"><path d="M20 44V20h24m40 0h24v24M20 84v24h24m40 0h24V84M46 36h36v56H46zM56 50h16m-16 14h16m-16 14h16"/></g></svg>`);
  await page.screenshot({ path: `extension/icons/icon${size}.png`, omitBackground: true });
}
await browser.close();
