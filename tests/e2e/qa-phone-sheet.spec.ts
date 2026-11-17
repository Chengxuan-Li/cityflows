import { expect, test, type Page } from '@playwright/test';
import { button, clickWorld, pageErrors } from './helpers';

// TASK-189: under 600 px the inspector is a bottom sheet over the map.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const sheet = (page: Page) => page.locator('#inspector-column');
const heading = (page: Page) =>
  page.getByRole('complementary', { name: 'Inspector' }).getByRole('heading', { name: /^Street / });

async function box(page: Page, selector: string) {
  const rect = await page.locator(selector).boundingBox();
  return rect!;
}

/** The sheet's height as a share of the map area it sits in. */
async function share(page: Page) {
  const [column, map] = await Promise.all([box(page, '#inspector-column'), box(page, '.map-view')]);
  return { column, map, ratio: column.height / map.height };
}

/** Drags the grabber by `dy` in small steps, as a finger would. */
async function dragGrabber(page: Page, dy: number) {
  const grabber = await box(page, '.sheet-grabber');
  const x = grabber.x + grabber.width / 2;
  const y = grabber.y + grabber.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(x, y + (dy * step) / 10);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
}

/** Clicks the street; a map that is still fitting under load takes the click as empty ground. */
async function selectStreet(page: Page) {
  await expect(async () => {
    await clickWorld(page, { x: 60, y: 2 });
    await expect(heading(page)).toBeVisible({ timeout: 2000 });
  }).toPass();
}

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await selectStreet(page);
});

test('QA phone inspector opens as a half-height sheet with its heading', async ({ page }) => {
  const errors = pageErrors(page);
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'half');
  await expect(heading(page)).toBeInViewport({ ratio: 1 });
  await expect.poll(async () => (await share(page)).ratio).toBeCloseTo(0.5, 1);
  // The sheet starts at the bottom of the map area and leaves the upper half to the map.
  const { column, map } = await share(page);
  expect(column.y + column.height).toBeCloseTo(map.y + map.height, 0);
  expect(column.y).toBeGreaterThan(map.y + 100);
  expect(errors).toEqual([]);
});

test('QA phone sheet keeps its heading while the content scrolls', async ({ page }) => {
  await page.getByText('Lanes and street settings', { exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect
    .poll(() => inspector.evaluate((aside) => aside.scrollHeight > aside.clientHeight))
    .toBe(true);
  await inspector.evaluate((aside) => aside.scrollTo(0, aside.scrollHeight));
  await expect.poll(() => inspector.evaluate((aside) => aside.scrollTop)).toBeGreaterThan(10);
  // Scrolled, the heading still sits right under the grabber row.
  const { column } = await share(page);
  const grab = (await box(page, '.sheet-grab')).height;
  await expect
    .poll(async () => Math.abs((await heading(page).boundingBox())!.y - (column.y + grab)))
    .toBeLessThanOrEqual(2);
});

test('QA phone sheet drags to full height and back, by drag and by tap', async ({ page }) => {
  const errors = pageErrors(page);
  await dragGrabber(page, -300);
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'full');
  // Full height leaves a strip of the map above the sheet.
  await expect
    .poll(async () => {
      const { column, map } = await share(page);
      return Math.round(column.y - map.y);
    })
    .toBe(44);
  await expect(heading(page)).toBeInViewport({ ratio: 1 });

  await dragGrabber(page, 300);
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'half');
  await expect.poll(async () => (await share(page)).ratio).toBeCloseTo(0.5, 1);

  await button(page, 'Expand inspector').click();
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'full');
  await button(page, 'Shrink inspector').press('ArrowDown');
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'half');
  await button(page, 'Expand inspector').press('ArrowUp');
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'full');
  expect(errors).toEqual([]);
});

test('QA phone sheet closes by swipe, by Escape and by its button, and reopens at half', async ({
  page,
}) => {
  await dragGrabber(page, 400);
  await expect(sheet(page)).toBeHidden();

  await selectStreet(page);
  await button(page, 'Expand inspector').click();
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'full');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();

  // A new selection opens at half height again.
  await selectStreet(page);
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'half');
  await button(page, 'Close inspector').click();
  await expect(sheet(page)).toBeHidden();
});

test('QA phone map still pans above the open sheet', async ({ page }) => {
  const errors = pageErrors(page);
  const centre = { x: 240, y: 240 };
  const before = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), centre);
  const map = await box(page, '.map-view');
  const { column } = await share(page);
  // Empty canvas between the toolbar and the sheet.
  const x = map.x + map.width / 2;
  const y = (map.y + column.y) / 2;
  expect(y).toBeLessThan(column.y - 40);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 60, y + 40, { steps: 8 });
  await page.mouse.up();
  // The map follows the drag (and glides a little past it).
  await expect
    .poll(async () => {
      const after = await page.evaluate((p) => window.cityflows!.worldToScreen!(p), centre);
      return after.x - before.x <= -60 && after.y - before.y >= 40;
    })
    .toBe(true);
  await expect(sheet(page)).toHaveAttribute('data-sheet', 'half');
  await expect(heading(page)).toBeVisible();
  expect(errors).toEqual([]);
});
