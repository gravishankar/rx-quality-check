// Print an HTML file to a US Letter PDF with page numbers (headless Chromium via Playwright).
const { chromium } = require('playwright');
(async () => {
  const [html, out, src, orient] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + html);
  await page.pdf({
    path: out, format: 'Letter', landscape: orient === 'landscape', printBackground: true,
    margin: { top: '0.6in', bottom: '0.7in', left: '0.6in', right: '0.6in' },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: `<div style="font-size:8px;color:#777;width:100%;padding:0 0.6in;display:flex;justify-content:space-between"><span>MedLuma (DEV) — ${src}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  await browser.close();
})();
