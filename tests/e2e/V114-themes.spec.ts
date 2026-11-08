import { expect, test } from '@playwright/test';
import { button, city, importOsm, pageErrors } from './helpers';

test('V114 defaults, switching in both views, undo and project round-trip @smoke', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/downtown.osm', { terrain: false, surroundings: false });
  await button(page, 'Layers').click();
  const choice = page.getByLabel('Marking style');
  await expect(choice).toHaveValue('us');
  await expect(page.getByLabel('City map', { exact: true })).toHaveAttribute(
    'data-marking-theme',
    'us',
  );
  const version = (await city(page)).version;
  await choice.selectOption('uk');
  await expect(page.getByLabel('City map', { exact: true })).toHaveAttribute(
    'data-marking-theme',
    'uk',
  );
  await button(page, 'Layers').click();
  await button(page, 'Undo').click();
  await expect.poll(async () => (await city(page)).markingTheme).toBe('us');
  await button(page, 'Redo').click();
  await expect.poll(async () => (await city(page)).markingTheme).toBe('uk');
  await button(page, '3D').click();
  await expect(page.getByLabel('3D city view')).toHaveAttribute('data-marking-theme', 'uk');
  await button(page, 'Layers').click();
  await choice.selectOption('de');
  await expect(page.getByLabel('3D city view')).toHaveAttribute('data-marking-theme', 'de');
  await button(page, 'Layers').click();
  await button(page, 'Undo').click();
  await expect(page.getByLabel('3D city view')).toHaveAttribute('data-marking-theme', 'uk');
  await button(page, 'Redo').click();
  await expect(page.getByLabel('3D city view')).toHaveAttribute('data-marking-theme', 'de');
  await button(page, 'Layers').click();
  await choice.selectOption('us');
  await expect(page.getByLabel('3D city view')).toHaveAttribute('data-marking-theme', 'us');
  await button(page, 'Layers').click();
  await button(page, '3D').click();
  await expect(page.getByLabel('City map', { exact: true })).toHaveAttribute(
    'data-marking-theme',
    'us',
  );
  expect((await city(page)).version).toBe(version);
  const downloading = page.waitForEvent('download');
  await button(page, 'Save').click();
  const download = await downloading;
  await page.getByLabel('Open project').setInputFiles((await download.path())!);
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, 'Layers').click();
  await expect(choice).toHaveValue('us');
  expect(errors).toEqual([]);
});
