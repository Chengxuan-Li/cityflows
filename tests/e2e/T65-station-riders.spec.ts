import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { button, city, importOsm, pageErrors } from './helpers';
import { riderOf, stationRiders } from '../../src/demand/stations';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { distance, nearestOnPolyline } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { compileRail } from '../../src/network/rail';
import { stationArrivals, trainTimetable } from '../../src/network/trains';
import { TRANSIT_RIDER_ID } from '../../src/sim/transit';
import { railStation } from '../demand/rail-station';

// TASK-128 (T65): S-Bahn riders walk out of Donnersbergerbrücke's entrances just after a train
// stops, a selected rider reads as arrived by train, and a returning rider's trip ends at the
// station. TASK-174: they ride in on that train and cross its platform to the entrance first. Munich imports with 3D: e2e group e, beside the other rail specs.

test.use({
  trace: {
    mode: 'retain-on-failure',
    screenshots: false,
    snapshots: { dom: true, aria: true, screen: false },
  },
});

/** Saves a shot with the test output and, when CITYFLOWS_SHOT_DIR is set, into that folder. */
async function shot(target: Locator | Page, info: TestInfo, name: string) {
  await target.screenshot({ path: info.outputPath(name) });
  const dir = process.env.CITYFLOWS_SHOT_DIR;
  if (dir) {
    await mkdir(dir, { recursive: true });
    await target.screenshot({ path: join(dir, name) });
  }
}

async function centre2D(page: Page, point: Vec2, zoom: number) {
  await page.evaluate(
    ({ point: p, zoom }) => {
      const c = document.querySelector<HTMLCanvasElement>('canvas[data-view="2d"]')!,
        r = c.getBoundingClientRect();
      const scale = () =>
        window.cityflows!.worldToScreen!({ x: 1, y: 0 }).x -
        window.cityflows!.worldToScreen!({ x: 0, y: 0 }).x;
      const wheel = (to: number, x: number, y: number) =>
        c.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -Math.log(to / scale()) / 0.0015,
            clientX: r.x + x,
            clientY: r.y + y,
            bubbles: true,
            cancelable: true,
          }),
        );
      if (scale() > 2) wheel(2, r.width / 2, r.height / 2);
      const v = window.cityflows!.worldToScreen!(p);
      wheel(zoom, v.x, v.y);
    },
    { point, zoom },
  );
  const map = page.getByLabel('City map', { exact: true }),
    box = (await map.boundingBox())!;
  const v = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), point);
  await page.mouse.move(box.x + v.x, box.y + v.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
}

async function seek(page: Page, target: number) {
  await page.evaluate(async (target) => {
    const api = window.cityflows!,
      now = (await api.metrics()).timeS;
    await api.step(Math.max(1, Math.round((target - now) * 10)));
  }, target);
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          window.cityflows!.drawnSnapshot!()?.timeS === (await window.cityflows!.metrics()).timeS,
      ),
    )
    .toBe(true);
}

/** The drawn walkers that are riders, with their person ids and positions. */
const riderWalkers = (page: Page) =>
  page.evaluate(async () => {
    const api = window.cityflows!,
      walkers = api.drawnSnapshot!()?.walkers;
    const found: { id: number; personId: string; x: number; y: number }[] = [];
    for (let i = 0; i < (walkers?.count ?? 0); i++) {
      const detail = await api.inspectWalker!(walkers!.id[i]!);
      if (detail?.personId?.startsWith('rider:'))
        found.push({
          id: walkers!.id[i]!,
          personId: detail.personId,
          x: walkers!.x[i]!,
          y: walkers!.y[i]!,
        });
    }
    return found;
  });

test('T65 Munich riders walk out of Donnersbergerbrücke after an S-Bahn stop, 2D, 3D and the person inspector', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  page.setDefaultTimeout(15_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm', { terrain: false });
  const source = await city(page);
  const station = source.places['p:1484']!;
  expect(station.name).toBe('Donnersbergerbrücke');
  const doors = station.station!.entrances.map((id) => source.walk!.nodes[id]!.pos);
  const rail = compileRail(source)!;
  // The import wizard's scenario: the grid default at a 0.15 demand scale.
  const scenario = defaultScenario('grid5x5');
  scenario.demand.personsPerResident = 0.15;
  const { trips } = stationRiders(source, scenario);
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' });
  for (const label of ['Basemap', 'Entrances and exits'])
    await layers.getByLabel(label, { exact: true }).uncheck();
  await button(page, 'Layers').click();

  // The first S-Bahn stop at the station after 07:15. TASK-174: its riders get off at doors along
  // the whole train, walk across the platform at walking pace and pass the entrance their walk out
  // starts at just as that walk departs, so they reach the entrances over about two minutes.
  const arrival = stationArrivals(rail, trainTimetable(rail), 7.25 * 3600, 8 * 3600).find(
    (a) => a.kind === 'sbahn' && station.station!.platforms.includes(a.platform),
  )!;
  const out = trips.filter(
    (t) => t.id.endsWith(':out') && riderOf(t.personId!)!.arrivalS === Math.round(arrival.arrivalS),
  );
  expect(out.length).toBeGreaterThan(1);
  const leftS = new Map(out.map((t) => [t.personId!, t.departS]));
  const everyone = [...leftS.keys()].sort();
  const order = [...leftS.values()].sort((a, b) => a - b);
  const timeS = order[Math.floor(order.length / 2)]! + 15;
  const pace = 1.4;
  const toEntrance = (p: Vec2) => Math.min(...doors.map((d) => distance(d, p)));
  const toTrain = (p: Vec2) => nearestOnPolyline(arrival.body, p).away;
  /** This train's riders on the map, each drawn exactly once. */
  const drawn = async () => {
    const found = (await riderWalkers(page)).filter((w) => leftS.has(w.personId));
    expect(new Set(found.map((w) => w.personId)).size).toBe(found.length);
    return found;
  };

  // Just after the stop every rider is on the platform at a door of the train, along its length.
  await seek(page, arrival.arrivalS + 2);
  const off = await drawn();
  expect(off.map((w) => w.personId).sort()).toEqual(everyone);
  for (const w of off) {
    expect(w.id).toBeGreaterThanOrEqual(TRANSIT_RIDER_ID);
    expect(toTrain(w)).toBeLessThan(2 * pace + 1);
  }
  const along = off.map((w) => nearestOnPolyline(arrival.body, w).along);
  expect(Math.max(...along) - Math.min(...along)).toBeGreaterThan(40);

  /** Each rider reaches an entrance on the platform just before its walk out departs and walks
   * on from that spot: no jump between the platform and the walk network. */
  const passEntrances = async (riders: string[]) => {
    for (const personId of riders) {
      const walkS = leftS.get(personId)!;
      await seek(page, walkS - 0.5);
      const before = (await drawn()).find((w) => w.personId === personId)!;
      expect(before.id).toBeGreaterThanOrEqual(TRANSIT_RIDER_ID);
      expect(toEntrance(before)).toBeLessThan(3);
      await seek(page, walkS + 1);
      const after = (await drawn()).find((w) => w.personId === personId)!;
      expect(after.id).toBeLessThan(TRANSIT_RIDER_ID);
      expect(distance(before, after)).toBeLessThan(1.5 * pace + 2);
    }
  };
  const byWalk = [...everyone].sort((a, b) => leftS.get(a)! - leftS.get(b)!);
  await passEntrances(byWalk.filter((p) => leftS.get(p)! <= timeS));

  // Midway: the riders whose walk has left walk away from the entrances, the others are still on
  // the platform, within walking pace of the train since the stop and of an entrance by their walk.
  await seek(page, timeS);
  const fresh = await drawn();
  expect(fresh.map((w) => w.personId).sort()).toEqual(everyone);
  for (const w of fresh) {
    const walkS = leftS.get(w.personId)!;
    if (walkS > timeS) {
      expect(w.id).toBeGreaterThanOrEqual(TRANSIT_RIDER_ID);
      expect(toTrain(w)).toBeLessThanOrEqual((timeS - arrival.arrivalS) * pace + 2);
      expect(toEntrance(w)).toBeLessThanOrEqual((walkS - timeS) * pace + 2);
    } else {
      expect(w.id).toBeLessThan(TRANSIT_RIDER_ID);
      expect(toEntrance(w)).toBeLessThanOrEqual((timeS - walkS) * pace + 5);
      expect(distance(arrival.middle, w)).toBeGreaterThan(20);
    }
  }
  const platform = fresh.filter((w) => w.id >= TRANSIT_RIDER_ID);
  expect(platform.length).toBeGreaterThan(0);
  expect(platform.length).toBeLessThan(fresh.length);
  const near = (d: Vec2) => fresh.filter((w) => distance(d, w) < 60).length;
  const door = doors.reduce((best, d) => (near(d) > near(best) ? d : best));
  const group = fresh.filter((w) => distance(door, w) < 60);
  const focus = {
    x: (door.x + group.reduce((n, w) => n + w.x, 0) / group.length) / 2,
    y: (door.y + group.reduce((n, w) => n + w.y, 0) / group.length) / 2,
  };
  const map = page.getByLabel('City map', { exact: true });
  await centre2D(page, focus, 20);
  await shot(map, info, 'riders-leaving-2d.png');

  const rider = fresh
    .filter((w) => w.id < TRANSIT_RIDER_ID)
    .sort((a, b) => distance(door, a) - distance(door, b))[0]!;
  const at = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), {
    x: rider.x,
    y: rider.y,
  });
  await map.click({ position: at });
  const details = page.getByLabel('Person details', { exact: true });
  await expect(page.getByRole('heading', { name: /^Person rider:p:1484:/ })).toBeVisible();
  const clock = new Date(Math.round(arrival.arrivalS) * 1000).toISOString().slice(11, 16);
  await expect(details).toContainText(`By train at Donnersbergerbrücke ${clock}`);
  await expect(details).toContainText(/Work/);
  await expect(details).toContainText('To Donnersbergerbrücke at');
  await expect(page.getByRole('table', { name: 'Journey legs', exact: true })).toContainText(
    'Walk',
  );
  await shot(page, info, 'rider-inspector-2d.png');
  // A rider still crossing the platform opens the same person inspector.
  const crossing = platform.sort((a, b) => toEntrance(b) - toEntrance(a))[0]!;
  await centre2D(page, crossing, 20);
  await map.click({
    position: await page.evaluate((p) => window.cityflows!.worldToScreen!(p), {
      x: crossing.x,
      y: crossing.y,
    }),
  });
  await expect(
    page.getByRole('heading', { name: `Person ${crossing.personId}`, exact: true }),
  ).toBeVisible();
  await expect(details).toContainText(`By train at Donnersbergerbrücke ${clock}`);
  await shot(page, info, 'rider-on-platform-2d.png');

  await button(page, '3D').click();
  const canvas = page.getByLabel('3D city view', { exact: true });
  await expect(canvas).toHaveAttribute('data-view', '3d');
  await expect(canvas).not.toHaveAttribute('data-walkers', '0');
  const frames = Number(await canvas.getAttribute('data-frames'));
  await page.evaluate((point) => window.cityflows!.setView3D!(point, 16, 50, 0), focus);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-frames')))
    .toBeGreaterThan(frames);
  await expect(page.getByRole('heading', { name: /^Person rider:p:1484:/ })).toBeVisible();
  await shot(page, info, 'rider-inspector-3d.png');
  await button(page, 'Close inspector').click();
  await shot(canvas, info, 'riders-leaving-3d.png');
  await passEntrances(byWalk.filter((p) => leftS.get(p)! > timeS));
  expect(errors).toEqual([]);
});

test('T65 a returning rider walks back to the station and boards there', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors = pageErrors(page);
  const { city: source, station } = railStation();
  source.name = 'Rail station';
  const scenario = defaultScenario('station');
  scenario.startS = 11 * 3600;
  scenario.endS = 15 * 3600;
  // Riders only: no residents, through traffic or station events.
  scenario.demand.personsPerResident = 1;
  scenario.demand.throughTripsPerHour = scenario.demand.throughTripsPerHour.map(() => 0);
  for (const place of Object.values(source.places)) place.events = [];
  const back = stationRiders(source, scenario)
    .trips.filter((t) => t.id.endsWith(':back'))
    .sort((a, b) => a.departS - b.departS)[0]!;
  const { manifest } = JSON.parse(
    await readFile('fixtures/projects/grid5x5.cityflows.json', 'utf8'),
  );
  const project = { city: source, scenarios: [scenario], population: [] };
  manifest.name = source.name;
  manifest.schemaVersion = source.schemaVersion;
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
    name: 'rail-station.cityflows.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ manifest, ...project })),
  });
  await expect(page.getByRole('heading', { name: 'Rail station', exact: true })).toBeVisible();
  await seek(page, back.departS + 5);
  const walker = (await riderWalkers(page)).find((w) => w.personId === back.personId)!;
  expect(walker).toBeDefined();
  const at = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), {
    x: walker.x,
    y: walker.y,
  });
  await page.getByLabel('City map', { exact: true }).click({ position: at });
  const details = page.getByLabel('Person details', { exact: true });
  await expect(page.getByRole('heading', { name: `Person ${back.personId}` })).toBeVisible();
  await expect(details).toContainText('By train at Station');
  // The walk back ends at the station's entrance: the trip completes there and the rider boards.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.cityflows!.step(600));
        const person = await page.evaluate(
          (id) => window.cityflows!.inspectPerson!(id),
          back.personId!,
        );
        return person?.trips.at(-1)?.state;
      },
      { timeout: 120_000 },
    )
    .toBe('completed');
  const person = (await page.evaluate(
    (id) => window.cityflows!.inspectPerson!(id),
    back.personId!,
  ))!;
  expect(person.trips.at(-1)!.destinationPlaceId).toBe(station.id);
  await expect(details).toContainText(', boarded');
  await expect(page.getByText(/Shops → Station|Offices → Station/)).toBeVisible();
  await shot(page, info, 'rider-boarded-2d.png');
  expect(errors).toEqual([]);
});
