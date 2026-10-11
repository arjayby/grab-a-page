import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
await mkdir('extension/icons', { recursive: true });
for (const size of [16, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="30" fill="#254d3f"/><g stroke="#d8ebba" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M26 45V29h16M86 29h16v16M26 84v16h16M86 100h16V84"/><rect x="47" y="41" width="34" height="46" rx="4"/><path d="M56 54h16M56 64h16M56 74h9"/></g></svg>`);
  await page.screenshot({ path: `extension/icons/icon${size}.png`, omitBackground: true });
}
await browser.close();
