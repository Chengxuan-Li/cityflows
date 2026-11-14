import { decode } from 'fast-png';
import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  button,
  city,
  closeSidebarOverlay,
  fillsMap,
  importOsm,
  pageErrors,
  sidebarSection,
  toolbarAction,
} from './helpers';
import { railFrameTiming, railTimingEnvironment } from './rail-frame-timing';
import { fixtureTerrain } from './terrain-fixture';
import { compileRail } from '../../src/network/rail';
import { trainPoint, trainTimetable } from '../../src/network/trains';
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
const timing = (page: Page, measure: string) => railFrameTiming(page, measure, sample);
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
  await button(page, 'Layers').click();
  await writeFile(
    info.outputPath('rail-environment.json'),
    JSON.stringify(await railTimingEnvironment(page), null, 2),
  );
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
    await button(page, 'Layers').click();
    await expect(canvas).toHaveAttribute('data-rail-tracks', '0');
    const off = await timing(page, view === '2d' ? 'cityflows:render' : 'cityflows:render3d');
    const offImage = await canvas.screenshot({
      path: info.outputPath(`donnersberger-${view}-off.png`),
    });
    expect(onImage.equals(offImage)).toBe(false);
    await button(page, 'Layers').click();
    await toggle.check();
    await button(page, 'Layers').click();
    const onAgain = await timing(page, view === '2d' ? 'cityflows:render' : 'cityflows:render3d');
    await button(page, 'Layers').click();
    await toggle.uncheck();
    await button(page, 'Layers').click();
    const offAgain = await timing(page, view === '2d' ? 'cityflows:render' : 'cityflows:render3d');
    const onFrameMs = (on.frameMs + onAgain.frameMs) / 2,
      offFrameMs = (off.frameMs + offAgain.frameMs) / 2;
    reports.push({ view, on, off, onAgain, offAgain, onFrameMs, offFrameMs });
    await writeFile(info.outputPath('rail-frames.json'), JSON.stringify(reports, null, 2));
    await button(page, 'Layers').click();
    await toggle.check();
    await button(page, 'Layers').click();
  }
  await button(page, 'Layers').click();
  await layers.getByLabel('Places', { exact: true }).uncheck();
  await button(page, 'Layers').click();
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
  // Preserve all inspection and screenshot coverage even if a view exceeds its budget.
  // Lead (TASK-126 merge): as T44, CI's software GPU skips this local ten-percent gate.
  if (!process.env.CI)
    for (const report of reports)
      expect(report.onFrameMs, `${report.view}: rail frame cost`).toBeLessThanOrEqual(
        report.offFrameMs * 1.1,
      );
  expect(errors).toEqual([]);
});

test('T62 frame samples include the final render and exclude warmup entries', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    let frame = 0;
    window.requestAnimationFrame = (callback) =>
      raf((now) => {
        performance.measure('rail-timing-regression', {
          start: performance.now(),
          duration: ++frame,
        });
        callback(now);
      });
  });
  const result = await railFrameTiming(page, 'rail-timing-regression', { frames: 12, warm: 2 });
  expect(result.renders).toEqual(Array.from({ length: 10 }, (_, i) => i + 3));
});

// The two capture frames share a camera: a mutable frame uses the source mesh, then the
// settled frame can reuse paint while preserving framebuffer alpha and cross-layer depth.
test('T62 cached paint keeps camera changes, selection, resize and rail edges visible', async ({
  page,
  browser,
}, info) => {
  // 2.3 to 2.7 min on CI runners, so 180 s timed out on a slower one (Full run 43587159656).
  test.setTimeout(300_000);
  const errors: string[] = [];
  async function openMap(next: Page) {
    next.on('pageerror', (error) => errors.push(error.message));
    await next.route('https://**/*', (route) => route.abort());
    await fixtureTerrain(next, 'fixtures/osm/munich-donnersberger.osm');
    await next.goto('/');
    await expect(button(next, 'Play')).toBeEnabled();
    await importOsm(next, 'fixtures/osm/munich-donnersberger.osm');
    await (await sidebarSection(next, 'Layers')).click();
    const layers = next.getByRole('region', { name: 'Map layers' });
    for (const label of ['Basemap', 'Entrances and exits', 'Terrain'])
      await layers.getByLabel(label, { exact: true }).uncheck();
    await button(next, 'Layers').click();
    await closeSidebarOverlay(next);
    await (await toolbarAction(next, '3D')).click();
    const canvas = next.getByLabel('3D city view', { exact: true });
    await expect(canvas).toHaveAttribute('data-terrain', 'false');
    await expect
      .poll(() => canvas.getAttribute('data-rail-tracks').then(Number))
      .toBeGreaterThan(0);
    return canvas;
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let canvas = await openMap(page);
  const backend = (await railTimingEnvironment(page)).gpu.renderer;
  const cacheBackend = /swiftshader/i.test(backend ?? '');
  const source = await city(page);
  const graph = compileRail(source)!;
  const route = trainTimetable(graph).routes.find((route) => route.kind === 'sbahn')!;
  const trainFocus = trainPoint(graph, route, route.stops[0]!.positionM);
  const station = Object.values(source.places).find((p) =>
    p.provenance.osmIds?.includes(2470092007),
  )!;
  const ring = station.shape.kind === 'polygon' ? station.shape.ring : [station.shape.pos];
  const centre = {
    x: (Math.min(...ring.map((p) => p.x)) + Math.max(...ring.map((p) => p.x))) / 2,
    y: (Math.min(...ring.map((p) => p.y)) + Math.max(...ring.map((p) => p.y))) / 2,
  };
  const reports = [];
  for (const [name, zoom, pitch, bearing] of [
    ['station', 1.6, 40, 0],
    ['restored', 1.6, 40, 0],
    ['train-focus', 1.6, 40, 0],
    ['selected', 1.6, 40, 0],
    ['rotated', 3.2, 45, 70],
    ['far', 0.55, 55, 180],
    ['resized', 2.5, 40, 25],
    ['dpr', 1.6, 40, 0],
    ['pan', 1.6, 40, 0],
    ['large', 1.6, 40, 0],
  ] as const) {
    if (name === 'selected') {
      await click(page, centre, '3d');
      await page.getByLabel('Station rail access').getByRole('button').first().click();
      await page
        .getByRole('region', { name: 'Platform inspector' })
        .getByRole('button')
        .nth(1)
        .click();
      await expect(page.getByRole('region', { name: 'Track inspector' })).toBeVisible();
    }
    if (name === 'rotated') await page.keyboard.press('Escape');
    if (name === 'resized') {
      await page.setViewportSize({ width: 1100, height: 720 });
      // The map area is the window less the docked sidebar and inspector (TASK-160).
      await fillsMap(canvas);
    }
    if (name === 'dpr') {
      await page.close();
      page = await browser.newPage({
        viewport: { width: 720, height: 480 },
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
      });
      canvas = await openMap(page);
      // Under 900 px the sidebars float, so the map spans the window: 720 px at two pixels each.
      await fillsMap(canvas);
      await expect(canvas).toHaveJSProperty('width', 1440);
    }
    if (name === 'pan') {
      const before = await page.evaluate(() => window.cityflows!.view3D!());
      await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-view="3d"]')!;
        canvas.dataset.paintHistory = '';
        new MutationObserver(() => {
          canvas.dataset.paintHistory += `${canvas.dataset.railPaint},`;
        }).observe(canvas, { attributes: true, attributeFilter: ['data-rail-paint'] });
      });
      const bounds = (await canvas.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2 + 100, bounds.y + bounds.height / 2 + 40, {
        steps: 8,
      });
      await page.mouse.up();
      await page.evaluate(() => window.cityflows!.capture3D!());
      expect(await page.evaluate(() => window.cityflows!.view3D!())).not.toEqual(before);
      await expect(canvas).toHaveAttribute('data-paint-history', /mesh/);
      await canvas.screenshot({ path: info.outputPath('panned.png') });
    }
    if (name === 'large') {
      await page.setViewportSize({ width: 800, height: 600 });
      await fillsMap(canvas);
      await expect(canvas).toHaveJSProperty('width', 1600);
    }
    const images = await page.evaluate(
      async ({ centre, zoom, pitch, bearing, restore }) => {
        if (restore) {
          const before = (await window.cityflows!.capture3D!())[1]!;
          const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-view="3d"]')!;
          const extension = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context');
          if (!extension) throw new Error('Context restoration is unavailable');
          await new Promise<void>((resolve) => {
            canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true });
            canvas.addEventListener(
              'webglcontextlost',
              () => setTimeout(() => extension.restoreContext(), 100),
              { once: true },
            );
            extension.loseContext();
          });
          return [before, (await window.cityflows!.capture3D!())[1]!];
        }
        window.cityflows!.setView3D!(centre, zoom, pitch, bearing);
        return window.cityflows!.capture3D!();
      },
      {
        centre:
          name === 'train-focus'
            ? trainFocus
            : name === 'selected'
              ? { x: centre.x + 0.1, y: centre.y }
              : centre,
        zoom,
        pitch,
        bearing,
        restore: name === 'restored',
      },
    );
    await expect(canvas).toHaveAttribute(
      'data-rail-paint',
      cacheBackend && name !== 'large' ? 'cached' : 'mesh',
    );
    const [original, cached] = images.map((image) => Buffer.from(image.split(',')[1]!, 'base64'));
    await writeFile(info.outputPath(`${name}-mesh.png`), original!);
    await writeFile(info.outputPath(`${name}-cache.png`), cached!);
    const a = decode(original!),
      b = decode(cached!);
    expect([b.width, b.height, b.channels]).toEqual([a.width, a.height, a.channels]);
    let changed = 0,
      totalDelta = 0,
      alphaChanged = 0;
    for (let i = 0; i < a.data.length; i += a.channels) {
      let delta = 0;
      for (let c = 0; c < 3; c++)
        delta = Math.max(delta, Math.abs(a.data[i + c]! - b.data[i + c]!));
      if (delta > 2) changed++;
      totalDelta += delta;
      if (a.channels === 4 && a.data[i + 3] !== b.data[i + 3]) alphaChanged++;
    }
    const pixels = a.width * a.height;
    reports.push({
      name,
      backend,
      width: a.width,
      height: a.height,
      pixels,
      changed,
      totalDelta,
      alphaChanged,
    });
    await writeFile(info.outputPath('paint-cache-pixels.json'), JSON.stringify(reports, null, 2));
    if (name === 'selected') {
      let accent = 0;
      for (let i = 0; i < b.data.length; i += b.channels)
        // The selection colour, system blue #007AFF since TASK-162 (was #4DAFA6).
        if (b.data[i] === 0 && b.data[i + 1] === 122 && b.data[i + 2] === 255) accent++;
      expect(accent, 'selected track is recolored in the cache').toBeGreaterThan(5);
    }
    expect(alphaChanged, `${name}: opaque framebuffer alpha`).toBe(0);
    expect(changed / pixels, `${name}: silhouettes and depth`).toBeLessThan(0.01);
    expect(totalDelta / pixels, `${name}: palette and coverage`).toBeLessThan(0.3);
  }
  // The window is 800 px wide here, where the sidebar floats and starts closed.
  await (await sidebarSection(page, 'Layers')).click();
  const terrain = page
    .getByRole('region', { name: 'Map layers' })
    .getByLabel('Terrain', { exact: true });
  await terrain.check();
  await button(page, 'Layers').click();
  await expect(canvas).toHaveAttribute('data-terrain', 'true');
  await page.evaluate(() => window.cityflows!.capture3D!());
  await expect(canvas).toHaveAttribute('data-rail-paint', 'mesh');
  await button(page, 'Layers').click();
  await terrain.uncheck();
  await button(page, 'Layers').click();
  await page.getByLabel('See below ground', { exact: true }).check();
  await page.evaluate(() => window.cityflows!.capture3D!());
  await expect(canvas).toHaveAttribute('data-rail-paint', 'mesh');
  expect(errors).toEqual([]);
  await page.close();
});
