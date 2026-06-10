import type { Page } from 'puppeteer';

const A4_HEIGHT_MM = 297;

const PIN_BOTTOM_RULES = `
  .sheet {
    position: relative !important;
    min-height: ${A4_HEIGHT_MM}mm !important;
    padding: 18mm 20mm 10mm !important;
    box-sizing: border-box !important;
    width: 210mm !important;
    margin: 0 auto !important;
  }
  .sheet-main { padding-bottom: 48mm !important; }
  .sheet-bottom {
    position: absolute !important;
    left: 20mm !important;
    right: 20mm !important;
    bottom: 10mm !important;
    margin: 0 !important;
    padding: 0 !important;
  }`;

const LAYOUT_FIX_STYLE = `<style id="letter-layout-fix">
@media screen {${PIN_BOTTOM_RULES}
}
@media print {${PIN_BOTTOM_RULES}
  .sheet { box-shadow: none !important; }
}
</style>`;

/** Ensures closing-letter footers sit at the page bottom (screen preview). */
export function injectLetterLayoutFix(html: string): string {
  if (!html.includes('sheet-bottom') || html.includes('letter-layout-fix')) return html;
  if (html.includes('</head>')) return html.replace('</head>', `${LAYOUT_FIX_STYLE}</head>`);
  return LAYOUT_FIX_STYLE + html;
}

/** Pin footer block to the physical page bottom for single-page PDF letters. */
export async function pushLetterFooterToPageBottom(page: Page): Promise<void> {
  await page.evaluate((pageHeightMm) => {
    const sheet = document.querySelector('.sheet') as HTMLElement | null;
    const bottom = document.querySelector('.sheet-bottom') as HTMLElement | null;
    const main = document.querySelector('.sheet-main') as HTMLElement | null;
    if (!sheet || !bottom) return;

    const pageH = (pageHeightMm * 96) / 25.4;
    if (document.body.scrollHeight > pageH + 24) return;

    sheet.style.minHeight = `${pageH}px`;
    sheet.style.position = 'relative';
    sheet.style.boxSizing = 'border-box';
    sheet.style.padding = '18mm 20mm 10mm';

    bottom.style.position = 'absolute';
    bottom.style.left = '20mm';
    bottom.style.right = '20mm';
    bottom.style.bottom = '10mm';
    bottom.style.margin = '0';
    bottom.style.padding = '0';

    const bottomH = bottom.offsetHeight;
    if (main) main.style.paddingBottom = `${bottomH + 16}px`;
  }, A4_HEIGHT_MM);
}
