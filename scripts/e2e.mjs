/**
 * End-to-end test of the production build in a real Chromium:
 * loads the 20 sample screenshots, stitches them (Web Workers, nested match workers), checks the result
 * (20/20 used, 4 × 5 raster), opens the debug view and exports a PNG.
 *
 *   npm run build && npm run test:e2e
 *
 * Uses playwright-core with a locally installed Chromium (CHROME_PATH or /opt/pw-browsers).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 4174;
const OUT = 'test-results';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) {
    for (const d of readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      const p = join(base, d, 'chrome-linux', 'chrome');
      if (existsSync(p)) return p;
    }
  }
  return undefined; // let playwright find its own browser
}

async function waitForServer(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Preview server did not start');
}

function assert(cond, msg) {
  if (!cond) throw new Error(`E2E assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  mkdirSync(OUT, { recursive: true });
  await waitForServer(`http://localhost:${PORT}/`);
  browser = await chromium.launch({ executablePath: findChrome() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`http://localhost:${PORT}/`);
  assert(await page.getByText('Viele Screenshots. Eine Karte.').isVisible(), 'start screen shows tagline');
  assert(await page.getByTestId('privacy').isVisible(), 'privacy notice is visible');
  await page.screenshot({ path: join(OUT, '1-start.png') });

  await page.getByTestId('load-sample').click();
  await page.getByTestId('count').filter({ hasText: '20 Screenshots geladen' }).waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=thumbs] img').length === 20, null, { timeout: 30000 });
  assert(true, '20 screenshots loaded with thumbnails');
  await page.screenshot({ path: join(OUT, '2-loaded.png') });

  const t0 = Date.now();
  await page.getByTestId('stitch').click();
  await page.getByTestId('progress').waitFor({ timeout: 5000 });
  await page.screenshot({ path: join(OUT, '3-progress.png') });
  await page.getByTestId('stats').waitFor({ timeout: 180000 });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const used = await page.getByTestId('stat-used').innerText();
  const grid = await page.getByTestId('stat-grid').innerText();
  const size = await page.getByTestId('stat-size').innerText();
  const conf = await page.getByTestId('stat-conf').innerText();
  console.log(`  stitched in ${secs}s: ${used}, raster ${grid}, ${size}, confidence ${conf}`);
  assert(used.startsWith('20 / 20'), 'all 20 screenshots placed');
  assert(grid.replace(/\s/g, '') === '4×5', 'raster detected as 4 × 5');
  assert((await page.getByTestId('unmatched').count()) === 0, 'no unmatched screenshots');
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, '4-result.png') });

  await page.getByTestId('debug-toggle').click();
  await page.getByTestId('debug-panel').waitFor();
  const vb = await page.getByTestId('viewer').boundingBox();
  await page.mouse.click(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await page.waitForTimeout(500);
  assert((await page.locator('.edge-table tbody tr').count()) >= 2, 'debug view lists neighbours of the selected screenshot');
  await page.screenshot({ path: join(OUT, '5-debug.png') });

  await page.getByTestId('export-open').click();
  await page.getByRole('button', { name: '25 %' }).click();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.getByTestId('export-run').click()]);
  const file = join(OUT, download.suggestedFilename());
  await download.saveAs(file);
  const bytes = statSync(file).size;
  assert(bytes > 50000, `PNG export written (${download.suggestedFilename()}, ${(bytes / 1024).toFixed(0)} KB)`);
  await page.screenshot({ path: join(OUT, '6-export.png') });

  assert(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log('E2E passed');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
