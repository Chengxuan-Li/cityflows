import { expect, test } from '@playwright/test';
import { button, pageErrors } from './helpers';

// TASK-301: on the synthetic airport at night, the 3D view lights the runway end in use, a stop
// bar at every runway holding position and the taxiways; an aircraft picked in 3D can be
// followed by the camera. Structure only, never pixels.
test('V301 airfield lights follow the sim and the camera follows an aircraft', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = pageErrors(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'cityflows.lighting',
      JSON.stringify({ mode: 'night', exposure: 1, season: 'equinox' }),
    ),
  );
  await page.goto('/?city=syntheticAirport');
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, '3D').click();
  const view = page.getByLabel('3D city view', { exact: true });
  await expect(view).toHaveAttribute('data-airfield-lights', /"on":true/);
  const lights = JSON.parse((await view.getAttribute('data-airfield-lights'))!) as Record<
    string,
    number
  >;
  // One 45 m runway, 27 in use: 16 green threshold lights, 8 red end lights at 09, the 900 m
  // approach lights and four PAPI units; four runway holds with 8-light stop bars.
  expect(lights).toMatchObject({
    threshold: 16,
    'runway-end': 8,
    approach: 98,
    papi: 4,
    'stop-bar': 32,
    'apron-flood': 9,
  });
  expect(lights['taxiway-centreline']).toBeGreaterThan(0);

  await page.evaluate(() => window.cityflows!.step(1200));
  await expect(view).not.toHaveAttribute('data-aircraft', '0');
  const id = await page.evaluate(
    async () => (await window.cityflows!.snapshot!()).aircraft![0]!.id,
  );
  const at = (await page.evaluate((i) => window.cityflows!.aircraftToScreen!(i), id))!;
  const box = (await view.boundingBox())!;
  await page.mouse.click(box.x + at.x, box.y + at.y);
  const inspector = page.getByRole('region', { name: 'Aircraft inspector' });
  await expect(inspector).toBeVisible();
  await inspector.getByRole('switch', { name: 'Follow with camera' }).check();
  await expect(view).toHaveAttribute('data-follow', String(id));
  await page.keyboard.press('Escape');
  await expect(view).toHaveAttribute('data-follow', '');
  expect(errors).toEqual([]);
});
