import { expect, test, type Page } from '@playwright/test';
import {
  button,
  clickVehicle,
  closeSidebarOverlay,
  departVehicle,
  driveEveryone,
  metrics,
  pageErrors,
} from './helpers';

// TASK-196: the map keeps a selection in view above the phone inspector sheet.
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  reducedMotion: 'no-preference',
});

// The 5 x 5 grid spans 0 to 480 m. Its bottom street sits under a half-height sheet when the
// city is fitted; its top street stays above it.
const lower = { x: 300, y: 480 };
const upper = { x: 60, y: 0 };

const sheet = (page: Page) => page.locator('#inspector-column');
const heading = (page: Page) =>
  page.getByRole('complementary', { name: 'Inspector' }).getByRole('heading', { name: /^Street / });

/** Where the selection's anchor shows, the map area above the sheet, and the map's scale. */
async function view(page: Page) {
  return page.evaluate(() => {
    const api = window.cityflows!;
    const anchor = api.selectionAnchor!();
    const map = document.querySelector('.map-view')!.getBoundingClientRect();
    const column = document.querySelector('#inspector-column')?.getBoundingClientRect();
    const a = api.worldToScreen!({ x: 0, y: 0 });
    const b = api.worldToScreen!({ x: 100, y: 0 });
    return {
      anchor: anchor && api.worldToScreen!(anchor),
      width: map.width,
      above: column ? column.top - map.top : map.height,
      scale: b.x - a.x,
    };
  });
}

/** Where a world point shows now. */
const at = (page: Page, point: { x: number; y: number }) =>
  page.evaluate((p) => window.cityflows!.worldToScreen!(p), point);

/** The same place, give or take float noise (a pixel's thousandth). */
function expectSame(now: { x: number; y: number }[], before: { x: number; y: number }[]) {
  now.forEach((p, i) => {
    expect(p.x).toBeCloseTo(before[i]!.x, 3);
    expect(p.y).toBeCloseTo(before[i]!.y, 3);
  });
}

/** Clicks a street, in 2D or 3D, until its heading shows (a map still fitting takes it as ground). */
async function select(page: Page, point: { x: number; y: number }, map = 'City map') {
  await expect(async () => {
    await page.getByLabel(map).click({ position: await at(page, point) });
    await expect(heading(page)).toBeVisible({ timeout: 2000 });
  }).toPass();
}

async function to3D(page: Page) {
  await page.keyboard.press('v');
  const map3D = page.locator('canvas[data-view="3d"]');
  await expect.poll(() => map3D.getAttribute('data-meshes').then(Number)).toBeGreaterThan(0);
}

/** The anchor sits in the middle of the map area above the sheet. */
async function expectCentred(page: Page) {
  await expect
    .poll(async () => {
      const { anchor, width, above } = await view(page);
      return anchor && [anchor.x - width / 2, anchor.y - above / 2].map((d) => Math.abs(d) < 2);
    })
    .toEqual([true, true]);
}

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
});

test('QA phone brings a street from under the sheet into the middle above it', async ({ page }) => {
  const errors = pageErrors(page);
  const before = await view(page);
  // Under the half-height sheet before it opens.
  expect((await at(page, lower)).y).toBeGreaterThan(before.above / 2);
  await select(page, lower);
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'half');
  await expectCentred(page);
  // A pan, not a zoom.
  expect((await view(page)).scale).toBeCloseTo(before.scale, 5);

  // Dragging the sheet to full and back keeps the anchor in view.
  await button(page, 'Expand inspector').click();
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'full');
  await expect
    .poll(async () => {
      const { anchor, above } = await view(page);
      return anchor!.y >= 0 && anchor!.y <= above;
    })
    .toBe(true);
  await button(page, 'Shrink inspector').click();
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'half');
  await expect
    .poll(async () => {
      const { anchor, above } = await view(page);
      return anchor!.y >= 0 && anchor!.y <= above;
    })
    .toBe(true);
  expect((await view(page)).scale).toBeCloseTo(before.scale, 5);
  expect(errors).toEqual([]);
});

test('QA phone leaves the camera alone for a street already above the sheet', async ({ page }) => {
  const errors = pageErrors(page);
  const before = await Promise.all([at(page, upper), at(page, lower)]);
  await select(page, upper);
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'half');
  const { anchor, above } = await view(page);
  expect(anchor!.y).toBeLessThan(above);
  await page.waitForTimeout(800);
  expectSame(await Promise.all([at(page, upper), at(page, lower)]), before);
  expect(errors).toEqual([]);
});

test('QA phone brings a street into view in 3D too', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = pageErrors(page);
  await to3D(page);
  const height = (await view(page)).above;
  expect((await at(page, lower)).y).toBeGreaterThan(height / 2);
  await select(page, lower, '3D city view');
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'half');
  await expectCentred(page);
  const zoom = (await page.evaluate(() => window.cityflows!.view3D!()))!.zoom;
  await button(page, 'Close inspector').click();
  await expect(sheet(page)).toBeHidden();

  // Back to a view with the upper street in plain sight: the camera stays put.
  await page.evaluate(() => window.cityflows!.setView3D!({ x: 240, y: 240 }, 0.5));
  const before = await at(page, upper);
  await select(page, upper, '3D city view');
  await page.waitForTimeout(800);
  expectSame([await at(page, upper)], [before]);
  expect((await page.evaluate(() => window.cityflows!.view3D!()))!.zoom).toBeCloseTo(zoom, 5);
  expect(errors).toEqual([]);
});

test('QA phone keeps a selected car above the sheet', async ({ page }) => {
  const errors = pageErrors(page);
  await driveEveryone(page);
  await closeSidebarOverlay(page);
  await button(page, 'Play').click();
  await expect.poll(async () => (await metrics(page)).trips.driving).toBeGreaterThan(0);
  await button(page, 'Pause').click();
  await departVehicle(page, 1);
  await clickVehicle(page, 1);
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'half');
  await expect
    .poll(async () => {
      const { anchor, above } = await view(page);
      return anchor !== null && anchor.y >= 0 && anchor.y <= above;
    })
    .toBe(true);
  expect(errors).toEqual([]);
});

/** The distinct places `point` shows at, frame by frame, while `act` selects and for a second after. */
async function sampleFrames(page: Page, point: { x: number; y: number }, act: () => Promise<void>) {
  await page.evaluate((p) => {
    const w = window as unknown as { sampled: Set<number>; sampling: boolean };
    w.sampled = new Set();
    w.sampling = true;
    const tick = () => {
      w.sampled.add(Math.round(window.cityflows!.worldToScreen!(p).y * 2) / 2);
      if (w.sampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, point);
  await act();
  await page.waitForTimeout(1000);
  return page.evaluate(() => {
    const w = window as unknown as { sampled: Set<number>; sampling: boolean };
    w.sampling = false;
    return [...w.sampled];
  });
}

test('QA phone eases the pan', async ({ page }) => {
  const ys = await sampleFrames(page, lower, () => select(page, lower));
  expect(ys.length).toBeGreaterThan(3);
  await expectCentred(page);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('QA phone jumps the pan', async ({ page }) => {
    // Where it was, then where it ends up (give or take a pixel the sheet settles by), and
    // nothing between.
    const [, ...after] = await sampleFrames(page, lower, () => select(page, lower));
    expect(Math.max(...after) - Math.min(...after)).toBeLessThanOrEqual(1);
    await expectCentred(page);
  });
});

test.describe('tablet width', () => {
  test.use({ viewport: { width: 768, height: 1024 }, isMobile: false, hasTouch: false });

  /** The world point at the middle of the map. */
  const centre = (page: Page, mode: '2d' | '3d') =>
    page.evaluate((mode) => {
      const api = window.cityflows!;
      if (mode === '3d') return api.view3D!()!.centre;
      const a = api.worldToScreen!({ x: 0, y: 0 });
      const b = api.worldToScreen!({ x: 100, y: 0 });
      const map = document.querySelector('.map-view')!.getBoundingClientRect();
      const scale = (b.x - a.x) / 100;
      return { x: (map.width / 2 - a.x) / scale, y: (map.height / 2 - a.y) / scale };
    }, mode);

  for (const mode of ['2d', '3d'] as const) {
    test(`QA tablet does not move the ${mode} camera on selection`, async ({ page }) => {
      test.setTimeout(120_000);
      if (mode === '3d') await to3D(page);
      const map = mode === '3d' ? '3D city view' : 'City map';
      const before = await centre(page, mode);
      await select(page, lower, map);
      await expect(page.locator('#inspector-column')).toBeVisible();
      await page.waitForTimeout(800);
      expectSame([await centre(page, mode)], [before]);
    });
  }
});
