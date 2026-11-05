import { expect, test } from '@playwright/test';
import { button, city, downloadText, metrics, pageErrors, writeMetrics } from './helpers';

// Parse CSV fields, including escaped quotes and embedded newlines in imported names.
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(field.replace(/\r$/, ''));
      field = '';
      if (char === '\n') {
        rows.push(row);
        row = [];
      }
    } else field += char;
  }
  expect(quoted).toBe(false);
  expect(field).toBe('');
  expect(row).toEqual([]);
  return rows;
}

test('QA every export downloads parseable data with columns, feature counts and synthetic provenance', async ({
  page,
}, info) => {
  const errors = pageErrors(page);
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  const source = await city(page);
  await button(page, 'Export').click();
  await page.getByLabel('Record trajectories', { exact: true }).click();
  await expect(page.getByLabel('Record trajectories', { exact: true })).toBeChecked();
  await button(page, 'Play').click();
  const start = (await metrics(page)).timeS;
  await expect.poll(async () => (await metrics(page)).timeS).toBeGreaterThan(start);
  await button(page, 'Pause').click();
  await page.evaluate(() => window.cityflows!.step(600));
  const run = await metrics(page);
  const headers = [
    [
      'Trips CSV',
      [
        'id',
        'person',
        'origin',
        'destination',
        'departure',
        'arrival',
        'travel time',
        'delay',
        'fail reason',
      ],
    ],
    [
      'Road metrics CSV',
      ['id', 'name', 'class', 'length', 'mean speed ratio', 'vehicles passed', 'max queue'],
    ],
    ['Trajectories CSV', ['vehicle id', 'time', 'x', 'y', 'lane', 'speed']],
  ] as const;
  const counts: Record<string, number> = {};
  for (const [label, columns] of headers) {
    await expect(button(page, label)).toBeEnabled();
    const downloaded = await downloadText(page, label);
    expect(downloaded.name).toMatch(/\.csv$/);
    const [provenance, ...lines] = downloaded.text.split('\r\n');
    expect(provenance).toMatch(
      /^# synthetic traffic, not observed traffic; seed=\d+; engine version=.+; schema version=2; time step=0\.1s$/,
    );
    const [header, ...rows] = parseCsv(lines.join('\r\n'));
    expect(header).toEqual(columns);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.length === columns.length)).toBe(true);
    counts[label] = rows.length;
    if (label === 'Trips CSV') {
      expect(new Set(rows.map((row) => row[0])).size).toBe(rows.length);
      for (const row of rows) {
        expect(source.places[row[2]!]).toBeDefined();
        expect(source.places[row[3]!]).toBeDefined();
      }
      expect(rows.length).toBe(Object.values(run.trips).reduce((sum, value) => sum + value, 0));
    } else if (label === 'Road metrics CSV') {
      expect(rows.map((row) => row[0]).sort()).toEqual(Object.keys(source.roads).sort());
      for (const row of rows) expect(Number(row[3])).toBeGreaterThan(0);
    } else {
      for (const row of rows) {
        for (const index of [0, 1, 2, 3, 5]) expect(Number.isFinite(Number(row[index]))).toBe(true);
        expect(Number(row[1])).toBeLessThanOrEqual(run.timeS);
        expect(row[4]).toMatch(/^r:\d+#\d+(>r:\d+#\d+)?$/);
      }
    }
  }
  // QA073-002 tracks the toolbox covering this button's center; keyboard activation
  // still exercises the user's download and lets us validate the file contents.
  const downloaded = await downloadText(page, 'GeoJSON', true);
  expect(downloaded.name).toMatch(/\.geojson$/);
  const geo = JSON.parse(downloaded.text);
  expect(geo.type).toBe('FeatureCollection');
  expect(geo['cityflows:notice']).toBe('Synthetic traffic, not observed traffic');
  expect(geo['cityflows:provenance']).toMatchObject({ schemaVersion: 2, dtS: 0.1 });
  expect(geo['cityflows:provenance'].engineVersion).toEqual(expect.any(String));
  expect(geo['cityflows:provenance'].seed).toEqual(expect.any(Number));
  expect(geo['cityflows:coordinates']).toBe('local');
  expect(geo.features).toHaveLength(
    Object.keys(source.roads).length + Object.keys(source.places).length,
  );
  const features = geo.features as {
    type: string;
    geometry: { type: string; coordinates: unknown[] };
    properties: Record<string, unknown>;
  }[];
  expect(features.map((feature) => feature.properties['cityflows:id']).sort()).toEqual(
    [...Object.keys(source.roads), ...Object.keys(source.places)].sort(),
  );
  expect(features.filter((feature) => feature.geometry.type === 'LineString')).toHaveLength(
    Object.keys(source.roads).length,
  );
  for (const feature of features) {
    expect(feature.type).toBe('Feature');
    expect(feature.geometry.coordinates.length).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
  await writeMetrics(info, { csvRows: counts, geojsonFeatures: features.length, timeS: run.timeS });
});

test('QA GeoJSON export is clickable without the toolbox intercepting it', async ({ page }) => {
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, 'Export').click();
  await button(page, 'GeoJSON').click({ trial: true, timeout: 3000 });
});
