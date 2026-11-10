import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { button, city, importOsm, pageErrors } from './helpers';
import type { Vec2 } from '../../src/geo/vec2';
import { cumulativeLengths, pointAtDistance, polylineLength } from '../../src/geo/polyline';

// Continuous trace image compression is outside the renderer's frame budget.
test.use({
  trace: {
    mode: 'retain-on-failure',
    screenshots: false,
    snapshots: { dom: true, aria: true, screen: false },
  },
});

// Lead, 2026-11-10: CI skips the frame gate, and 120-frame samples on its software GPU pushed the
// spec past 420 s (checkpoint-2026-11-10), so CI takes short samples for the report only.
const sample = process.env.CI ? { frames: 12, warm: 2 } : { frames: 120, warm: 30 };
async function timing(page: Page, measure: string) {
  return page.evaluate(
    async ({ measure, sample }) => {
      window.cityflowsRenderContinuously = true;
      const frames: number[] = [],
        renders: number[] = [];
      let capture = false,
        last = 0;
      const observer = new PerformanceObserver((list) => {
        if (capture)
          for (const e of list.getEntries()) if (e.name === measure) renders.push(e.duration);
      });
      observer.observe({ entryTypes: ['measure'] });
      for (let i = 0; i < sample.frames; i++) {
        const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        capture = i >= sample.warm;
        if (capture && last) frames.push(now - last);
        last = now;
      }
      observer.disconnect();
      window.cityflowsRenderContinuously = false;
      const mean = (samples: number[]) => samples.reduce((s, v) => s + v, 0) / samples.length;
      return { frameMs: mean(frames), renderMs: mean(renders), drawn: renders.length };
    },
    { measure, sample },
  );
}
async function click(page: Page, point: Vec2, view: '2d' | '3d') {
  const position = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), point);
  await page
    .getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true })
    .click({ position });
}

test('T62 Munich rail layers, station/platform/track inspection, pictures and frame budgets in both views', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm', { terrain: false });
  const source = await city(page),
    rail = source.rail!;
  const station = Object.values(source.places).find((p) =>
    p.provenance.osmIds?.includes(2470092007),
  )!;
  expect(station.station!.platforms).toHaveLength(2);
  expect(station.station!.entrances).toHaveLength(3);
  const ring = station.shape.kind === 'polygon' ? station.shape.ring : [station.shape.pos];
  const centre = {
    x: (Math.min(...ring.map((p) => p.x)) + Math.max(...ring.map((p) => p.x))) / 2,
    y: (Math.min(...ring.map((p) => p.y)) + Math.max(...ring.map((p) => p.y))) / 2,
  };
  const map = page.getByLabel('City map', { exact: true });
  await page.evaluate((p) => {
    const c = document.querySelector<HTMLCanvasElement>('canvas[data-view="2d"]')!,
      r = c.getBoundingClientRect();
    const a = window.cityflows!.worldToScreen!({ x: 0, y: 0 }),
      b = window.cityflows!.worldToScreen!({ x: 1, y: 0 });
    const point = window.cityflows!.worldToScreen!(p);
    c.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -Math.log(1.6 / (b.x - a.x)) / 0.0015,
        clientX: r.x + point.x,
        clientY: r.y + point.y,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, centre);
  const p = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), centre),
    bounds = (await map.boundingBox())!;
  await page.mouse.move(bounds.x + p.x, bounds.y + p.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' }),
    toggle = layers.getByLabel('Rail', { exact: true });
  await expect(toggle).toBeChecked();
  for (const label of ['Basemap', 'Entrances and exits'])
    await layers.getByLabel(label, { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  const reports = [];
  for (const view of ['2d', '3d'] as const) {
    if (view === '3d') {
      await button(page, '3D').click();
      await expect(page.getByLabel('3D city view')).toHaveAttribute('data-view', '3d');
      await page.evaluate((p) => window.cityflows!.setView3D!(p, 1.6, 40, 0), centre);
    }
    const canvas = page.getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true });
    await expect(canvas).toHaveAttribute(
      'data-rail-tracks',
      String(Object.keys(rail.tracks).length),
    );
    await click(page, centre, view);
    await expect(page.getByLabel('Station rail access')).toContainText('2 platforms · 3 entrances');
    await page.getByLabel('Station rail access').getByRole('button').first().click();
    await expect(page.getByRole('region', { name: 'Platform inspector' })).toContainText(
      'Rail platform',
    );
    await page
      .getByRole('region', { name: 'Platform inspector' })
      .getByRole('button')
      .nth(1)
      .click();
    await expect(page.getByRole('region', { name: 'Track inspector' })).toContainText('Kind');
    await click(page, centre, view);
    const on = await timing(page, view === '2d' ? 'cityflows:render' : 'cityflows:render3d');
    const onImage = await canvas.screenshot({
      path: info.outputPath(`donnersberger-${view}-on.png`),
    });
    await button(page, 'Layers').click();
    await toggle.uncheck();
    await page.keyboard.press('Escape');
    await expect(canvas).toHaveAttribute('data-rail-tracks', '0');
    const off = await timing(page, view === '2d' ? 'cityflows:render' : 'cityflows:render3d');
    const offImage = await canvas.screenshot({
      path: info.outputPath(`donnersberger-${view}-off.png`),
    });
    expect(onImage.equals(offImage)).toBe(false);
    await button(page, 'Layers').click();
    await toggle.check();
    await page.keyboard.press('Escape');
    const onAgain = await timing(page, view === '2d' ? 'cityflows:render' : 'cityflows:render3d');
    await button(page, 'Layers').click();
    await toggle.uncheck();
    await page.keyboard.press('Escape');
    const offAgain = await timing(page, view === '2d' ? 'cityflows:render' : 'cityflows:render3d');
    const onFrameMs = (on.frameMs + onAgain.frameMs) / 2,
      offFrameMs = (off.frameMs + offAgain.frameMs) / 2;
    reports.push({ view, on, off, onAgain, offAgain, onFrameMs, offFrameMs });
    await writeFile(info.outputPath('rail-frames.json'), JSON.stringify(reports, null, 2));
    // Lead (TASK-126 merge): as T44, the 10% gate holds locally; CI's software GPU is too noisy.
    if (!process.env.CI) expect(onFrameMs).toBeLessThanOrEqual(offFrameMs * 1.1);
    await button(page, 'Layers').click();
    await toggle.check();
    await page.keyboard.press('Escape');
  }
  await button(page, 'Layers').click();
  await layers.getByLabel('Places', { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  const tram = Object.values(rail.tracks)
    .filter((t) => t.kind === 'tram')
    .sort((a, b) => polylineLength(b.line) - polylineLength(a.line))[0]!;
  const tramPoint = pointAtDistance(
    tram.line,
    cumulativeLengths(tram.line),
    polylineLength(tram.line) / 2,
  );
  await page.evaluate((p) => window.cityflows!.setView3D!(p, 2.5, 40, 0), tramPoint);
  await page.getByLabel('3D city view').screenshot({ path: info.outputPath('tram-street-3d.png') });
  await button(page, '3D').click();
  await expect(map).toHaveAttribute('data-active', 'true');
  await click(page, tramPoint, '2d');
  await expect(page.getByRole('region', { name: 'Track inspector' })).toContainText('Tram');
  await map.screenshot({ path: info.outputPath('tram-street-2d.png') });
  expect(
    (await city(page)).context!.features.some((f) => f.class === 'rail' || f.class === 'tram'),
  ).toBe(false);
  expect(await city(page)).toEqual(source);
  expect(errors).toEqual([]);
});
