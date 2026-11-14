import { expect, test, type Page } from '@playwright/test';
import { button, importOsm, pageErrors } from './helpers';

// TASK-183: street, station, stop and place labels in 3D, placed when the camera settles, with the
// Labels layer toggle, legible in both appearances and every lighting preset.

const station = { x: 165.3, y: -129.9 };
const cameras = {
  street: { centre: { x: 165, y: -330 }, zoom: 5, pitch: 20, bearing: 0 },
  overview: { centre: station, zoom: 0.9, pitch: 50, bearing: 0 },
};

async function labelCounts(page: Page) {
  const canvas = page.getByLabel('3D city view', { exact: true });
  return JSON.parse((await canvas.getAttribute('data-labels')) ?? '{}') as Record<
    'street' | 'station' | 'stop' | 'place' | 'glyphs',
    number
  >;
}

/** Sets the camera and waits until the labels are placed for it and the view stops drawing. */
async function look(page: Page, camera: (typeof cameras)[keyof typeof cameras]) {
  const canvas = page.getByLabel('3D city view', { exact: true });
  const before = await canvas.getAttribute('data-labels');
  await page.evaluate(
    ({ centre, zoom, pitch, bearing }) =>
      window.cityflows!.setView3D!(centre, zoom, pitch, bearing),
    camera,
  );
  await expect.poll(() => canvas.getAttribute('data-labels')).not.toBe(before);
  await expect(async () => {
    const frames = await canvas.getAttribute('data-frames');
    await page.waitForTimeout(400);
    expect(await canvas.getAttribute('data-frames')).toBe(frames);
  }).toPass();
}

async function layers(page: Page, act: (region: ReturnType<Page['getByRole']>) => Promise<void>) {
  await button(page, 'Layers').click();
  await act(page.getByRole('region', { name: 'Map layers' }));
  await button(page, 'Layers').click();
}

test('V183 Munich 3D labels place when the camera settles, stay still and follow their layer', async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const errors = pageErrors(page);
  await page.route('https://**/*', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm', { terrain: false });
  await layers(page, async (region) => {
    for (const label of ['Basemap', 'Entrances and exits'])
      await region.getByLabel(label, { exact: true }).uncheck();
  });
  await button(page, '3D').click();
  const canvas = page.getByLabel('3D city view', { exact: true });
  await expect(canvas).toHaveAttribute('data-view', '3d');
  const shot = (name: string) => canvas.screenshot({ path: info.outputPath(`${name}.png`) });

  await look(page, cameras.overview);
  const overview = await labelCounts(page);
  expect(overview.station).toBe(1);
  expect(overview.street).toBeGreaterThan(3);
  await shot('munich-3d-overview-light-day');

  await look(page, cameras.street);
  const street = await labelCounts(page);
  expect(street.street).toBeGreaterThan(0);
  expect(street.glyphs).toBeGreaterThan(street.street);
  await shot('munich-3d-street-light-day');
  // A still camera draws nothing new: the labels do not flicker or re-place.
  await page.waitForTimeout(1000);
  expect(await labelCounts(page)).toEqual(street);

  // The Labels layer hides and shows them.
  const toggle = (region: ReturnType<Page['getByRole']>) =>
    region.getByLabel('Labels', { exact: true });
  await layers(page, (region) => toggle(region).uncheck());
  await expect.poll(async () => (await labelCounts(page)).glyphs).toBe(0);
  await shot('munich-3d-street-labels-off');
  await layers(page, (region) => toggle(region).check());
  await expect.poll(() => labelCounts(page)).toEqual(street);

  // The labels keep their inks under every preset; the dark appearance swaps them.
  const preset = (region: ReturnType<Page['getByRole']>, name: string) =>
    region.getByRole('group', { name: 'Time of day' }).getByRole('button', { name }).click();
  await layers(page, (region) => preset(region, 'Evening'));
  await expect(canvas).toHaveAttribute('data-lighting', /"mode":"evening"/);
  await shot('munich-3d-street-light-evening');
  await look(page, cameras.overview);
  await shot('munich-3d-overview-light-evening');
  await layers(page, async (region) => {
    await preset(region, 'Night');
    await region.getByLabel('Appearance').selectOption('dark');
  });
  await expect(canvas).toHaveAttribute('data-map-palette', 'dark');
  await expect(canvas).toHaveAttribute('data-lighting', /"mode":"night"/);
  await page.waitForTimeout(500);
  await shot('munich-3d-overview-dark-night');
  await layers(page, (region) => toggle(region).uncheck());
  await expect.poll(async () => (await labelCounts(page)).glyphs).toBe(0);
  await shot('munich-3d-overview-dark-night-labels-off');
  await layers(page, (region) => toggle(region).check());
  await look(page, cameras.street);
  await shot('munich-3d-street-dark-night');
  expect(errors).toEqual([]);
});
