import { expect, test } from '@playwright/test';

test('imports the downtown fixture and generates traffic from added places', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import city' });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: info.outputPath('source.png') });
  await dialog.getByLabel('OSM file').setInputFiles('fixtures/osm/downtown.osm');
  await page.screenshot({ path: info.outputPath('options.png') });
  const beforeImport = (await page.evaluate(() => window.cityflows!.metrics())).timeS;
  await dialog.getByRole('button', { name: 'Import roads' }).click();
  await expect(dialog.getByLabel('Import progress')).toBeVisible();
  await page.screenshot({ path: info.outputPath('progress.png') });
  await expect(dialog.getByRole('region', { name: 'Import diagnostics' })).toContainText(
    /\d+ roads · 0 errors · \d+ warnings/,
  );
  await expect(dialog).toContainText('Inferred');
  expect((await page.evaluate(() => window.cityflows!.metrics())).timeS).toBeGreaterThan(
    beforeImport,
  );
  const summary = await dialog.getByRole('status').innerText();
  const roads = Number(summary.match(/^(\d+) roads/)![1]);
  expect(roads).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('diagnostics.png') });
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await page.screenshot({ path: info.outputPath('accept.png') });
  await dialog.getByRole('button', { name: 'Accept city' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.attribution')).toContainText('OpenStreetMap');
  expect(await page.evaluate(() => Object.keys(window.cityflows!.city!().roads).length)).toBe(
    roads,
  );
  await page.evaluate(async () => {
    const api = window.cityflows!;
    const city = api.city!();
    // Remove gateway demand so the assertion measures the two newly created places.
    for (const place of Object.values(city.places)) {
      await api.commit!({
        kind: 'updatePlace',
        placeId: place.id,
        patch: { population: 0, jobs: 0 },
      });
    }
    const lengths = Object.values(city.roads).map((road) => ({
      road,
      length: road.centerline
        .slice(1)
        .reduce(
          (sum, point, i) =>
            sum + Math.hypot(point.x - road.centerline[i]!.x, point.y - road.centerline[i]!.y),
          0,
        ),
    }));
    const { road, length } = lengths.sort((a, b) => b.length - a.length)[0]!;
    for (const [index, kind] of (['residential', 'work'] as const).entries()) {
      await api.commit!({
        kind: 'addPlace',
        place: {
          kind,
          name: kind,
          shape: { kind: 'point', pos: road.centerline[0]! },
          population: index === 0 ? 100 : 0,
          jobs: index === 1 ? 100 : 0,
          attraction: 0,
          capacity: null,
          profile: null,
          events: [],
          provenance: { source: 'authored' },
          connectors: [
            {
              id: `c:${api.city!().nextId}`,
              roadId: road.id,
              lane: 0,
              positionM: length * (index === 0 ? 0.2 : 0.8),
              direction: index === 0 ? 'out' : 'in',
              throughputPerMin: 600,
            },
          ],
        },
      });
    }
  });
  expect(
    await page.evaluate(
      () =>
        Object.values(window.cityflows!.city!().places).filter((place) => place.name === 'work')
          .length,
    ),
  ).toBe(1);
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  const counts = await page.evaluate(async () => {
    for (let i = 0; i < 360; i++) {
      await window.cityflows!.step(100);
      const metrics = await window.cityflows!.metrics();
      if (metrics.trips.driving > 0) return metrics.trips;
    }
    return (await window.cityflows!.metrics()).trips;
  });
  expect(counts.driving, JSON.stringify(counts)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('imported-city.png') });
  expect(errors).toEqual([]);
});

test('shows area bounds, refuses oversized selections, and blocks invalid uploads', async ({
  page,
}, info) => {
  await page.route('https://**/*', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import city' });
  await dialog.getByRole('button', { name: 'Choose map area' }).click();
  await expect(dialog.getByLabel('West', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('area.png') });
  await dialog.getByLabel('East', { exact: true }).fill('-70');
  await expect(dialog.getByRole('alert')).toContainText('50 km²');
  await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await dialog
    .getByLabel('OSM file')
    .setInputFiles({ name: 'bad.osm', mimeType: 'application/xml', buffer: Buffer.from('<osm/>') });
  await dialog.getByRole('button', { name: 'Import roads' }).click();
  await expect(dialog.getByRole('status')).toContainText('Import failed');
  await expect(dialog.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
