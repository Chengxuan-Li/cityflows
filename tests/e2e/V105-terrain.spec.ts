import { expect, test } from '@playwright/test';
import { button, city, pageErrors } from './helpers';
import { fixtureTerrain } from './terrain-fixture';
import { placeCamera } from '../../bench/geometry-shots';
import { encode } from 'fast-png';

test('@smoke V105 wizard terrain drapes 3D, shades 2D and toggles back to the plain city', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://**/*', (route) => route.abort());
  const tile = Buffer.from(
    encode({ width: 1, height: 1, channels: 3, data: new Uint8Array([244, 241, 231]) }),
  );
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: tile,
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
  await fixtureTerrain(page, 'fixtures/osm/sindelfingen-a81.osm');
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  async function importCity(terrain: boolean) {
    await button(page, 'Import').click();
    const dialog = page.getByRole('dialog', { name: 'Import city' });
    await dialog.getByLabel('OSM file').setInputFiles('fixtures/osm/sindelfingen-a81.osm');
    await dialog.getByLabel('Include terrain').setChecked(terrain);
    await button(page, 'Import roads').click();
    await expect(dialog.getByRole('region', { name: 'Import diagnostics' })).toContainText(
      '0 errors',
      { timeout: 60_000 },
    );
    if (terrain)
      await expect(dialog.getByRole('region', { name: 'Import diagnostics' })).toContainText(
        'AWS Terrain Tiles',
      );
    await button(page, 'Continue').click();
    await button(page, 'Accept city').click();
    await expect(dialog).toBeHidden({ timeout: 120_000 });
  }
  await importCity(true);
  const imported = await city(page);
  expect(imported.terrain).toBeDefined();
  const { terrain, ...network } = imported;
  expect(terrain!.cols).toBe(169);
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  for (const name of ['Basemap', 'Places', 'Entrances and exits'])
    await layers.getByLabel(name, { exact: true }).uncheck();
  const toggle = layers.getByLabel('Terrain', { exact: true });
  await expect(toggle).toBeChecked();
  await button(page, 'Layers').click();
  await placeCamera(page, [0, 0], 0.27);
  const map = page.getByLabel('City map', { exact: true });
  await expect(map).toHaveAttribute('data-terrain', 'true');
  const shaded = await map.screenshot({ path: info.outputPath('sindelfingen-hillshade.png') });
  await button(page, 'Layers').click();
  await toggle.uncheck();
  await button(page, 'Layers').click();
  await expect(map).toHaveAttribute('data-terrain', 'false');
  const plain2D = await map.screenshot();
  expect(shaded.equals(plain2D)).toBe(false);
  await button(page, '3D').click();
  const three = page.getByLabel('3D city view', { exact: true });
  await expect(three).toHaveAttribute('data-terrain', 'false');
  await page.evaluate(() => window.cityflows!.setView3D!({ x: 66, y: 203 }, 3, 35, 55));
  const flat = await windowFrames();
  await button(page, 'Layers').click();
  await toggle.check();
  await button(page, 'Layers').click();
  await expect(three).toHaveAttribute('data-terrain', 'true');
  const relief = await windowFrames();
  expect(relief[0]).not.toBe(flat[0]);
  await three.screenshot({ path: info.outputPath('sindelfingen-3d-terrain.png') });
  const bounds = (await three.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(bounds.x + bounds.width / 2 + 120, bounds.y + bounds.height / 2 - 40, {
    steps: 8,
  });
  await page.mouse.up({ button: 'right' });
  expect((await windowFrames())[0]).not.toBe(relief[0]);
  await three.screenshot({ path: info.outputPath('sindelfingen-orbit.png') });
  await page.evaluate(() => window.cityflows!.setView3D!({ x: 66, y: 203 }, 6, 30, -65));
  await three.screenshot({ path: info.outputPath('sindelfingen-bridge.png') });
  await page.evaluate(() => window.cityflows!.setView3D!({ x: 66, y: 203 }, 3, 35, 55));
  await button(page, 'Layers').click();
  await toggle.uncheck();
  await button(page, 'Layers').click();
  await expect(three).toHaveAttribute('data-terrain', 'false');
  expect((await windowFrames())[0]).toBe(flat[0]);
  await button(page, 'Layers').click();
  await toggle.check();
  await layers.getByLabel('Basemap', { exact: true }).check();
  await button(page, 'Layers').click();
  await page.evaluate(() => window.cityflows!.setView3D!({ x: 0, y: 0 }, 0.04, 45));
  await expect.poll(() => three.getAttribute('data-tiles').then(Number)).toBeGreaterThan(0);
  await three.screenshot({ path: info.outputPath('wide-basemap-terrain.png') });
  await button(page, 'Layers').click();
  await toggle.uncheck();
  await layers.getByLabel('Basemap', { exact: true }).uncheck();
  await button(page, 'Layers').click();
  await importCity(false);
  expect(await city(page)).toEqual(network);
  await expect(three).toHaveAttribute('data-terrain', 'false');
  await page.evaluate(() => window.cityflows!.setView3D!({ x: 66, y: 203 }, 3, 35, 55));
  expect((await windowFrames())[0]).toBe(flat[0]);
  expect(errors).toEqual([]);

  async function windowFrames() {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    return page.evaluate(() => window.cityflows!.capture3D!());
  }
});
