import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const input = process.env.EVERECHO_DOC_HTML ?? path.join(here, 'document.html');
const output =
  process.env.EVERECHO_DOC_PDF ??
  path.join(here, '..', '..', 'EverEcho-Chief-of-Staff-Briefing.pdf');

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
await page.goto(`file://${input}`, { waitUntil: 'load' });
await page.emulateMedia({ media: 'print' });

const footer = `
<div style="width:100%;font-family:system-ui,sans-serif;font-size:7pt;color:#8a857c;
            padding:0 16mm;display:flex;justify-content:space-between;align-items:center;">
  <span>EverEcho &mdash; Chief of Staff Briefing</span>
  <span class="pageNumber"></span>
</div>`;

await page.pdf({
  path: output,
  format: 'A4',
  printBackground: true,
  tagged: true,
  outline: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: footer,
  margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
});

await browser.close();
console.log(`rendered ${output}`);
