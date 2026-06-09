import puppeteer from 'puppeteer';

const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

/**
 * Renders HTML (e.g. closing letter template with embedded data: image URLs) to a PDF buffer.
 * Uses headless Chromium via Puppeteer — requires Chromium at runtime (bundled with puppeteer).
 */
export async function htmlToPdfBuffer(html: string): Promise<Buffer> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: LAUNCH_ARGS,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
