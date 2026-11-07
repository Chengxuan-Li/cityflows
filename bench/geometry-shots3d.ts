import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { chromium, expect, type Page } from '@playwright/test';
import { button, importOsm, metrics } from '../tests/e2e/helpers';

// node --experimental-strip-types --import ./bench/register.ts bench/geometry-shots3d.ts <out-dir> [--performance]
// Fixed V98 cameras and two genuinely consecutive render frames. Port 5295 only.
const shots = [
  { id: 'V98-donnersberger', centre: { x: -20, y: -170 }, zoom: 1.7, pitch: 45, bearing: 45 },
  { id: 'V98-n967', centre: { x: -19.5, y: 172 }, zoom: 6, pitch: 55, bearing: 45 },
  { id: 'V98-munich-overview', centre: { x: 0, y: -60 }, zoom: 0.4, pitch: 55, bearing: 0 },
  {
    id: 'V98-sindelfingen-a81',
    centre: { x: 310, y: 340 },
    zoom: 1.5,
    pitch: 45,
    bearing: 45,
    osm: 'fixtures/osm/sindelfingen-a81.osm',
  },
];
shots.push({
  id: 'V98-signals-crossings',
  centre: { x: 310, y: 604.5 },
  zoom: 10,
  pitch: 55,
  bearing: 45,
  osm: 'fixtures/osm/sindelfingen-a81.osm',
});
shots.push({ id: 'V98-ramp-profile', centre: { x: -40, y: 210 }, zoom: 5, pitch: 15, bearing: 90 });
const munich = 'fixtures/osm/munich-donnersberger.osm';

async function frames(page: Page, n = 3) {
  await page.evaluate(
    (n) =>
      new Promise<void>((done) => {
        const next = () => {
          if (--n <= 0) done();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
    n,
  );
}

async function performanceSample(page: Page, mode: string) {
  const start = await metrics(page);
  const sample = await page.evaluate(
    () =>
      new Promise<{ fps: number; frames: number; wallMs: number; minDrawn: number }>((done) => {
        const start = performance.now();
        let frames = 0;
        let minDrawn = Infinity;
        const frame = (now: number) => {
          frames++;
          minDrawn = Math.min(minDrawn, window.cityflows!.drawnSnapshot!()?.count ?? Infinity);
          if (now - start >= 8000)
            done({
              fps: (1000 * (frames - 1)) / (now - start),
              frames,
              wallMs: now - start,
              minDrawn,
            });
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
  const end = await metrics(page);
  const minVehicles = Math.min(
    sample.minDrawn,
    start.trips.driving + start.trips.queuedDestination,
    end.trips.driving + end.trips.queuedDestination,
  );
  return { mode, ...sample, minVehicles, startTimeS: start.timeS, endTimeS: end.timeS };
}

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('Expected output directory');
  mkdirSync(out, { recursive: true });
  const server = process.argv.includes('--existing')
    ? null
    : spawn(
        process.execPath,
        [
          resolve('node_modules/vite/bin/vite.js'),
          '--mode',
          'test',
          '--host',
          'localhost',
          '--port',
          '5295',
          '--strictPort',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      );
  let log = '';
  server?.stdout.on('data', (d) => (log += String(d)));
  server?.stderr.on('data', (d) => (log += String(d)));
  const browser = await chromium.launch(
    process.argv.includes('--gpu') ? { args: ['--use-angle=d3d11', '--enable-gpu'] } : {},
  );
  const records: unknown[] = [];
  try {
    const until = Date.now() + 60000;
    while (true) {
      try {
        if ((await fetch('http://localhost:5295', { signal: AbortSignal.timeout(1000) })).ok) break;
      } catch {
        /* waiting for Vite */
      }
      if (Date.now() > until) throw new Error(log);
      await new Promise((r) => setTimeout(r, 250));
    }
    for (const osm of process.argv.includes('--sindelfingen-only')
      ? ['fixtures/osm/sindelfingen-a81.osm']
      : [munich, 'fixtures/osm/sindelfingen-a81.osm']) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      if (!process.argv.includes('--basemap'))
        await page.route('https://**/*', (route) => route.abort());
      await page.goto('http://localhost:5295');
      await expect(button(page, 'Play')).toBeEnabled();
      await importOsm(page, osm);
      await button(page, '3D').click();
      const canvas = page.getByLabel('3D city view', { exact: true });
      await expect.poll(() => canvas.getAttribute('data-meshes').then(Number)).toBeGreaterThan(0);
      for (const shot of shots.filter((shot) => (shot.osm ?? munich) === osm)) {
        const profileView = shot.id === 'V98-ramp-profile';
        if (profileView) {
          await button(page, 'Layers').click();
          await page
            .getByRole('region', { name: 'Map layers' })
            .getByLabel('Basemap', { exact: true })
            .uncheck();
          await button(page, 'Layers').click();
        }
        await page.evaluate(
          (shot) => window.cityflows!.setView3D!(shot.centre, shot.zoom, shot.pitch, shot.bearing),
          shot,
        );
        await frames(page);
        if (process.argv.includes('--basemap') && !profileView) {
          await expect
            .poll(() => canvas.getAttribute('data-tiles').then(Number), { timeout: 30000 })
            .toBeGreaterThan(0);
          await page.waitForTimeout(1500);
        }
        const images = await page.evaluate(() => window.cityflows!.capture3D!());
        images.forEach((data, i) =>
          writeFileSync(
            join(out, `${shot.id}-${i + 1}.png`),
            Buffer.from(data.split(',')[1]!, 'base64'),
          ),
        );
        const record = {
          ...shot,
          buildMs: await canvas.getAttribute('data-build-ms'),
          meshes: await canvas.getAttribute('data-meshes'),
          tiles: await canvas.getAttribute('data-tiles'),
        };
        records.push(record);
        console.info(JSON.stringify(record));
        if (profileView && process.argv.includes('--basemap')) {
          await button(page, 'Layers').click();
          await page
            .getByRole('region', { name: 'Map layers' })
            .getByLabel('Basemap', { exact: true })
            .check();
          await button(page, 'Layers').click();
        }
      }
      if (osm === munich && process.argv.includes('--performance')) {
        await button(page, '3D').click();
        // Full-demand Munich: change the import wizard's scale before accepting the new city.
        await button(page, 'Import').click();
        const dialog = page.getByRole('dialog', { name: 'Import city' });
        await dialog.getByLabel('OSM file').setInputFiles(osm);
        await button(page, 'Import roads').click();
        await expect(dialog.getByRole('region', { name: 'Import diagnostics' })).toContainText(
          '0 errors',
          { timeout: 60000 },
        );
        await button(page, 'Continue').click();
        await dialog.getByLabel('Demand', { exact: true }).fill('1');
        await button(page, 'Accept city').click();
        await expect(dialog).toBeHidden();
        // Sample the actual morning, never fabricate a snapshot or duplicate instances.
        let active = 0;
        for (let i = 0; i < 75 && active < 1200; i++) {
          await page.evaluate(() => window.cityflows!.step(600));
          const m = await metrics(page);
          active = m.trips.driving + m.trips.queuedDestination;
        }
        if (active < 1000) throw new Error(`Only ${active} real Munich vehicles at sample time`);
        await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('1');
        await button(page, 'Play').click();
        const two = await performanceSample(page, '2d');
        await button(page, '3D').click();
        await expect(canvas).toHaveAttribute('data-view', '3d');
        await frames(page, 60);
        const three = await performanceSample(page, '3d');
        await button(page, 'Pause').click();
        const gpu = await canvas.evaluate((canvas) => {
          const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!;
          const debug = gl.getExtension('WEBGL_debug_renderer_info');
          return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable';
        });
        const record = {
          performance: [two, three],
          gpu,
          buildMs: await canvas.getAttribute('data-build-ms'),
          tiles: await canvas.getAttribute('data-tiles'),
        };
        records.push(record);
        console.info(JSON.stringify(record));
        if (three.minVehicles < 1000 || three.fps < 30)
          throw new Error(`V98 performance gate failed: ${JSON.stringify(three)}`);
      }
      if (errors.length) throw new Error(errors.join('\n'));
      await page.close();
    }
  } finally {
    writeFileSync(
      join(
        out,
        process.argv.includes('--sindelfingen-only') ? 'sindelfingen-report.json' : 'report.json',
      ),
      JSON.stringify(records, null, 2),
    );
    await browser.close();
    server?.kill();
  }
}

await main();
