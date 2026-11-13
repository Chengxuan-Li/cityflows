import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { generatePopulation, scheduleTrips } from '../../src/demand';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { town } from '../../src/fixtures/town';
import { button, clickVehicle, pageErrors } from './helpers';

test('T67 a household shows who drives which car, who borrows it and who has none', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  const errors = pageErrors(page);
  const city = town();
  city.name = 'Households';
  // A late-shift workplace: its workers leave after 18:00 and may borrow a day worker's car.
  const late = Object.values(city.places).find((place) => place.kind === 'work')!;
  late.profile = {
    arrivals: Array.from({ length: 24 }, (_, hour) => Number(hour === 18)),
    departures: Array.from({ length: 24 }, (_, hour) => Number(hour === 23)),
  };
  const scenario = defaultScenario('town');
  scenario.endS = 10 * 3600;
  scenario.demand.carShare = 0.5;
  scenario.demand.personsPerResident = 0.2;
  scenario.demand.workStart = { meanS: 7 * 3600 + 900, sdS: 600 };
  // TASK-129's drivers as scheduled: mode choice off, so no driver's tour walks.
  scenario.demand.modeChoice = { enabled: false };
  const population = generatePopulation(city, scenario.demand);
  const trips = scheduleTrips(
    city,
    population.map((p) => ({ ...p })),
    scenario,
  );
  const carOf = new Map(
    trips.flatMap((t) => (t.carId && t.personId ? [[t.personId, t.carId]] : [])),
  );
  const departs = new Map<string, number>();
  for (const t of trips)
    if (t.personId && !departs.has(t.personId)) departs.set(t.personId, t.departS);
  // A morning driver whose car a late-shift member borrows, and a member with no free car.
  const household = population.find((p) => {
    const members = population.filter((m) => m.householdId === p.householdId);
    return (
      !p.hasCar &&
      carOf.has(p.id) &&
      members.some(
        (m) => m.hasCar && carOf.get(m.id) === carOf.get(p.id) && departs.get(m.id)! < 8 * 3600,
      ) &&
      members.some((m) => !m.hasCar && !carOf.has(m.id))
    );
  })!.householdId;
  const members = population.filter((m) => m.householdId === household);
  const borrower = members.find((m) => !m.hasCar && carOf.has(m.id))!;
  const owner = members.find((m) => m.hasCar && carOf.get(m.id) === carOf.get(borrower.id))!;
  const walker = members.find((m) => !m.hasCar && !carOf.has(m.id))!;
  const car = carOf.get(owner.id)!;

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
    name: 'households.cityflows.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ manifest, ...project })),
  });
  await expect(page.getByRole('heading', { name: 'Households', exact: true })).toBeVisible();
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, 'Demand').click();
  await expect(page.getByRole('region', { name: 'Demand', exact: true })).toContainText(
    `${population.length.toLocaleString('en')} persons`,
  );
  await expect(page.getByRole('region', { name: 'Demand', exact: true })).toContainText(
    `${new Set(population.map((p) => p.householdId)).size.toLocaleString('en')} households`,
  );
  await button(page, 'Demand').click();

  // Run until the owner has walked to the car and drives it.
  const vehicle = await page.evaluate(async (owner) => {
    const api = window.cityflows!;
    for (let attempt = 0; attempt < 600; attempt++) {
      await api.step(100);
      const snapshot = await api.snapshot!();
      for (const id of snapshot.id.subarray(0, snapshot.count))
        if ((await api.inspect(id))?.personId === owner) return id;
    }
    throw new Error('The owner has not set off');
  }, owner.id);
  await clickVehicle(page, vehicle);
  // The car's household is on the vehicle's own detail.
  await expect(page.getByText(car, { exact: true })).toBeVisible();
  await button(page, owner.id).click();
  await expect(
    page.getByRole('heading', { name: `Person ${owner.id}`, exact: true }),
  ).toBeVisible();
  const person = page.getByLabel('Person details', { exact: true });
  await expect(person).toContainText(household);
  await expect(person).toContainText(car);
  await page.screenshot({ path: info.outputPath('t67-driver.png') });

  await person.getByRole('button', { name: borrower.id, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: `Person ${borrower.id}`, exact: true }),
  ).toBeVisible();
  await expect(person).toContainText(car);
  await expect(person).toContainText(`Borrowed from ${owner.id}`);
  await page.screenshot({ path: info.outputPath('t67-borrower.png') });

  await person.getByRole('button', { name: walker.id, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: `Person ${walker.id}`, exact: true }),
  ).toBeVisible();
  await expect(person).toContainText('No free household car today');
  await page.screenshot({ path: info.outputPath('t67-no-free-car.png') });
  expect(errors).toEqual([]);
});
