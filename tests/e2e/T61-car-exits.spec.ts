import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { placeCamera } from '../../bench/geometry-shots';
import { pointAtDistance } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { scheduleTrips } from '../../src/demand';
import { withHouseholds } from '../../src/demand/households';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { button, city, clickVehicle, clickWorld, importOsm, metrics, pageErrors } from './helpers';

test('T61 Munich split garage keeps its arrival and a controlled driver leaves on the car street', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm', {
    surroundings: false,
    terrain: false,
  });
  // TASK-131 re-rooted main's p:1733 and p:1831 to the places of the same OSM sources: p:1726
  // (three of p:1733's five building ways; its garage has 1002 spaces, not 1071) and p:1836.
  const source = await city(page),
    home = source.places['p:1726']!;
  const result = compile(source);
  if (!result.ok) throw new Error('Munich must compile');
  const net = result.compiled;
  expect(home.connectors.map((c) => c.direction)).toEqual(['in', 'out']);
  expect(home.connectors[0]!.roadId).toBe('r:379');
  expect(home.connectors[1]!.roadId).toBe('r:380');
  const entrance = home.connectors[0]!;
  const arrivalLane = net.lanes[net.index.lane.get(`${entrance.roadId}#${entrance.lane}`)!]!;
  const center = pointAtDistance(arrivalLane.polyline, arrivalLane.cumulative, entrance.positionM);
  await placeCamera(page, [center.x, center.y], 2);
  await clickWorld(page, center);
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByRole('heading', { name: 'Workplaces', exact: true })).toBeVisible();
  await button(page, 'Workplaces · 1002 spaces').click();
  await expect(inspector.getByText('garage', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('garage-1981.png') });
  const exit = home.connectors[1]!,
    lane = net.lanes[net.index.lane.get(`${exit.roadId}#${exit.lane}`)!]!;
  const exitPoint = pointAtDistance(lane.polyline, lane.cumulative, exit.positionM);
  await placeCamera(page, [exitPoint.x, exitPoint.y], 4);
  await page.screenshot({ path: info.outputPath('garage-exit.png') });

  // This workplace has no natural departure before 09:00. Give one test driver a car here.
  home.population = 1;
  source.name = 'T61 Munich controlled departure';
  const scenario = defaultScenario('grid5x5');
  scenario.startS = 8 * 3600 + 50 * 60;
  scenario.endS = 10 * 3600;
  scenario.demand.workStart = { meanS: 8 * 3600 + 57 * 60, sdS: 0 };
  scenario.demand.workDuration = { meanS: 9 * 3600, sdS: 0 };
  scenario.demand.classShares = {
    local: { car: 1, van: 0, truck: 0, bus: 0 },
    through: { car: 1, van: 0, truck: 0, bus: 0 },
  };
  // TASK-113: mode choice is on by default; the controlled driver drives.
  scenario.demand.modeChoice = { enabled: false };
  const population = [
    { id: 'garage-driver', homePlaceId: home.id, workPlaceId: 'p:1836', hasCar: true, agenda: [] },
  ];
  const project = { city: source, scenarios: [scenario], population };
  const { manifest } = JSON.parse(readFileSync('fixtures/projects/grid5x5.cityflows.json', 'utf8'));
  manifest.name = source.name;
  manifest.files = Object.fromEntries(
    Object.entries(project).map(([k, v]) => [
      `${k}.json`,
      createHash('sha256').update(JSON.stringify(v)).digest('hex'),
    ]),
  );
  await page.getByLabel('Open project', { exact: true }).setInputFiles({
    name: 'T61.cityflows.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ manifest, ...project })),
  });
  await expect(page.getByRole('heading', { name: source.name, exact: true })).toBeVisible();
  await expect(button(page, 'Play')).toBeEnabled();
  // Station riders (TASK-128) come first in the schedule; the driver's trip is found by person.
  const driverId =
    scheduleTrips(
      source,
      withHouseholds(source, population, scenario.demand.seed),
      scenario,
      net,
    ).findIndex((trip) => trip.personId === 'garage-driver') + 1;
  await page.evaluate(async (id) => {
    const api = window.cityflows!;
    for (let second = 0; second < 600; second++) {
      await api.step(10);
      const driver = await api.inspect(id);
      if (driver?.state === 'driving' && driver.lane >= 0) return;
    }
    throw new Error('The controlled driver did not leave the garage');
  }, driverId);
  await placeCamera(page, [exitPoint.x, exitPoint.y], 4);
  await clickVehicle(page, driverId);
  await page.screenshot({ path: info.outputPath('garage-driver-on-exit.png') });
  const roads = await page.evaluate(
    async ({ roadIds, id }) => {
      const api = window.cityflows!,
        seen: string[] = [];
      const remaining = Math.round((9 * 3600 - (await api.metrics()).timeS) * 10);
      for (let step = 0; step <= remaining; step += 10) {
        const detail = await api.inspect(id);
        if (detail?.state === 'driving' && detail.lane >= 0) {
          const id = roadIds[detail.lane]!;
          if (seen.at(-1) !== id) seen.push(id);
        }
        if (step < remaining) await api.step(Math.min(10, remaining - step));
      }
      return seen;
    },
    { roadIds: net.lanes.map((l) => net.roads[l.road]!.id), id: driverId },
  );
  expect(roads[0]).toBe('r:380');
  expect(roads.length).toBeGreaterThan(1);
  expect(roads).not.toContain('r:373');
  for (const id of roads)
    expect(
      source.roads[id]!.lanes.some((l) => l.allowed.includes('car')),
      id,
    ).toBe(true);
  expect((await metrics(page)).timeS).toBe(9 * 3600);
  console.info('T61 controlled garage departure', {
    place: home.id,
    garage: 'pk:1981',
    arrival: home.connectors[0],
    exit,
    roads,
  });
  await page.screenshot({ path: info.outputPath('garage-departure-0900.png') });
  expect(errors).toEqual([]);
});
