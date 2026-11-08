import { expect, test } from '@playwright/test';
import { button, city, importOsm, pageErrors } from './helpers';
import { fixtureTerrain } from './terrain-fixture';

test('@smoke V109 pitched roofs, details and hidden buildings on terrain preserve the city', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = pageErrors(page);
  page.on('console', (message) => {
    if (message.type() === 'error' && /THREE|shader|WebGL/.test(message.text()))
      errors.push(message.text());
  });
  await page.route('https://**/*', (route) => route.abort());
  for (const name of ['munich-donnersberger', 'sindelfingen-a81']) {
    await fixtureTerrain(page, `fixtures/osm/${name}.osm`);
    await page.goto('/');
    await expect(button(page, 'Play')).toBeEnabled();
    await importOsm(page, `fixtures/osm/${name}.osm`);
    const before = await city(page);
    expect(before.terrain).toBeDefined();
    await button(page, '3D').click();
    const canvas = page.getByLabel('3D city view', { exact: true });
    await expect(canvas).toHaveAttribute('data-building-details', 'true', { timeout: 120_000 });
    await expect(canvas).toHaveAttribute('data-terrain', 'true');
    await button(page, 'Layers').click();
    const layers = page.getByRole('region', { name: 'Map layers' });
    for (const label of ['Basemap', 'Places', 'Entrances and exits'])
      await layers.getByLabel(label, { exact: true }).uncheck();
    const details = layers.getByLabel('Building details', { exact: true });
    await expect(details).toBeChecked();
    await button(page, 'Layers').click();
    const munich = name.startsWith('munich');
    await page.evaluate(
      (munich) =>
        window.cityflows!.setView3D!({ x: munich ? 610 : 515, y: munich ? 425 : 520 }, 4, 62, 30),
      munich,
    );
    const built = await canvas.getAttribute('data-build-ms');
    const detailed = await canvas.screenshot({ path: info.outputPath(`${name}-details.png`) });
    await button(page, 'Layers').click();
    await details.uncheck();
    await button(page, 'Layers').click();
    await expect(canvas).toHaveAttribute('data-building-details', 'false');
    const boxes = await canvas.screenshot({ path: info.outputPath(`${name}-boxes.png`) });
    expect(detailed.equals(boxes)).toBe(false);
    expect(await canvas.getAttribute('data-build-ms')).toBe(built);
    await page.getByLabel('Buildings', { exact: true }).uncheck();
    await expect(canvas).toHaveAttribute('data-buildings', '0');
    await button(page, 'Layers').click();
    await expect(details).toHaveCount(0);
    await button(page, 'Layers').click();
    await canvas.screenshot({ path: info.outputPath(`${name}-no-buildings.png`) });
    await page.getByLabel('Buildings', { exact: true }).check();
    await button(page, 'Layers').click();
    await details.check();
    await button(page, 'Layers').click();
    await expect(canvas).toHaveAttribute('data-building-details', 'true');
    expect(await canvas.getAttribute('data-build-ms')).toBe(built);
    expect(await city(page)).toEqual(before);
  }
  expect(errors).toEqual([]);
});
