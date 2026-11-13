import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { compile } from '../../src/network';
import { placeCamera } from '../../bench/geometry-shots';
import { button, city, clickVehicle, clickWorld, importOsm, metrics, pageErrors } from './helpers';

test('T63 Munich from 08:30 shows a searching car’s claimed strip space', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm', { terrain: false });
  const source = await city(page),
    result = compile(source);
  if (!result.ok) throw new Error('compile');
  const targetS = 8.5 * 3600;
  const nowS = (await metrics(page)).timeS;
  await page.evaluate((steps) => window.cityflows!.step(steps), Math.round((targetS - nowS) * 10));
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS), {
      timeout: 120_000,
    })
    .toBe(targetS);
  await button(page, 'Layers').click();
  await page
    .getByRole('region', { name: 'Map layers' })
    .getByLabel('Parking occupancy', { exact: true })
    .check();
  await button(page, 'Layers').click();
  const claimant = () =>
    page.evaluate(async () => {
      const api = window.cityflows!,
        snapshot = api.drawnSnapshot!()!;
      const details = await Promise.all([...snapshot.id].map((id) => api.inspect(id)));
      const detail = details.find(
        (d) =>
          d?.state === 'driving' &&
          d.parkingPhase === null &&
          d.parkingSpace !== null &&
          d.parkingSearchTimeS > 0,
      );
      if (!detail) return null;
      const index = snapshot.id.indexOf(detail.id);
      return { ...detail, x: snapshot.x[index]!, y: snapshot.y[index]! };
    });
  // TASK-173: tours choose their mode as they depart, so the searching car of the moment varies;
  // take the first one from 08:30 on, in 10 s steps.
  let car = await claimant();
  for (let i = 0; !car && i < 180; i++) {
    const timeS = targetS + (i + 1) * 10;
    await page.evaluate(() => window.cityflows!.step(100));
    await expect
      .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS))
      .toBe(timeS);
    car = await claimant();
  }
  if (!car) throw new Error('No searching strip claimant from 08:30 to 09:00');
  const slot = result.compiled.parkingSpaces![car.parkingSpace!]!;
  expect(result.compiled.parking[slot.parking]!.kind).toBe('roadside');
  await placeCamera(page, [car.x, car.y], 9);
  await clickVehicle(page, car.id);
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.locator('dt', { hasText: /^Claimed space$/ }).locator('+ dd')).toHaveText(
    String(car.parkingSpace),
  );
  await page.screenshot({ path: info.outputPath('claim-inspector.png') });
  await button(page, 'Close inspector').click();
  // The pre-claims run rejected this bay ten times. The way spans several parking strips.
  const chased = result.compiled.parkingSpaces!.find((space) => {
    const facility = result.compiled.parking[space.parking]!;
    return (
      facility.kind === 'roadside' &&
      facility.source.provenance.osmIds?.includes(704167778) &&
      Math.hypot(space.position.x + 365.42, space.position.y - 418.36) < 0.1
    );
  });
  if (!chased) throw new Error('Missing reference bay on OSM way 704167778');
  await placeCamera(page, [chased.position.x, chased.position.y], 12);
  await clickWorld(page, chased.position);
  await expect(inspector.locator('dt', { hasText: /^Kind$/ }).locator('+ dd')).toHaveText(
    'roadside',
  );
  await page.screenshot({ path: info.outputPath('formerly-chased-strip.png') });
  await writeFile(
    info.outputPath('claim-details.json'),
    JSON.stringify(
      { car, strip: await inspector.innerText(), metrics: (await metrics(page)).parking },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
});
