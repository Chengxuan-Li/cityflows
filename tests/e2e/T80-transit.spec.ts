import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Vec2 } from '../../src/geo/vec2';
import { compileRail } from '../../src/network/rail';
import { stationArrivals, type TrainPose } from '../../src/network/trains';
import { railTimetable } from '../../src/network/trams';
import { TRANSIT_RIDER_ID } from '../../src/sim/transit';
import { button, city, importOsm, pageErrors } from './helpers';

type Snapshot = {
  timeS: number;
  walkers?: {
    count: number;
    id: Uint32Array;
    x: Float32Array;
    y: Float32Array;
    state: Uint8Array;
  };
  rail?: { trains: TrainPose[] };
  transit?: { vehicles: { id: string; capacity: number; riders: string[] }[] };
};

const snapshot = (page: Page) =>
  page.evaluate(async () => window.cityflows!.snapshot!()) as Promise<Snapshot>;

/** Riders on platforms, from the walker snapshot; with `moving`, only those walking on or off. */
function riders(s: Snapshot, moving = false) {
  const found: Vec2[] = [];
  for (let i = 0; i < (s.walkers?.count ?? 0); i++)
    if (s.walkers!.id[i]! >= TRANSIT_RIDER_ID && (!moving || s.walkers!.state[i] === 1))
      found.push({ x: s.walkers!.x[i]!, y: s.walkers!.y[i]! });
  return found;
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

/** Zoom out about the map's middle, drag `point` there, then zoom in about it to `zoom` px/m. */
async function centre(page: Page, point: Vec2, zoom: number) {
  const wheel = (at: Vec2 | null, pxPerM: number) =>
    page.evaluate(
      ({ at, pxPerM }) => {
        const c = document.querySelector<HTMLCanvasElement>('canvas[data-view="2d"]')!,
          r = c.getBoundingClientRect();
        const a = window.cityflows!.worldToScreen!({ x: 0, y: 0 }),
          b = window.cityflows!.worldToScreen!({ x: 1, y: 0 });
        c.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -Math.log(pxPerM / (b.x - a.x)) / 0.0015,
            clientX: r.x + (at ? at.x : r.width / 2),
            clientY: r.y + (at ? at.y : r.height / 2),
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { at, pxPerM },
    );
  const map = page.getByLabel('City map', { exact: true }),
    box = (await map.boundingBox())!;
  await wheel(null, 0.4);
  const v = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), point);
  await page.mouse.move(box.x + v.x, box.y + v.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await wheel(null, zoom);
}

async function shot(page: Page, name: string) {
  const dir = process.env.CITYFLOWS_SHOT_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name) });
}

const near = (a: Vec2, b: Vec2, m: number) => Math.hypot(a.x - b.x, a.y - b.y) < m;

// TASK-174: S-Bahn riders get off at Donnersbergerbrücke's doors and walk off the platform;
// residents who chose transit board a tram, ride it and get off; the inspectors and the mode
// shares show them.
test('T80 Munich riders get off the S-Bahn, board and leave trams, and transit counts in the mode shares', async ({
  page,
}) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(30_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (r) => r.abort());
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm', { terrain: false });
  const rail = compileRail(await city(page))!;
  const table = railTimetable(rail);
  const now = (await page.evaluate(() => window.cityflows!.metrics())).timeS;

  // An S-Bahn stopping at Donnersbergerbrücke in the morning brings riders.
  const arrival = stationArrivals(rail, table, now + 120, now + 3600).find(
    (a) => a.kind === 'sbahn',
  )!;
  await seek(page, arrival.arrivalS - 10);
  const before = await snapshot(page);
  const train = before.rail!.trains.find(
    (t) => t.kind === 'sbahn' && near(t.centre, arrival.middle, 400),
  )!;
  const aboard = before.transit!.vehicles.find((v) => v.id === train.id)!;
  expect(aboard.riders.length).toBeGreaterThan(0);
  await seek(page, arrival.arrivalS + 20);
  const after = await snapshot(page);
  const off = riders(after)
    .filter((p) => near(p, arrival.middle, 200))
    .sort(
      (a, b) =>
        Math.hypot(a.x - arrival.middle.x, a.y - arrival.middle.y) -
        Math.hypot(b.x - arrival.middle.x, b.y - arrival.middle.y),
    );
  expect(off.length).toBeGreaterThan(0);
  expect(after.transit!.vehicles.find((v) => v.id === train.id)!.riders.length).toBeLessThan(
    aboard.riders.length,
  );
  await centre(page, off[0]!, 20);
  await shot(page, '01-sbahn-alighting-2d.png');
  const map = page.getByLabel('City map', { exact: true });
  await map.click({
    position: await page.evaluate((p) => window.cityflows!.worldToScreen!(p), off[0]!),
  });
  const rider = page
    .getByRole('complementary', { name: 'Inspector' })
    .getByRole('heading', { name: /^Person rider:/ });
  await expect(rider).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText(
    'By train at Donnersbergerbrücke',
  );
  await shot(page, '02-sbahn-rider-inspector-2d.png');

  // A tram standing at a stop with riders boarding or getting off beside it.
  let found: { pose: TrainPose; rider: Vec2 } | null = null;
  for (let i = 0; !found && i < 1200; i++) {
    await page.evaluate(() => window.cityflows!.step(50));
    const s = await snapshot(page);
    for (const pose of s.rail!.trains)
      if (pose.kind === 'tram' && pose.speedMps < 0.01) {
        const beside = riders(s, true).find((p) => pose.cars.some((car) => near(p, car, 8)));
        if (beside) found = { pose, rider: beside };
      }
  }
  expect(found).toBeTruthy();
  await seek(page, (await snapshot(page)).timeS);
  await centre(page, found!.pose.centre, 16);
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await shot(page, '03-tram-boarding-2d.png');
  await map.click({
    position: await page.evaluate(
      (p) => window.cityflows!.worldToScreen!(p),
      // The car farthest from the rider, so the click picks the tram.
      found!.pose.cars.reduce((a, b) =>
        Math.hypot(a.x - found!.rider.x, a.y - found!.rider.y) >
        Math.hypot(b.x - found!.rider.x, b.y - found!.rider.y)
          ? a
          : b,
      ),
    ),
  });
  const inspector = page.getByRole('region', { name: 'Train inspector' });
  await expect(inspector).toContainText('Riders');
  await shot(page, '04-tram-inspector-2d.png');

  // On to 09:30, for the morning's shares and riders per line.
  await seek(page, 9.5 * 3600);
  await button(page, 'Chart').click();
  const shares = page
    .getByRole('region', { name: 'Traffic over time' })
    .getByRole('figure', { name: 'Mode shares' });
  await expect(shares.getByText(/^Person trips by mode/)).toContainText('transit');
  await expect(shares.getByRole('table', { name: 'Riders per line' })).toContainText('S-Bahn');
  await shares.scrollIntoViewIfNeeded();
  await shot(page, '05-mode-shares.png');
  expect(errors).toEqual([]);
});
