import { expect, test } from '@playwright/test';
import { button, metrics, pageErrors } from './helpers';

// TASK-181: after Play the dev build's `.app` scrolled 32 px sideways at 1280 px and shifted the
// whole window left. A hidden tooltip still counts toward the scrollable overflow, and the 3D
// button's, centred under it, ran past the right edge. The window never scrolls horizontally.
for (const width of [1280, 1024, 900]) {
  test(`the window does not scroll sideways after Play at ${width} px`, async ({ page }) => {
    const errors = pageErrors(page);
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await expect(button(page, 'Play')).toBeEnabled();
    await button(page, 'Play').click();
    await expect.poll(async () => (await metrics(page)).trips.driving).toBeGreaterThan(0);

    const sideways = () =>
      page.evaluate(() =>
        [document.documentElement, document.body, document.querySelector('.app')!].map(
          (element) => ({
            name: element.className || element.tagName,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            scrollLeft: element.scrollLeft,
          }),
        ),
      );
    for (const state of await sideways()) {
      expect(state.scrollWidth, `${state.name} scrollWidth`).toBe(state.clientWidth);
      expect(state.scrollLeft, `${state.name} scrollLeft`).toBe(0);
    }

    // A tooltip shown at the right edge stays inside the window too.
    const view = page.getByRole('button', { name: /^(3D|2D)$/ });
    if (await view.isVisible()) {
      await view.hover();
      const tooltip = page.getByRole('tooltip').filter({ hasText: 'Switch between 2D and 3D' });
      await expect(tooltip).toBeVisible();
      const box = (await tooltip.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    for (const state of await sideways()) expect(state.scrollWidth).toBe(state.clientWidth);
    expect(errors).toEqual([]);
  });
}
