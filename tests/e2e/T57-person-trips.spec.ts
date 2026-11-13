import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import type { Person } from '../../src/schema';
import { button, clickVehicle, metrics, pageErrors } from './helpers';

test('@smoke T57 a walker and a vehicle occupant open the person journey', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  const city = grid5x5();
  city.name = 'Person trips';
  const home = Object.values(city.places).find((place) => place.kind === 'residential')!;
  const work = Object.values(city.places).find((place) => place.kind === 'work')!;
  home.population = 2;
  work.jobs = 2;
  const scenario = defaultScenario('grid5x5');
  scenario.endS = scenario.startS + 1800;
  scenario.demand.workStart = { meanS: scenario.startS + 5, sdS: 0 };
  scenario.demand.workDuration = { meanS: 3600, sdS: 0 };
  scenario.demand.classShares = {
    local: { car: 1, van: 0, truck: 0, bus: 0 },
    through: { car: 1, van: 0, truck: 0, bus: 0 },
  };
  const population: Person[] = ['driver', 'walker'].map((id) => ({
    id,
    homePlaceId: home.id,
    workPlaceId: work.id,
    hasCar: id === 'driver',
    agenda: [],
  }));
  const { manifest } = JSON.parse(
    await readFile('fixtures/projects/grid5x5.cityflows.json', 'utf8'),
  );
  const project = { city, scenarios: [scenario], population };
  manifest.name = city.name;
  manifest.schemaVersion = city.schemaVersion;
  manifest.files = Object.fromEntries(
    Object.entries(project).map(([key, value]) => [
      `${key}.json`,
      createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    ]),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await page.getByLabel('Open project', { exact: true }).setInputFiles({
    name: 'person-trips.cityflows.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ manifest, ...project })),
  });
  await expect(page.getByRole('heading', { name: 'Person trips', exact: true })).toBeVisible();
  await expect(button(page, 'Play')).toBeEnabled();
  await expect.poll(async () => (await metrics(page)).trips.pending).toBe(2);
  await page.evaluate(() => window.cityflows!.step(100));

  // Person demand makes the layer available without a Scenario.walkers test source.
  await button(page, 'Layers').click();
  await expect(
    page.getByRole('region', { name: 'Map layers' }).getByLabel('Pedestrians', { exact: true }),
  ).toBeChecked();
  await button(page, 'Layers').click();
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.walkers?.count ?? 0))
    .toBeGreaterThan(0);
  // Wait for the owner to finish their access walk, so the two people no longer overlap.
  const vehicle = await page.evaluate(async () => {
    const api = window.cityflows!;
    for (let attempt = 0; attempt < 60; attempt++) {
      await api.step(100);
      const snapshot = await api.snapshot!();
      for (const id of snapshot.id.subarray(0, snapshot.count)) {
        if ((await api.inspect(id))?.personId === 'driver') return { id, timeS: snapshot.timeS };
      }
    }
    throw new Error('The driver has not reached their car');
  });
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS))
    .toBe(vehicle.timeS);
  const walker = await page.evaluate(async () => {
    const api = window.cityflows!;
    const snapshot = api.drawnSnapshot!()!.walkers!;
    for (let i = 0; i < snapshot.count; i++) {
      const detail = await api.inspectWalker!(snapshot.id[i]!);
      if (detail?.personId === 'walker')
        return api.worldToScreen!({ x: snapshot.x[i]!, y: snapshot.y[i]! });
    }
    throw new Error('The walking person is missing from the drawn snapshot');
  });
  await page.getByLabel('City map', { exact: true }).click({ position: walker });
  await expect(page.getByRole('heading', { name: 'Person walker', exact: true })).toBeVisible();
  await expect(page.getByLabel('Person details', { exact: true })).toContainText('Homes');
  await expect(page.getByLabel('Person details', { exact: true })).toContainText('Offices');
  await expect(page.getByRole('table', { name: 'Agenda', exact: true })).toContainText('07:00:05');
  await expect(page.getByRole('table', { name: 'Journey legs', exact: true })).toContainText(
    'Walk',
  );
  await page.screenshot({ path: info.outputPath('person-2d.png') });
  await button(page, '3D').click();
  await expect(page.getByLabel('3D city view', { exact: true })).toHaveAttribute(
    'data-walkers',
    /^\d+$/,
  );
  await expect(page.getByLabel('3D city view', { exact: true })).not.toHaveAttribute(
    'data-walkers',
    '0',
  );
  await expect(page.getByRole('heading', { name: 'Person walker', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('person-3d.png') });
  await button(page, '3D').click();
  await page.keyboard.press('Escape');
  // The first car leaves beneath the floating toolbox; pan it into the clear map area.
  await page.mouse.move(640, 400);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(640, 600, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await clickVehicle(page, vehicle.id);
  await button(page, 'driver').click();
  await expect(page.getByRole('heading', { name: 'Person driver', exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Journey legs', exact: true })).toContainText(
    'Access',
  );
  await expect(page.getByRole('table', { name: 'Journey legs', exact: true })).toContainText(
    'Drive',
  );

  await page.evaluate(() => window.cityflows!.step(14_000));
  await expect(page.getByRole('table', { name: 'Journey legs', exact: true })).toContainText(
    'Egress',
  );
  await expect.poll(async () => (await metrics(page)).persons?.completed ?? 0).toBe(2);
  await button(page, 'Demand').click();
  const demand = page.getByRole('region', { name: 'Demand', exact: true });
  await expect(demand.getByLabel('Person journeys', { exact: true })).toContainText('2, 2, 0');
  await expect(demand.getByLabel('Person journeys', { exact: true })).toContainText('1, 0');
  // Sidebar sections stay open until their header is clicked again (TASK-160).
  await button(page, 'Demand').click();
  await button(page, 'New').click();
  await page
    .getByRole('dialog', { name: 'New city', exact: true })
    .getByRole('button', { name: 'Station', exact: true })
    .click();
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, 'Demand').click();
  await expect(page.getByRole('region', { name: 'Demand', exact: true })).toContainText(
    '0 persons',
  );
  await button(page, 'Demand').click();
  await button(page, 'Layers').click();
  await expect(
    page.getByRole('region', { name: 'Map layers' }).getByLabel('Pedestrians', { exact: true }),
  ).toBeChecked();
  expect(errors).toEqual([]);
});
