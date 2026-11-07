import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { City, Scenario } from '../../src/schema';
import { button, clickVehicle, metrics, pageErrors } from './helpers';

test('V100 all four classes remain selectable and class colours are presentation only @smoke', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  const fixture = JSON.parse(
    await readFile(
      new URL('../../fixtures/projects/grid5x5.cityflows.json', import.meta.url),
      'utf8',
    ),
  ) as { city: City; scenarios: Scenario[]; manifest: { files: Record<string, string> } };
  Object.values(fixture.city.places).find((place) => place.kind === 'residential')!.population =
    500;
  const scenario = fixture.scenarios[0]!;
  scenario.startS = 7 * 3600;
  scenario.demand.carShare = 1;
  scenario.demand.personsPerResident = 1;
  scenario.demand.workStart = { meanS: scenario.startS, sdS: 0 };
  const shares = { car: 0.25, van: 0.25, truck: 0.25, bus: 0.25 };
  scenario.demand.classShares = { local: shares, through: shares };
  for (const [name, value] of [
    ['city.json', fixture.city],
    ['scenarios.json', fixture.scenarios],
  ] as const) {
    fixture.manifest.files[name] = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  await page.getByLabel('Open project').setInputFiles({
    name: 'four-classes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect.poll(async () => (await metrics(page)).trips.pending).toBe(1000);
  const targets = await page.evaluate(async () => {
    const api = window.cityflows!;
    for (let minute = 0; minute < 10; minute++) {
      await api.step(600);
      const snapshot = await api.snapshot!();
      const targets = Array.from({ length: 4 }, (_, vehicleClass) => {
        const index = snapshot.vclass.subarray(0, snapshot.count).indexOf(vehicleClass);
        return index < 0
          ? null
          : {
              id: snapshot.id[index]!,
              x: snapshot.x[index]!,
              y: snapshot.y[index]!,
              vehicleClass,
            };
      });
      if (targets.every((target) => target !== null)) return targets;
    }
    throw new Error('The mixed-class queue never contained all four classes');
  });
  const timeS = (await metrics(page)).timeS;
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS))
    .toBe(timeS);
  const classes = ['car', 'van', 'truck', 'bus'];
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  for (const target of targets) {
    await clickVehicle(page, target.id);
    await expect(inspector.locator('dt', { hasText: /^Class$/ }).locator('+ dd')).toHaveText(
      classes[target.vehicleClass]!,
    );
    await expect(inspector.locator('dt', { hasText: /^Purpose$/ }).locator('+ dd')).toHaveText(
      target.vehicleClass === 1 ? /delivery|service/ : 'private',
    );
  }
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  const colour = layers.getByLabel('Colour vehicles by class', { exact: true });
  await expect(colour).not.toBeChecked();
  const map = page.getByLabel('City map', { exact: true });
  const hash = await page.evaluate(() => window.cityflows!.hash());
  await button(page, 'Layers').click();
  const destinationColours = await map.screenshot();
  await button(page, 'Layers').click();
  await colour.check();
  await button(page, 'Layers').click();
  await expect.poll(async () => (await map.screenshot()).equals(destinationColours)).toBe(false);
  expect(await page.evaluate(() => window.cityflows!.hash())).toBe(hash);
  await button(page, 'Layers').click();
  await colour.uncheck();
  await button(page, 'Layers').click();
  await expect.poll(async () => (await map.screenshot()).equals(destinationColours)).toBe(true);
  await button(page, 'Layers').click();
  await colour.check();
  await button(page, 'Layers').click();
  await page.screenshot({ path: info.outputPath('four-classes-2d.png') });
  await button(page, '3D').click();
  const map3D = page.getByLabel('3D city view', { exact: true });
  await expect(map3D).toBeVisible();
  await expect.poll(() => map3D.getAttribute('data-vehicles').then(Number)).toBeGreaterThan(0);
  for (const target of targets) {
    await page.evaluate(
      (target) => window.cityflows!.setView3D!({ x: target.x, y: target.y }, 7, 85),
      target,
    );
    await page.waitForTimeout(100);
    const point = await page.evaluate((id) => window.cityflows!.vehicleToScreen!(id)!, target.id);
    await map3D.click({ position: point });
    await expect(
      inspector.getByRole('heading', { name: `Vehicle ${target.id}`, exact: true }),
    ).toBeVisible();
    await expect(inspector.locator('dt', { hasText: /^Class$/ }).locator('+ dd')).toHaveText(
      classes[target.vehicleClass]!,
    );
  }
  await page.screenshot({ path: info.outputPath('four-classes-3d.png') });
  await button(page, 'Layers').click();
  await expect(colour).toBeChecked();
  await colour.uncheck();
  expect(await page.evaluate(() => window.cityflows!.hash())).toBe(hash);
  expect(errors).toEqual([]);
});
