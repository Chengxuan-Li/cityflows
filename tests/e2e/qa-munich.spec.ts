import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import type { City } from '../../src/schema';
import {
  button,
  city,
  clickWorld,
  importOsm,
  metrics,
  pageErrors,
  stateHash,
  writeMetrics,
} from './helpers';

const provenance = (source: City) =>
  Object.fromEntries(
    Object.values(source.roads)
      .filter((road) =>
        road.provenance.inferred?.some((note) => /^(smoothed|realigned):/.test(note)),
      )
      .map((road) => [road.id, road.provenance]),
  );

test('QA Munich live edit survives save and fresh-context replay with version, hash and geometry provenance', async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm');
  const imported = await city(page);
  const geometryNotes = provenance(imported);
  const notes = Object.values(geometryNotes).flatMap((value) => value.inferred ?? []);
  expect(notes.some((note) => note.startsWith('smoothed:'))).toBe(true);
  expect(notes.some((note) => note.startsWith('realigned:'))).toBe(true);
  // Select a visible road through the renderer, then change its speed while playing.
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  let selected: string | undefined;
  for (const road of Object.values(imported.roads).sort((a, b) => a.id.localeCompare(b.id))) {
    if (road.centerline.length < 3) continue;
    await clickWorld(page, road.centerline[Math.floor(road.centerline.length / 2)]!);
    if (await inspector.getByText('Lanes and street settings', { exact: true }).isVisible()) {
      const description = await inspector.locator('p.muted').first().innerText();
      selected = Object.values(imported.roads).find((candidate) =>
        description.startsWith(`${candidate.from} → ${candidate.to}`),
      )?.id;
      if (selected) break;
    }
    await page.keyboard.press('Escape');
  }
  expect(selected, 'a Munich street selectable through the map').toBeDefined();
  await inspector.getByText('Lanes and street settings', { exact: true }).click();
  await button(page, 'Play').click();
  const start = (await metrics(page)).timeS;
  const speed = inspector.getByRole('spinbutton', { name: 'Speed limit (km/h)', exact: true });
  await speed.fill('25');
  await speed.press('Enter');
  await expect(page.getByText(/^Edit applied ·/)).toBeVisible();
  await expect(button(page, 'Pause')).toBeEnabled();
  await expect.poll(async () => (await metrics(page)).timeS).toBeGreaterThan(start);
  await button(page, 'Pause').click();
  const edited = await city(page);
  expect(edited.version).toBe(imported.version + 1);
  expect(provenance(edited)).toEqual(geometryNotes);
  expect(edited.roads[selected!]!.speedLimitMps).toBeCloseTo(25 / 3.6);
  const downloading = page.waitForEvent('download');
  await button(page, 'Save').click();
  const download = await downloading;
  const path = info.outputPath('munich.cityflows');
  await download.saveAs(path);
  const archive = unzipSync(await readFile(path));
  const saved = JSON.parse(strFromU8(archive['city.json']!)) as City;
  expect(saved).toEqual(edited);
  expect(provenance(saved)).toEqual(provenance(edited));
  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  const steps = 1200;
  await page.evaluate((steps) => window.cityflows!.step(steps), steps);
  const here = { hash: await stateHash(page), metrics: await metrics(page) };
  expect(here.metrics.trips.driving + here.metrics.trips.completed).toBeGreaterThan(0);
  const context = await browser.newContext({ baseURL });
  try {
    const other = await context.newPage();
    const otherErrors = pageErrors(other);
    await other.route('https://**/*', (route) => route.abort());
    await other.goto('/');
    await expect(button(other, 'Play')).toBeEnabled();
    await other.getByLabel('Open project').setInputFiles(path);
    await expect(other.getByRole('heading', { name: edited.name, exact: true })).toBeVisible();
    await expect(button(other, 'Step')).toBeEnabled();
    expect(await city(other)).toEqual(edited);
    expect(provenance(await city(other))).toEqual(provenance(edited));
    await other.evaluate((steps) => window.cityflows!.step(steps), steps);
    expect(await stateHash(other)).toBe(here.hash);
    expect((await metrics(other)).trips).toEqual(here.metrics.trips);
    expect(otherErrors).toEqual([]);
    await writeMetrics(info, {
      road: selected,
      version: edited.version,
      steps,
      hash: here.hash,
      provenanceRoads: Object.keys(geometryNotes),
      trips: here.metrics.trips,
    });
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});
