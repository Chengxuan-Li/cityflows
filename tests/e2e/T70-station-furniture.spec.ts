import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { button, city, importOsm, pageErrors } from './helpers';
import { compile } from '../../src/network';
import { trainTimetable } from '../../src/network/trains';
import { departureDisplay, placeStationFurniture } from '../../src/render/station-furniture';
import type { Vec2 } from '../../src/geo/vec2';

test.use({
  trace: {
    mode: 'retain-on-failure',
    screenshots: false,
    snapshots: { dom: true, aria: true, screen: false },
  },
});

/** Saves a shot with the test output and, when CITYFLOWS_SHOT_DIR is set, into that folder. */
async function shot(canvas: Locator, info: TestInfo, name: string) {
  await canvas.screenshot({ path: info.outputPath(name) });
  const dir = process.env.CITYFLOWS_SHOT_DIR;
  if (dir) {
    await mkdir(dir, { recursive: true });
    await canvas.screenshot({ path: join(dir, name) });
  }
}

async function centre(
  page: Page,
  point: Vec2,
  view: '2d' | '3d',
  zoom: number,
  pitch = 40,
  bearing = 0,
) {
  if (view === '3d') {
    const canvas = page.getByLabel('3D city view', { exact: true });
    await expect(canvas).toHaveAttribute('data-view', '3d');
    const frames = Number(await canvas.getAttribute('data-frames'));
    await page.evaluate(
      ({ point, zoom, pitch, bearing }) =>
        window.cityflows!.setView3D!(point, zoom, pitch, bearing),
      { point, zoom, pitch, bearing },
    );
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-frames')))
      .toBeGreaterThan(frames);
    return;
  }
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
      // Zoom out about the canvas centre first, so the target is on screen at any start zoom.
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
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
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

const displays = async (canvas: Locator) =>
  JSON.parse((await canvas.getAttribute('data-station-displays')) ?? '[]') as string[];
const counts = async (canvas: Locator) =>
  JSON.parse((await canvas.getAttribute('data-station-furniture'))!) as Record<string, number>;

test('T70 Donnersbergerbrücke furniture in 2D and 3D: displays follow the clock, the Rail layer hides it, shots', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm', { terrain: false });
  const source = await city(page),
    compiled = compile(source);
  if (!compiled.ok) throw Error('compile');
  const furniture = placeStationFurniture(compiled.compiled, source);
  const [west, east] = furniture.platforms;
  expect(furniture.platforms.map((p) => p.platform)).toEqual(['rp:10736', 'rp:10737']);
  const both = {
    x: (west!.display!.x + east!.display!.x) / 2 + 10,
    y: (west!.display!.y + east!.display!.y) / 2,
  };
  const board = west!.boards.find((b) => b.x < 200 && b.x > 170)!;
  await button(page, 'Layers').click();
  const layers = page.getByRole('region', { name: 'Map layers' }),
    toggle = layers.getByLabel('Rail', { exact: true });
  for (const label of ['Basemap', 'Entrances and exits'])
    await layers.getByLabel(label, { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  const start = 7 * 3600;
  await seek(page, start);
  const rows = (platform: string, dir: string, minutes: (string | number)[]) =>
    `${platform}\n${minutes
      .map((m) => `S-Bahn ${dir}  ${(typeof m === 'number' ? `${m} min` : m).padStart(6)}`)
      .join('\n')}`;

  for (const view of ['2d', '3d'] as const) {
    if (view === '3d') await button(page, '3D').click();
    const canvas = page.getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true });
    if (view === '3d') {
      await button(page, 'Restart').click();
      await seek(page, start);
    }
    await expect(canvas).toHaveAttribute('data-station-furniture', /"displays":2/);
    expect(await counts(canvas)).toEqual({
      boards: 12,
      shelters: furniture.platforms.reduce((n, p) => n + p.shelters.length, 0),
      benches: furniture.platforms.reduce((n, p) => n + p.benches.length, 0),
      bins: furniture.platforms.reduce((n, p) => n + p.bins.length, 0),
      displays: 2,
      entrances: 3,
    });
    // 07:00: the next three departures per platform from TASK-127's timetable.
    await centre(page, both, view, view === '2d' ? 30 : 36);
    await expect
      .poll(() => displays(canvas))
      .toEqual([rows('Platform 1/2', 'W', [3, 7, 11]), rows('Platform 3/4', 'E', [4, 8, 12])]);
    if (view === '2d') {
      // Text only for what is in view, at most 24 labels.
      const labels = Number(await canvas.getAttribute('data-station-labels'));
      expect(labels).toBeGreaterThan(0);
      expect(labels).toBeLessThanOrEqual(24);
    }
    await shot(canvas, info, `donnersberger-displays-0700-${view}.png`);
    if (view === '3d') {
      await centre(page, { x: board.x + 3, y: board.y }, '3d', 36, 18, 150);
      await shot(canvas, info, 'shelter-and-board-3d.png');
      await centre(page, { x: 175, y: -131 }, '3d', 7, 40, 0);
      await shot(canvas, info, 'donnersberger-platforms-0700-3d.png');
    } else {
      await centre(page, { x: 110, y: -131 }, '2d', 9);
      await shot(canvas, info, 'donnersberger-platforms-0700-2d.png');
      await centre(page, east!.boards[0]!, '2d', 3);
      expect(Number(await canvas.getAttribute('data-station-labels'))).toBe(0);
      await centre(page, both, '2d', 30);
    }
    // The clock runs: the rows follow the timetable (3D repaints on 30 s buckets), a standing
    // train reads "now", and a train that has left drops off the list.
    const table = trainTimetable(compiled.compiled.rail!);
    const expectAt = async (offset: number) => {
      await seek(page, start + offset);
      const t = await page.evaluate(async () => (await window.cityflows!.metrics()).timeS);
      const at = view === '3d' ? Math.floor(t / 30) * 30 : t;
      const text = (platform: string) => {
        const { header, rows } = departureDisplay(compiled.compiled.rail!, table, platform, at);
        return [header, ...rows].join('\n');
      };
      const expected = [text('rp:10736'), text('rp:10737')];
      await expect.poll(() => displays(canvas)).toEqual(expected);
      return expected;
    };
    const first = await expectAt(0);
    const second = await expectAt(120);
    expect(second).not.toEqual(first);
    expect(second[0]).toContain('now');
    const third = await expectAt(300);
    expect(third[0]).toContain('2 min');
    expect(third[0]).not.toContain('now');
    if (view === '3d') {
      // Repaints follow the 30 s buckets, not the frames: at most one per display per bucket.
      const draws = Number(await canvas.getAttribute('data-station-display-draws'));
      expect(draws).toBeLessThanOrEqual(2 * 12);
    }
    // An entrance sign: the generic station symbol and the name, outside the door.
    if (view === '2d') {
      await centre(page, furniture.entrances.at(-1)!, view, 22);
      await shot(canvas, info, 'entrance-sign-2d.png');
    }
    // The Rail layer carries the furniture.
    const hash = await page.evaluate(() => window.cityflows!.hash());
    await button(page, 'Layers').click();
    await toggle.uncheck();
    await page.keyboard.press('Escape');
    await expect(canvas).toHaveAttribute('data-rail-tracks', '0');
    expect((await counts(canvas)).boards).toBe(0);
    expect(await displays(canvas)).toEqual([]);
    await button(page, 'Layers').click();
    await toggle.check();
    await page.keyboard.press('Escape');
    await expect(canvas).toHaveAttribute('data-station-furniture', /"displays":2/);
    // Furniture is visual only: the run's state hash does not move.
    expect(await page.evaluate(() => window.cityflows!.hash())).toBe(hash);
  }
  expect(await city(page)).toEqual(source);
  expect(errors).toEqual([]);
});
