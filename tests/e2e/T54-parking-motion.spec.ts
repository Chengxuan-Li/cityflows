import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compile } from '../../src/network';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { scheduleTrips } from '../../src/demand';
import { createEngine } from '../../src/sim/engine';
import type { City, Person, Scenario } from '../../src/schema';
import { placeCamera } from '../../bench/geometry-shots';
import { button, city, departVehicle, importOsm, metrics, pageErrors } from './helpers';

const targetTime = 8 * 3600;
function controlledScenario(): Scenario {
  const scenario = defaultScenario('grid5x5', 118);
  scenario.startS = 7 * 3600;
  scenario.endS = 10 * 3600;
  scenario.simParams = { streetParkingShare: 0 };
  scenario.demand.carShare = 1;
  scenario.demand.personsPerResident = 1;
  scenario.demand.workStart = { meanS: targetTime - 60, sdS: 0 };
  scenario.demand.workDuration = { meanS: 600, sdS: 0 };
  scenario.demand.throughTripsPerHour = Array(24).fill(0);
  scenario.demand.classShares = {
    local: { car: 1, van: 0, truck: 0, bus: 0 },
    through: { car: 1, van: 0, truck: 0, bus: 0 },
  };
  scenario.demand.chains = { schoolShare: 0, shopShare: 0, leisureShare: 0 };
  return scenario;
}
async function openProject(page: Page, source: City, population: Person[], scenario: Scenario) {
  const { manifest } = JSON.parse(
    readFileSync('fixtures/projects/grid5x5.cityflows.json', 'utf8'),
  ) as { manifest: { name: string; schemaVersion: number; files: Record<string, string> } };
  const project = { city: source, population, scenarios: [scenario] };
  manifest.name = source.name;
  manifest.schemaVersion = source.schemaVersion;
  manifest.files = Object.fromEntries(
    Object.entries(project).map(([key, value]) => [
      `${key}.json`,
      createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    ]),
  );
  await page.getByLabel('Open project').setInputFiles({
    name: 'parking-motion.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ manifest, ...project })),
  });
  await expect(button(page, 'Play')).toBeEnabled();
  await page.evaluate(
    (steps) => window.cityflows!.step(steps),
    (targetTime - scenario.startS) * 10,
  );
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS), {
      timeout: 120_000,
    })
    .toBe(targetTime);
}
async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  id: number,
  centre: { x: number; y: number },
  zoom: number,
) {
  const records = [];
  if ((await button(page, '3D').getAttribute('aria-pressed')) === 'true')
    await button(page, '3D').click();
  await expect(page.getByLabel('City map', { exact: true })).toHaveAttribute(
    'aria-hidden',
    'false',
  );
  // The projection API switches from 3D on the render frame after the React control.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  for (const view of ['2d', '3d']) {
    if (view === '2d') await placeCamera(page, [centre.x, centre.y], zoom);
    else {
      await button(page, '3D').click();
      await expect
        .poll(() => page.evaluate(() => !!window.cityflows!.view3D?.()), { timeout: 120_000 })
        .toBe(true);
      await page.evaluate(
        ({ centre, zoom }) => window.cityflows!.setView3D!(centre, zoom, 55, 30),
        { centre, zoom },
      );
    }
    const canvas = page.getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const point =
      view === '3d'
        ? await page.evaluate((id) => window.cityflows!.vehicleToScreen!(id)!, id)
        : await page.evaluate((id) => {
            const api = window.cityflows!,
              s = api.drawnSnapshot!()!,
              i = s.id.indexOf(id),
              heading = s.heading[i]!;
            return api.worldToScreen!({
              x: s.x[i]! - 2 * Math.cos(heading),
              y: s.y[i]! - 2 * Math.sin(heading),
            });
          }, id);
    await canvas.click({ position: point });
    await expect(page.getByRole('heading', { name: `Vehicle ${id}`, exact: true })).toBeVisible();
    const path = info.outputPath(`${name}${view === '3d' ? '-3d' : ''}.png`);
    await canvas.screenshot({ path, animations: 'disabled' });
    const timing = await page.evaluate(async () => {
      window.cityflowsRenderContinuously = true;
      const values: number[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (e.name === 'cityflows:render' || e.name === 'cityflows:render3d')
            values.push(e.duration);
      });
      observer.observe({ entryTypes: ['measure'] });
      for (let i = 0; i < 30; i++) await new Promise(requestAnimationFrame);
      observer.disconnect();
      window.cityflowsRenderContinuously = false;
      return {
        meanRenderMs: values.reduce((a, b) => a + b, 0) / values.length,
        frames: values.length,
      };
    });
    expect(timing.frames).toBeGreaterThan(0);
    records.push({ view, path, ...timing });
    await button(page, 'Close inspector').click();
  }
  return records;
}

test('T54 Munich: select a car driving a lot and a strip car mid-manoeuvre in both views @smoke', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm');
  const source = await city(page),
    result = compile(source);
  if (!result.ok) throw new Error('compile');
  const net = result.compiled,
    lot = net.parking[net.index.parking.get('pk:2042')!]!;
  expect(lot.capacity).toBeGreaterThan(1);
  const provider = createRouteProvider(),
    costs = freeFlowLinkCosts(net);
  const homes = net.places
    .filter((p) => p.kind === 'residential' && source.places[p.id]!.population >= 2)
    .map((home) => ({
      home,
      cost: Math.min(
        ...home.connectorsOut.flatMap((from) =>
          lot.connectorsIn.map((into) => {
            const c = net.connectors[from]!,
              route = provider.route(net, costs, {
                fromLane: c.lane,
                fromPosM: c.positionM,
                toConnector: into,
                vehicleClass: 'car',
                purpose: 'private',
                desiredSpeedFactor: 1,
                noise: 0,
                seed: 118,
              });
            return route.ok ? route.route.costS : Infinity;
          }),
        ),
      ),
    }))
    .filter((h) => Number.isFinite(h.cost))
    .sort((a, b) => a.cost - b.cost);
  const home = homes[0]!.home;
  const population: Person[] = ['a', 'b'].map((id) => ({
    id: `v118:${id}`,
    homePlaceId: home.id,
    householdId: `hh:${home.id}:${id}`,
    workPlaceId: net.places[lot.place]!.id,
    hasCar: true,
    agenda: [],
  }));
  source.places[home.id]!.profile = null;
  source.places[net.places[lot.place]!.id]!.profile = null;
  const scenario = controlledScenario();
  let moving = 0;
  // Fix a real episode at the required 08:00 camera, without changing any geometry.
  for (let attempt = 0; attempt < 20; attempt++) {
    const engine = createEngine(),
      trips = scheduleTrips(source, population, scenario);
    engine.load({ compiled: net, trips, scenario });
    engine.step((targetTime - scenario.startS) * 10);
    const s = engine.snapshot();
    moving =
      [...s.id].find(
        (id) =>
          engine.inspect(id)?.parkingPhase === 'drive_in' &&
          engine.inspect(id)?.parkingFacility === lot.id,
      ) ?? 0;
    if (moving) break;
    const arrived = trips.flatMap((_, i) => {
      const d = engine.inspect(i + 1);
      return d?.arrivedS ? [d.arrivedS] : [];
    });
    scenario.demand.workStart.meanS += [...s.id].some(
      (id) => engine.inspect(id)?.parkingPhase === 'park',
    )
      ? 5
      : arrived.length
        ? Math.max(2, targetTime - Math.max(...arrived) + 8)
        : -10;
  }
  expect(moving, 'controlled arrivals drive the TASK-104 camera lot at 08:00').toBeGreaterThan(0);
  await openProject(page, source, population, scenario);
  expect((await page.evaluate((id) => window.cityflows!.inspect(id), moving))?.state).toBe(
    'in_lot',
  );
  const lotShots = await capture(page, info, 'V118-munich-lot', moving, { x: 135.7, y: 305.3 }, 7);
  const lotSnapshot = await page.evaluate(() => window.cityflows!.drawnSnapshot!());

  const stripSource = structuredClone(source),
    stripScenario = controlledScenario();
  const strip = net.parking
    .filter((f) => f.kind === 'roadside' && (f.spaces?.length ?? 0) > 2)
    .sort(
      (a, b) =>
        Math.hypot(a.centroid.x + 300, a.centroid.y - 290) -
        Math.hypot(b.centroid.x + 300, b.centroid.y - 290),
    )[0]!;
  for (const f of Object.values(stripSource.parking!))
    f.occupancyAtStart = f.id === strip.id ? 1 : 0;
  const origin = net.places
    .filter((p) => p.kind === 'residential')
    .sort(
      (a, b) =>
        Math.hypot(a.centroid.x - strip.centroid.x, a.centroid.y - strip.centroid.y) -
        Math.hypot(b.centroid.x - strip.centroid.x, b.centroid.y - strip.centroid.y),
    )[0]!;
  stripSource.places[origin.id]!.profile = null;
  stripScenario.simParams.streetParkingShare = 1;
  stripScenario.demand.workStart.meanS = targetTime - 2;
  const owner: Person = {
    id: 'v118:strip',
    homePlaceId: origin.id,
    householdId: `hh:${origin.id}:0`,
    workPlaceId: net.places[lot.place]!.id,
    hasCar: true,
    agenda: [],
  };
  await openProject(page, stripSource, [owner], stripScenario);
  // The owner now walks to the strip first; observe the first departure after that access leg.
  await departVehicle(page, 1);
  expect((await page.evaluate(() => window.cityflows!.inspect(1)))?.parkingPhase).toBe('leave');
  const stripTimeS = (await metrics(page)).timeS;
  await expect
    .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS))
    .toBe(stripTimeS);
  const stripSnapshot = await page.evaluate(() => window.cityflows!.drawnSnapshot!());
  expect(stripSnapshot?.poseLane?.[0]).toBeGreaterThanOrEqual(0);
  const stripShots = await capture(page, info, 'V118-munich-street', 1, strip.centroid, 12);
  await writeFile(
    info.outputPath('V118-motion.json'),
    JSON.stringify(
      {
        scenario:
          'Controlled two-person lot visit and one strip departure; imported geometry unchanged',
        lot: lot.id,
        lotShots,
        lotSnapshot,
        strip: strip.id,
        stripShots,
        stripSnapshot,
        metrics: await page.evaluate(() => window.cityflows!.metrics()),
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
});
