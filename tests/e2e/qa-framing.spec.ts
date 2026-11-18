import { expect, test, type Page } from '@playwright/test';
import { lonLatToLocal } from '../../src/geo/projection';
import type { Vec2 } from '../../src/geo/vec2';
import { button, pageErrors } from './helpers';

// TASK-203: opening a city and Fit city frame its boundary in the part of the map the sidebar,
// inspector and phone sheet leave visible, in 2D and 3D; a showcase camera keeps its pitch and
// bearing with its centre in the middle of that part; panels opening and closing leave the city
// where it shows.

test.use({ reducedMotion: 'reduce' });
if (process.platform === 'win32')
  test.use({
    launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] },
  });

/** Freiburg's boundary ring, in metres. */
async function boundary(page: Page) {
  const geo = await page.evaluate(() => window.cityflows!.city!().geo!);
  return geo.boundary!.map(([lon, lat]) => lonLatToLocal(geo, { lon, lat }));
}

/** The map area left visible (in map pixels: under 900 px the sidebar and inspector float over
 *  its sides, under 600 px the inspector sheet covers its lower part) and where the ring shows. */
function framing(page: Page, ring: Vec2[]) {
  return page.evaluate((ring) => {
    const map = document.querySelector('.map-view')!.getBoundingClientRect();
    const area = { left: 0, top: 0, right: map.width, bottom: map.height };
    for (const panel of document.querySelectorAll('#sidebar, #inspector-column')) {
      const box = panel.getBoundingClientRect();
      if (Math.min(box.right, map.right) - Math.max(box.left, map.left) < 1) continue;
      if (Math.min(box.bottom, map.bottom) - Math.max(box.top, map.top) < 1) continue;
      if (panel.hasAttribute('data-sheet')) area.bottom = box.top - map.top;
      else if (box.left - map.left < map.right - box.right) area.left = box.right - map.left;
      else area.right = box.left - map.left;
    }
    const shown = ring.map((p) => window.cityflows!.worldToScreen!(p));
    const xs = shown.map((p) => p.x);
    const ys = shown.map((p) => p.y);
    return {
      area,
      shown: {
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
      },
    };
  }, ring);
}

/** Every vertex of the ring inside the visible area, and in 2D reaching across it (within the
 *  margin and a few pixels) in one direction at least. */
async function expectFramed(page: Page, ring: Vec2[], fills = false) {
  await expect
    .poll(async () => {
      const { area, shown } = await framing(page, ring);
      const inside =
        shown.left >= area.left &&
        shown.top >= area.top &&
        shown.right <= area.right &&
        shown.bottom <= area.bottom;
      const across = Math.min(
        area.right - area.left - (shown.right - shown.left),
        area.bottom - area.top - (shown.bottom - shown.top),
      );
      return inside && (!fills || across <= 2 * 24 + 4);
    })
    .toBe(true);
}

/** Where a world point shows in the window. */
const inWindow = (page: Page, point: Vec2) =>
  page.evaluate((point) => {
    const map = document.querySelector('.map-view')!.getBoundingClientRect();
    const p = window.cityflows!.worldToScreen!(point);
    return { x: map.left + p.x, y: map.top + p.y };
  }, point);

async function expectStill(page: Page, point: Vec2, before: Vec2) {
  await expect
    .poll(async () => {
      const now = await inWindow(page, point);
      return Math.hypot(now.x - before.x, now.y - before.y) < 1;
    })
    .toBe(true);
}

/** Fit city, and the frame that applies it. The map frames the city in its next animation frame,
 *  so a view read straight after the key is still the one before; a view that already shows the
 *  whole city (the showcase camera) passes `expectFramed` at once and would hide that. */
async function fit(page: Page) {
  await page.keyboard.press('f');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

const view3D = (page: Page) => page.evaluate(() => window.cityflows!.view3D!()!);

async function to3D(page: Page) {
  await page.keyboard.press('v');
  await page.waitForFunction(
    () => performance.getEntriesByName('cityflows:first-frame-3d').length > 0,
    null,
    { timeout: 120_000 },
  );
  await expect
    .poll(() => page.locator('canvas[data-view="3d"]').getAttribute('data-meshes').then(Number))
    .toBeGreaterThan(0);
}

async function open(page: Page) {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Freiburg im Breisgau', exact: true }),
  ).toBeVisible();
  await expect(button(page, 'Play')).toBeEnabled();
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
]) {
  test(`QA framing Freiburg beside the panels at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const errors = pageErrors(page);
    await page.setViewportSize(viewport);
    await open(page);
    await expect(page.locator('#inspector-column')).toBeVisible();
    const ring = await boundary(page);
    const middle = {
      x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
      y: ring.reduce((sum, p) => sum + p.y, 0) / ring.length,
    };

    // 2D: on open, and on Fit city after zooming in.
    await expectFramed(page, ring, true);
    const map = (await page.getByLabel('City map', { exact: true }).boundingBox())!;
    await page.mouse.move(map.x + map.width / 3, map.y + map.height / 3);
    await page.mouse.wheel(0, -600);
    const { shown } = await framing(page, ring);
    expect(shown.right - shown.left).toBeGreaterThan(map.width);
    await fit(page);
    await expectFramed(page, ring, true);

    // The sidebar and inspector open and close without moving the city.
    for (const key of ['s', 'i']) {
      const before = await inWindow(page, middle);
      await page.keyboard.press(key);
      await expectStill(page, middle, before);
      await page.keyboard.press(key);
      await expectStill(page, middle, before);
    }

    // 3D: the showcase camera keeps its pitch and bearing, centred in the visible area.
    await to3D(page);
    const showcase = await view3D(page);
    expect(showcase.pitch).toBeCloseTo(50, 3);
    expect(showcase.bearing).toBeCloseTo(-60, 3);
    const { area } = await framing(page, ring);
    const target = await page.evaluate(
      (centre) => window.cityflows!.worldToScreen!(centre),
      showcase.centre,
    );
    expect(Math.abs(target.x - (area.left + area.right) / 2)).toBeLessThan(1);
    expect(Math.abs(target.y - (area.top + area.bottom) / 2)).toBeLessThan(1);

    // Fit city frames the boundary at the view's pitch and bearing.
    await fit(page);
    await expectFramed(page, ring);
    const fitted = await view3D(page);
    expect(fitted.pitch).toBeCloseTo(50, 3);
    expect(fitted.bearing).toBeCloseTo(-60, 3);

    const before = await inWindow(page, fitted.centre);
    await page.keyboard.press('s');
    await expectStill(page, fitted.centre, before);
    await page.keyboard.press('s');
    await expectStill(page, fitted.centre, before);

    // A city opened in 3D is framed in 3D.
    await button(page, 'New').click();
    await page
      .getByRole('dialog', { name: 'New city', exact: true })
      .getByRole('button', { name: 'Freiburg im Breisgau', exact: true })
      .click();
    await expect(button(page, 'Play')).toBeEnabled();
    await expectFramed(page, ring);
    expect(errors).toEqual([]);
  });
}

test('QA framing Freiburg between the floating sidebar and inspector at 800 px', async ({
  page,
}) => {
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 800, height: 700 });
  await open(page);
  const ring = await boundary(page);
  await page.keyboard.press('s');
  await expect(page.locator('#sidebar')).toBeVisible();
  await fit(page);
  await expectFramed(page, ring, true);
  const map = page.getByLabel('City map', { exact: true });
  await expect(async () => {
    await map.click({ position: { x: 400 + 200 * Math.random(), y: 300 } });
    await expect(page.locator('#inspector-column .inspector')).toBeVisible({ timeout: 2000 });
  }).toPass();
  await fit(page);
  const { area } = await framing(page, ring);
  expect(area.left).toBeGreaterThan(200);
  expect(area.right).toBeLessThan(600);
  await expectFramed(page, ring, true);
  expect(errors).toEqual([]);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const mode of ['2d', '3d'] as const) {
    test(`QA framing Freiburg above the phone sheet in ${mode.toUpperCase()}`, async ({ page }) => {
      test.setTimeout(240_000);
      const errors = pageErrors(page);
      await open(page);
      const ring = await boundary(page);
      if (mode === '2d') await expectFramed(page, ring, true);
      else await to3D(page);
      // Something near the middle of the map opens the sheet.
      const map = page.getByLabel(mode === '2d' ? 'City map' : '3D city view', { exact: true });
      const box = (await map.boundingBox())!;
      const sheet = page.locator('#inspector-column');
      await expect(async () => {
        await map.click({
          position: { x: box.width * (0.3 + 0.4 * Math.random()), y: box.height * 0.4 },
        });
        await expect(sheet).toHaveAttribute('data-sheet', 'half', { timeout: 2000 });
      }).toPass();
      await fit(page);
      await expectFramed(page, ring, mode === '2d');
      const { area } = await framing(page, ring);
      expect(area.bottom).toBeLessThan(box.height * 0.6);
      expect(errors).toEqual([]);
    });
  }

  test('QA framing Freiburg above a sheet that opens in the same frame as Fit city', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const errors = pageErrors(page);
    await open(page);
    const ring = await boundary(page);
    await to3D(page);
    // A tap that opens the sheet and the Fit key in one task: the sheet has not reported its
    // height when the map next draws, and the fit waits for it. The key goes out as the pointer
    // is released, after the map has taken the tap as a selection.
    const map = page.getByLabel('3D city view', { exact: true });
    const box = (await map.boundingBox())!;
    await page.evaluate(() =>
      window.addEventListener('pointerup', () =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' })),
      ),
    );
    await expect(async () => {
      await page.mouse.move(
        box.x + box.width * (0.3 + 0.4 * Math.random()),
        box.y + box.height * 0.4,
      );
      await page.mouse.down();
      await page.mouse.up();
      await expect(page.locator('[data-sheet]')).toBeVisible({ timeout: 2000 });
    }).toPass();
    await expectFramed(page, ring);
    expect(errors).toEqual([]);
  });
});
