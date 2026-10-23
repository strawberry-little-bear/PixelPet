// Render the existing brand SVG, without adding a build-time image dependency.
// Optional regeneration: PIXELPET_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(join(root, 'web/public/favicon.svg'), 'utf8');
const { chromium } = await import(process.env.PIXELPET_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const output = join(root, 'web/public/icons');
  await mkdir(output, { recursive: true });
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const data = await page.evaluate(async ({ source, size }) => {
      const document = new DOMParser().parseFromString(source, 'image/svg+xml');
      // The OS supplies its own corner shape. Fill the square with the brand's
      // existing background instead of leaving transparent rounded corners.
      document.querySelector('rect').removeAttribute('rx');
      const svg = document.documentElement;
      svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = window.document.createElement('canvas'); canvas.width = size; canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      } finally { URL.revokeObjectURL(url); }
    }, { source, size });
    await writeFile(join(output, name), Buffer.from(data, 'base64'));
    console.log(`Rendered ${name}: ${size}×${size}`);
  }
} finally { await browser.close(); }
