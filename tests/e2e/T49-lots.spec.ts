import { expect, test } from '@playwright/test';
import { button, city, importOsm, pageErrors } from './helpers';
import { placeCamera } from '../../bench/geometry-shots';
import { fixtureTerrain } from './terrain-fixture';

test('@smoke T49 imports both surface-lot cities and toggles stall paint in 2D and 3D', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  for (const [file, x, y, zoom] of [
    ['munich-donnersberger', 135.7, 305.3, 7],
    ['sindelfingen-a81', -379, -498.4, 5],
  ] as const) {
    const path = 'fixtures/osm/' + file + '.osm';
    await fixtureTerrain(page, path);
    await importOsm(page, path, { terrain: true });
    const imported = await city(page);
    expect(Object.keys(imported.parking!).length).toBeGreaterThan(20);
    await button(page, 'Layers').click();
    const layers = page.getByRole('region', { name: 'Map layers' });
    for (const label of ['Basemap', 'Places', 'Entrances and exits'])
      await layers.getByLabel(label, { exact: true }).uncheck();
    const toggle = layers.getByLabel('Parking stalls', { exact: true });
    await expect(toggle).toBeChecked();
    await button(page, 'Layers').click();
    await placeCamera(page, [x, y], zoom);
    for (const mode of ['2d', '3d']) {
      if (mode === '3d') {
        await button(page, '3D').click();
        await page.waitForFunction(() => !!window.cityflows?.view3D?.());
        await page.evaluate(
          ({ x, y, zoom }) => window.cityflows!.setView3D!({ x, y }, zoom, 45, 0),
          { x, y, zoom },
        );
      }
      const canvas = page.getByLabel(mode === '2d' ? 'City map' : '3D city view', { exact: true });
      await expect(canvas).not.toHaveAttribute('data-parking-stalls', '0');
      const on = await canvas.screenshot({ path: info.outputPath(`${file}-${mode}-on.png`) });
      await button(page, 'Layers').click();
      await toggle.uncheck();
      await expect(canvas).toHaveAttribute('data-parking-stalls', '0');
      await button(page, 'Layers').click();
      const off = await canvas.screenshot({ path: info.outputPath(`${file}-${mode}-off.png`) });
      expect(on.equals(off)).toBe(false);
      await button(page, 'Layers').click();
      await toggle.check();
      await button(page, 'Layers').click();
    }
    await button(page, '3D').click();
    expect(await city(page)).toEqual(imported);
  }
  expect(errors).toEqual([]);
});
