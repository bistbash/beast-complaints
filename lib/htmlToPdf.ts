import fs from 'fs';
import puppeteer from 'puppeteer';
import { pushLetterFooterToPageBottom } from './letterLayoutFix.ts';

const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

const SYSTEM_CHROMIUM_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
];

/** Env override, then common Linux paths, then Puppeteer's bundled browser. */
function resolveChromiumExecutable(): string | undefined {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (fromEnv) return fromEnv;
  for (const candidate of SYSTEM_CHROMIUM_PATHS) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/**
 * Renders HTML (e.g. closing letter template with embedded data: image URLs) to a PDF buffer.
 * Uses headless Chromium via Puppeteer — requires Chromium at runtime (bundled with puppeteer).
 */
export async function htmlToPdfBuffer(html: string): Promise<Buffer> {
  const executablePath = resolveChromiumExecutable();
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: LAUNCH_ARGS,
  });

  try {
    const page = await browser.newPage();
    // A4 @ 96dpi — required so print `position: fixed; bottom: 0` anchors to the page foot.
    await page.setViewport({ width: 794, height: 1123 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45_000 });
    await page.emulateMediaType('print');
    await pushLetterFooterToPageBottom(page);
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
