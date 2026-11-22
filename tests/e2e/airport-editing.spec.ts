import { expect, test, type Page } from '@playwright/test';
import type { Vec2 } from '../../src/geo/vec2';
import { button, city, clickWorld, pageErrors } from './helpers';

// TASK-305: airport editing in the app. Structure only; screenshots are evidence.

test.use({ viewport: { width: 1440, height: 900 } });

/** Zooms the 2D map in on a point by the wheel. */
async function zoomTo(page: Page, point: Vec2, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    const at = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), point);
    const box = (await page.getByLabel('City map').boundingBox())!;
    await page.mouse.move(box.x + at.x, box.y + at.y);
    await page.mouse.wheel(0, -300);
  }
  await page.waitForTimeout(500);
}

test('London City: a remote stand added with the Airside tool takes an arrival after a restart', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  const errors = pageErrors(page);
  await page.goto('/?city=london-city-airport');
  await expect(button(page, 'Play')).toBeEnabled({ timeout: 120_000 });
  const before = Object.keys((await city(page)).airport!.stands);
  const pos = { x: 146, y: 19 };
  await zoomTo(page, pos, 4);

  await button(page, 'Airside').click();
  const options = page.getByLabel('Airside options');
  await expect(options.getByRole('button', { name: 'Stand' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(options.getByLabel('Kind')).toHaveValue('remote');
  await clickWorld(page, pos);
  await expect.poll(async () => Object.keys((await city(page)).airport!.stands).length).toBe(20);
  const airport = (await city(page)).airport!;
  const id = Object.keys(airport.stands).find((s) => !before.includes(s))!;
  const stand = airport.stands[id]!;
  // Ref 29 follows 28; its lead-in joins the apron taxiway; its code is derived by rule.
  expect(stand).toMatchObject({ ref: '29', kind: 'remote', gate: null });
  expect(stand.provenance.inferred).toContain('maxCode');
  expect(airport.edges[stand.leadIn[0]!]).toMatchObject({ kind: 'lead_in', stand: id });
  await expect(page.getByText('Restart to apply changes')).toBeVisible();

  await button(page, 'Select').click();
  await clickWorld(page, stand.pos);
  const inspector = page.getByRole('region', { name: 'Stand inspector' });
  await expect(inspector.getByRole('heading', { name: 'Stand 29' })).toBeVisible();
  await expect(inspector.getByLabel('Code limit')).toHaveValue('rule');
  // A code B limit puts it first among the remote stands for the business jets.
  await inspector.getByLabel('Code limit').selectOption('B');
  await expect.poll(async () => (await city(page)).airport!.stands[id]!.maxCode).toBe('B');
  await page.screenshot({ path: info.outputPath('lcy-stand-added.png') });

  await button(page, 'Restart').click();
  await expect(button(page, 'Step')).toBeEnabled();
  let used: { timeS: number; typeId: string; registration: string } | null = null;
  for (let minute = 0; minute < 120 && !used; minute++) {
    await page.evaluate(() => window.cityflows!.step(600));
    used = await page.evaluate(async (stand) => {
      const snapshot = await window.cityflows!.snapshot!();
      const pose = snapshot.aircraft?.find((p) => p.stand === stand && p.state === 'parked');
      return pose
        ? { timeS: snapshot.timeS, typeId: pose.typeId, registration: pose.registration }
        : null;
    }, id);
  }
  expect(used, 'an aircraft parks at the new stand within two hours').not.toBeNull();
  console.info({ used });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('table', { name: 'Arrivals' })).toContainText('29');
  // The parked aircraft is picked over its stand: its inspector names the stand.
  await clickWorld(page, stand.pos);
  const aircraft = page.getByRole('region', { name: 'Aircraft inspector' });
  await expect(aircraft.getByRole('heading', { name: used!.registration })).toBeVisible();
  await expect(aircraft).toContainText('29');
  await page.screenshot({ path: info.outputPath('lcy-stand-in-use.png') });
  expect(errors).toEqual([]);
});

test('synthetic airport: draw a taxilane, add a hold, split, delete and undo with the Airside tool', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const errors = pageErrors(page);
  await page.goto('/?city=syntheticAirport');
  await expect(button(page, 'Play')).toBeEnabled();
  const start = (await city(page)).airport!;
  await zoomTo(page, { x: 640, y: 360 }, 3);

  // A taxilane from taxiway C at x = 640 to a free end on the remote apron.
  await button(page, 'Airside').click();
  const options = page.getByLabel('Airside options');
  await options.getByRole('button', { name: 'Taxilane' }).click();
  await clickWorld(page, { x: 640, y: 320 });
  await clickWorld(page, { x: 600, y: 400 });
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => Object.keys((await city(page)).airport!.edges).length)
    .toBe(Object.keys(start.edges).length + 2);
  const drawn = (await city(page)).airport!;
  const lane = Object.values(drawn.edges).find((e) => !start.edges[e.id] && e.kind === 'taxilane')!;
  expect(lane.line.at(-1)!.x).toBeCloseTo(600, 0);
  expect(lane.line.at(-1)!.y).toBeCloseTo(400, 0);
  expect(lane.provenance.inferred).toEqual(['widthM', 'maxCode']);

  // A holding position on it.
  await options.getByRole('button', { name: 'Hold' }).click();
  await clickWorld(page, { x: 620, y: 360 });
  await expect
    .poll(async () => Object.keys((await city(page)).airport!.holdingPositions).length)
    .toBe(Object.keys(start.holdingPositions).length + 1);
  await page.screenshot({ path: info.outputPath('synthetic-taxilane-hold.png') });

  // Select the taxilane's far half, split it there, then delete the piece.
  await button(page, 'Select').click();
  await clickWorld(page, { x: 607, y: 386 });
  const taxiway = page.getByRole('region', { name: 'Taxiway inspector' });
  await expect(taxiway.getByRole('heading', { name: /Taxilane/ })).toBeVisible();
  await taxiway.getByLabel('Width (m)').fill('12');
  await taxiway.getByLabel('Width (m)').press('Enter');
  // The hold split the taxilane: the far piece, from the hold, is the one selected.
  const piece = async () =>
    Object.values((await city(page)).airport!.edges).find(
      (e) => e.kind === 'taxilane' && e.line[0]!.y > 350,
    );
  await expect.poll(async () => (await piece())?.widthM).toBe(12);
  expect((await piece())!.maxCode).toBe('B');
  const edges = Object.keys((await city(page)).airport!.edges).length;
  await taxiway.getByRole('button', { name: 'Split here' }).click();
  await expect
    .poll(async () => Object.keys((await city(page)).airport!.edges).length)
    .toBe(edges + 1);
  await clickWorld(page, { x: 603, y: 394 });
  await taxiway.getByRole('button', { name: 'Delete taxilane' }).click();
  await expect.poll(async () => Object.keys((await city(page)).airport!.edges).length).toBe(edges);
  await button(page, 'Undo').click();
  await expect
    .poll(async () => Object.keys((await city(page)).airport!.edges).length)
    .toBe(edges + 1);
  await page.screenshot({ path: info.outputPath('synthetic-split.png') });
  expect(errors).toEqual([]);
});
