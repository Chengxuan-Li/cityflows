import { expect, test } from '@playwright/test';
import { button, city, importOsm, pageErrors } from './helpers';

test('@smoke V110 sidewalks and footways toggle independently in 2D and 3D', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('https://**/*', (r) => r.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm');
  const original = await city(page);
  expect(Object.keys(original.walk!.links).length).toBeGreaterThan(1000);
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  for (const name of ['Basemap', 'Places', 'Entrances and exits'])
    await layers.getByLabel(name, { exact: true }).uncheck();
  const sidewalks = layers.getByLabel('Sidewalks', { exact: true }),
    footways = layers.getByLabel('Footways', { exact: true });
  await expect(sidewalks).toBeChecked();
  await expect(footways).toBeChecked();
  for (const mode of ['2d', '3d']) {
    if (mode === '3d') await button(page, '3D').click();
    const canvas = page.getByLabel(mode === '2d' ? 'City map' : '3D city view', { exact: true });
    await expect(canvas).toHaveAttribute('data-sidewalks', 'true');
    await expect(canvas).toHaveAttribute('data-footways', 'true');
    await canvas.screenshot({ path: info.outputPath(`V110-${mode}-on.png`) });
    await sidewalks.uncheck();
    await expect(canvas).toHaveAttribute('data-sidewalks', 'false');
    await expect(canvas).toHaveAttribute('data-footways', 'true');
    await sidewalks.check();
    await footways.uncheck();
    await expect(canvas).toHaveAttribute('data-sidewalks', 'true');
    await expect(canvas).toHaveAttribute('data-footways', 'false');
    await footways.check();
  }
  expect(await city(page)).toEqual(original);
  expect(errors).toEqual([]);
});
