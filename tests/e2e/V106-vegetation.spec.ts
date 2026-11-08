import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { button, city, importOsm, pageErrors } from './helpers';
import { placeCamera } from '../../bench/geometry-shots';

async function timing(page: Page) {
  return page.evaluate(async () => {
    const frames: number[] = [],
      renders: number[] = [];
    let capture = false;
    const observer = new PerformanceObserver((list) => {
      if (capture)
        for (const entry of list.getEntries())
          if (entry.name === 'cityflows:render' || entry.name === 'cityflows:render3d')
            renders.push(entry.duration);
    });
    observer.observe({ entryTypes: ['measure'] });
    let last = 0;
    for (let i = 0; i < 60; i++) {
      const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      capture = i >= 10;
      if (capture) frames.push(now - last);
      last = now;
    }
    observer.disconnect();
    const mean = (samples: number[]) => samples.reduce((sum, n) => sum + n, 0) / samples.length;
    return { frameMs: mean(frames), renderMs: mean(renders), samples: frames.length };
  });
}

test('@smoke V106 tree layers share placement in both views and stay within the frame allowance', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm');
  const imported = await city(page);
  const map = page.getByLabel('City map', { exact: true }),
    three = page.getByLabel('3D city view', { exact: true });
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  for (const label of ['Basemap', 'Places', 'Entrances and exits'])
    await layers.getByLabel(label, { exact: true }).uncheck();
  const trees = layers.getByLabel('Trees', { exact: true }),
    street = layers.getByLabel('Street trees', { exact: true });
  await expect(trees).toBeChecked();
  await expect(street).toBeChecked();
  const counts = await map.getAttribute('data-tree-counts');
  expect(JSON.parse(counts!).wood).toBeGreaterThan(0);
  expect(JSON.parse(counts!).street).toBeGreaterThan(0);
  const report: unknown[] = [];
  for (const view of ['2d-overview', '3d-overview', '3d-street']) {
    const is3d = view.startsWith('3d');
    if (view === '2d-overview') await placeCamera(page, [0, 0], 0.43);
    else {
      if (view === '3d-overview') await button(page, '3D').click();
      await expect(three).toHaveAttribute('data-view', '3d');
      await page.evaluate(
        (zoom) => window.cityflows!.setView3D!({ x: 0, y: -60 }, zoom, 55, 0),
        view === '3d-overview' ? 0.4 : 1.7,
      );
    }
    const canvas = is3d ? three : map;
    await expect(canvas).toHaveAttribute('data-tree-counts', counts!);
    const buildMs = await canvas.getAttribute(
      is3d ? 'data-build-ms' : 'data-vegetation-rebuild-ms',
    );
    const samples: Awaited<ReturnType<typeof timing>>[] = [];
    // CI's software GPU makes frame ratios noise and the four samples cost minutes per view
    // (as T44): there it takes one sample per state and skips the 1.2 allowance.
    const states = process.env.CI ? [true, false] : [true, false, true, false];
    for (const on of states) {
      await trees.setChecked(on);
      await street.setChecked(on);
      await expect(canvas).toHaveAttribute(
        'data-street-trees',
        on ? String(JSON.parse(counts!).street) : '0',
      );
      samples.push(await timing(page));
      if (samples.length <= 2)
        await canvas.screenshot({ path: info.outputPath(`V106-${view}-${on ? 'on' : 'off'}.png`) });
    }
    const mean = (on: boolean) => {
      const picked = samples.filter((_, i) => states[i] === on);
      return picked.reduce((sum, sample) => sum + sample.frameMs, 0) / picked.length;
    };
    const onMs = mean(true),
      offMs = mean(false);
    report.push({
      view,
      counts: JSON.parse(counts!),
      buildMs,
      placementMs: await canvas.getAttribute('data-tree-placement-ms'),
      samples,
      onMs,
      offMs,
      ratio: onMs / offMs,
    });
    await writeFile(info.outputPath('V106-timings.json'), JSON.stringify(report, null, 2));
    await expect(canvas).toHaveAttribute(
      is3d ? 'data-build-ms' : 'data-vegetation-rebuild-ms',
      buildMs!,
    );
    if (!process.env.CI) expect(onMs).toBeLessThanOrEqual(offMs * 1.2);
    await trees.check();
    await street.check();
    // Each layer works independently, without hiding or rebuilding surroundings.
    await trees.uncheck();
    await expect(canvas).toHaveAttribute('data-trees', '0');
    await expect(canvas).not.toHaveAttribute('data-street-trees', '0');
    await trees.check();
    await street.uncheck();
    await expect(canvas).not.toHaveAttribute('data-trees', '0');
    await expect(canvas).toHaveAttribute('data-street-trees', '0');
    await street.check();
  }
  expect(await city(page)).toEqual(imported);
  expect(errors).toEqual([]);
  await writeFile(info.outputPath('V106-timings.json'), JSON.stringify(report, null, 2));
});
