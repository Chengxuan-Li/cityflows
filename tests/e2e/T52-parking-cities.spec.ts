import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { placeCamera } from '../../bench/geometry-shots';
import { compile } from '../../src/network';
import type { Vec2 } from '../../src/geo/vec2';
import type { PlaceEvent } from '../../src/schema';
import { occupiedSpaces } from '../../src/render/parked-cars';
import { button, city, clickWorld, importOsm, metrics, pageErrors } from './helpers';
import { headingAtDistance, pointAtDistance, pointInPolygon } from '../../src/geo/polyline';
import { fixtureTerrain } from './terrain-fixture';

// CI renders on a software GPU, where frame ratios are noise and 90 frames per sample cost
// minutes per view (as T44 and V106): there it takes 20 frames and skips the frame allowance.
const FRAME_SAMPLES = process.env.CI ? 20 : 90;

test('T55 mapped Munich street-side bands hold real parked cars in both views @smoke', async ({
  page,
}, info) => {
  test.setTimeout(420_000);
  const errors = pageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/^https:\/\//, (route) => route.abort());
  const osm = 'fixtures/osm/munich-donnersberger.osm';
  await fixtureTerrain(page, osm);
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, osm, { terrain: true });
  const source = await city(page);
  const compiled = compile(source);
  if (!compiled.ok) throw new Error('compile');
  const net = compiled.compiled;
  const mapped = new Set(net.parking.filter((p) => p.source.strip?.ring).map((p) => p.idx));
  const initial = await page.evaluate(() => window.cityflows!.parkedCars!());
  const initialSpaces = occupiedSpaces(initial, net.parkingSpaces!.length).filter((i) =>
    mapped.has(net.parkingSpaces![i]!.parking),
  );
  await button(page, 'Play').click();
  await expect.poll(async () => (await metrics(page)).timeS).toBeGreaterThan(7 * 3600);
  await button(page, 'Pause').click();
  const advance = async (timeS: number, targetPage = page) => {
    const now = (await metrics(targetPage)).timeS;
    await targetPage.evaluate(
      (steps) => window.cityflows!.step(steps),
      Math.round((timeS - now) / 0.1),
    );
    await expect
      .poll(() => targetPage.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS), {
        timeout: 120000,
      })
      .toBeCloseTo(timeS, 2);
  };
  await advance(8 * 3600);
  const stock = await page.evaluate(() => window.cityflows!.parkedCars!());
  const spaces = occupiedSpaces(stock, net.parkingSpaces!.length).filter((i) =>
    mapped.has(net.parkingSpaces![i]!.parking),
  );
  expect(spaces.length).toBeGreaterThan(0);
  const index = [...spaces].sort((a, b) => {
    const x = net.parkingSpaces![a]!.position,
      y = net.parkingSpaces![b]!.position;
    return Math.hypot(x.x + 300, x.y - 290) - Math.hypot(y.x + 300, y.y - 290);
  })[0]!;
  const space = net.parkingSpaces![index]!,
    facility = net.parking[space.parking]!,
    ring = facility.source.strip!.ring!;
  expect(pointInPolygon(space.position, [...ring, ring[0]!])).toBe(true);
  const centre = space.position,
    zoom = 12;
  await button(page, 'Layers').click();
  for (const label of ['Basemap', 'Places', 'Entrances and exits'])
    await page
      .getByRole('region', { name: 'Map layers' })
      .getByLabel(label, { exact: true })
      .uncheck();
  await button(page, 'Layers').click();
  const capture = async (prefix: string, targetPage = page) => {
    for (const view of ['2d', '3d']) {
      if (view === '2d') await placeCamera(targetPage, [centre.x, centre.y], zoom);
      else {
        await button(targetPage, '3D').click();
        await expect
          .poll(() => targetPage.evaluate(() => !!window.cityflows?.view3D?.()), {
            timeout: 120000,
          })
          .toBe(true);
        await targetPage.evaluate(
          ({ centre, zoom }) => window.cityflows!.setView3D!(centre, zoom, 60, 30),
          { centre, zoom },
        );
      }
      await targetPage
        .getByLabel(view === '2d' ? 'City map' : '3D city view', { exact: true })
        .screenshot({
          path: info.outputPath(`${prefix}${view === '3d' ? '-3d' : ''}.png`),
          animations: 'disabled',
        });
    }
  };
  await placeCamera(page, [centre.x, centre.y], zoom);
  const lane = net.lanes[space.lane]!;
  const p = pointAtDistance(lane.polyline, lane.cumulative, space.positionM);
  const h = headingAtDistance(lane.polyline, lane.cumulative, space.positionM);
  const offset = (facility.source.strip!.side === 'right' ? -1 : 1) * lane.widthM * 0.4;
  // Pick clear pavement beside the slot's lane connector and any car at its stop station.
  await clickWorld(page, { x: p.x - Math.sin(h) * offset, y: p.y + Math.cos(h) * offset });
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  await expect(inspector.getByText('Roadside parking', { exact: true })).toBeVisible();
  await inspector.getByText('Roadside parking', { exact: true }).click();
  await expect(inspector).toContainText('Mapped');
  await button(page, 'Close inspector').click();
  await capture('V119-munich-street-side');
  await advance(9.5 * 3600);
  const later = await page.evaluate(() => window.cityflows!.parkedCars!());
  const laterSpaces = occupiedSpaces(later, net.parkingSpaces!.length).filter((i) =>
    mapped.has(net.parkingSpaces![i]!.parking),
  );
  expect(laterSpaces.map((i) => later!.id[i])).not.toEqual(spaces.map((i) => stock!.id[i]));
  await writeFile(
    info.outputPath('V119-parking.json'),
    JSON.stringify(
      {
        centre,
        zoom,
        osmIds: facility.source.provenance.osmIds,
        initial: initialSpaces.length,
        at0800: spaces.length,
        at0930: laterSpaces.length,
        vehicles: spaces.map((i) => stock!.id[i]),
      },
      null,
      2,
    ),
  );
  // A local T55 comparison run materializes the main import; CI needs only the current view.
  const baseline = 'node_modules/.cache/task119-main.city.json';
  if (existsSync(baseline)) {
    const baselinePage = await page.context().newPage();
    baselinePage.on('pageerror', (error) => errors.push(error.message));
    await baselinePage.setViewportSize({ width: 1280, height: 800 });
    await baselinePage.emulateMedia({ reducedMotion: 'reduce' });
    await baselinePage.route(/^https:\/\//, (route) => route.abort());
    await baselinePage.goto('/');
    await expect(button(baselinePage, 'Play')).toBeEnabled();
    await baselinePage.getByLabel('Open project').setInputFiles(baseline);
    await expect
      .poll(async () => Object.keys((await city(baselinePage)).roads).length, { timeout: 120_000 })
      .toBe(net.roads.length);
    await expect(button(baselinePage, 'Play')).toBeEnabled({ timeout: 120_000 });
    await expect
      .poll(async () =>
        Object.values((await city(baselinePage)).parking!).some((p) => p.strip?.ring),
      )
      .toBe(false);
    await button(baselinePage, 'Layers').click();
    for (const label of ['Basemap', 'Places', 'Entrances and exits'])
      await baselinePage
        .getByRole('region', { name: 'Map layers' })
        .getByLabel(label, { exact: true })
        .uncheck();
    await button(baselinePage, 'Layers').click();
    await advance(8 * 3600, baselinePage);
    await capture('V119-munich-street-side-main', baselinePage);
    await baselinePage.close();
  }
  expect(errors).toEqual([]);
});

async function frameTiming(page: Page) {
  return page.evaluate(async (count) => {
    window.cityflowsRenderContinuously = true;
    const renders: number[] = [],
      frames: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (entry.name === 'cityflows:render' || entry.name === 'cityflows:render3d')
          renders.push(entry.duration);
    });
    observer.observe({ entryTypes: ['measure'] });
    let previous = performance.now();
    for (let i = 0; i < count; i++) {
      const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      if (i > Math.min(9, count / 4)) frames.push(now - previous);
      previous = now;
    }
    observer.disconnect();
    window.cityflowsRenderContinuously = false;
    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    if (!renders.length) throw new Error('No measured parking frames');
    return { frameMs: mean(frames), renderMs: mean(renders), samples: renders.length };
  }, FRAME_SAMPLES);
}

for (const cameraTarget of [
  {
    city: 'munich-donnersberger',
    lots: ['pk:2042', 'pk:2041'],
    access: 'customers',
    osmId: 160401431,
    centre: { x: 135.7, y: 305.3 },
    zoom: 7,
    camera: 'V103-munich-lot',
  },
  {
    city: 'sindelfingen-a81',
    // TASK-118: pk:1475's inferred entry lies in its building exclusion. Exercise the
    // private admission with a street-reachable lot; T54 records the blocked one.
    lots: ['pk:1474'],
    access: 'private',
    osmId: 220072450,
    centre: { x: -344, y: -626 },
    zoom: 7,
    camera: 'V103-sindelfingen-lot',
  },
]) {
  test(`T52 ${cameraTarget.city}: arrival events park real cars at the lot camera @smoke`, async ({
    page,
  }, info) => {
    test.setTimeout(420_000);
    const errors = pageErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(/^https:\/\//, (route) => route.abort());
    const osm = `fixtures/osm/${cameraTarget.city}.osm`;
    await fixtureTerrain(page, osm);
    await page.goto('/');
    await expect(button(page, 'Play')).toBeEnabled();
    await importOsm(page, osm, { terrain: true });
    const original = await city(page);
    const lotIds = cameraTarget.lots;
    const events = lotIds.map((lotId) => {
      const lot = original.parking![lotId]!;
      expect(lot.kind).toBe('lot');
      expect(lot.access).toBe(cameraTarget.access);
      if (cameraTarget.city.startsWith('sindelfingen'))
        expect(lot.entries!.length).toBeGreaterThan(0);
      expect(lot.placeId).not.toBeNull();
      const placeId = lot.placeId!;
      const event: PlaceEvent = {
        id: `${placeId}:visible-lot-arrivals`,
        name: 'Parking arrivals',
        startS: 7 * 3600,
        durationS: 30 * 60,
        arrivals: 16,
        departures: 0,
      };
      return { lotId, placeId, event };
    });
    expect(original.parking![lotIds[0]!]!.provenance.osmIds).toContain(cameraTarget.osmId);
    for (const { placeId, event } of events)
      await page.evaluate(
        ({ placeId, event }) =>
          window.cityflows!.commit!({
            kind: 'updatePlace',
            placeId,
            patch: { events: [event] },
          }),
        { placeId, event },
      );
    const edited = await city(page);
    const expected = structuredClone(original);
    for (const { placeId, event } of events) expected.places[placeId]!.events = [event];
    // Version is the editor's revision; every other saved field stays the imported value.
    expected.version = edited.version;
    expect(edited).toEqual(expected);
    await button(page, 'Restart').click();
    await expect(button(page, 'Step')).toBeEnabled();
    const result = compile(edited);
    if (!result.ok) throw new Error('Controlled customer-lot city must compile');
    const net = result.compiled;
    const map = page.getByLabel('City map', { exact: true });
    // The layer has drawn; Sindelfingen's few residents may park no visible car by 07:00
    // (lead, starting stock per person).
    await expect.poll(() => map.getAttribute('data-parked-cars')).not.toBeNull();
    const initial = await page.evaluate(() => window.cityflows!.parkedCars!());
    expect(
      occupiedSpaces(initial, net.parkingSpaces!.length).filter((index) =>
        lotIds.includes(net.parking[net.parkingSpaces![index]!.parking]!.id),
      ),
    ).toEqual([]);
    const start = await metrics(page);
    await page.evaluate(
      (steps) => window.cityflows!.step(steps),
      Math.round((8 * 3600 - start.timeS) / 0.1),
    );
    await expect
      .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS), {
        timeout: 120_000,
      })
      .toBeCloseTo(8 * 3600, 2);
    const stock = await page.evaluate(() => window.cityflows!.parkedCars!());
    const occupied = occupiedSpaces(stock, net.parkingSpaces!.length);
    await writeFile(
      info.outputPath('lot-arrival-metrics.json'),
      JSON.stringify(await metrics(page), null, 2),
    );
    const arrivals = [];
    for (const { lotId, placeId, event } of events) {
      const spaces = occupied.filter(
        (index) => net.parking[net.parkingSpaces![index]!.parking]!.id === lotId,
      );
      expect(spaces.length, `${lotId} received event arrivals`).toBeGreaterThan(0);
      const details = await page.evaluate(
        (ids) => Promise.all(ids.map((id) => window.cityflows!.inspect(id))),
        spaces.map((index) => stock!.id[index]!),
      );
      for (const [i, detail] of details.entries()) {
        expect(stock!.id[spaces[i]!]!).toBeGreaterThan(0);
        expect(detail?.destinationPlace).toBe(placeId);
        expect(detail?.tripId).toContain(event.id);
        expect(detail?.parkingFacility).toBe(lotId);
        expect(detail?.arrivedS).not.toBeNull();
      }
      arrivals.push({
        lotId,
        placeId,
        occupied: spaces.length,
        manoeuvres: spaces.map((index) => net.parkingSpaces![index]!.manoeuvre),
        vehicles: spaces.map((index, i) => ({
          space: index,
          id: stock!.id[index],
          vclass: stock!.vclass[index],
          position: net.parkingSpaces![index]!.position,
          heading: net.parkingSpaces![index]!.heading,
          detail: details[i],
        })),
      });
    }
    await button(page, 'Layers').click();
    const layers = page.getByRole('region', { name: 'Map layers' });
    for (const label of ['Basemap', 'Places', 'Entrances and exits'])
      await layers.getByLabel(label, { exact: true }).uncheck();
    await button(page, 'Layers').click();
    const records = [];
    const lotPositions = occupied
      .filter((index) => lotIds.includes(net.parking[net.parkingSpaces![index]!.parking]!.id))
      .map((index) => net.parkingSpaces![index]!.position);
    const centre = cameraTarget.city.startsWith('munich')
      ? cameraTarget.centre
      : {
          x: lotPositions.reduce((n, p) => n + p.x, 0) / lotPositions.length,
          y: lotPositions.reduce((n, p) => n + p.y, 0) / lotPositions.length,
        };
    const zoom = cameraTarget.zoom;
    for (const view of ['2d', '3d']) {
      if (view === '2d') await placeCamera(page, [centre.x, centre.y], zoom);
      else {
        await button(page, '3D').click();
        await expect
          .poll(() => page.evaluate(() => !!window.cityflows?.view3D?.()), { timeout: 120_000 })
          .toBe(true);
        await page.evaluate(
          ({ centre, zoom }) => window.cityflows!.setView3D!(centre, zoom, 60, 30),
          { centre, zoom },
        );
      }
      const target = page.getByLabel(view === '3d' ? '3D city view' : 'City map', { exact: true });
      const show = () =>
        page.addStyleTag({
          content:
            'body * { visibility: visible !important; } canvas.map[aria-hidden="true"] { visibility: hidden !important; }',
        });
      const hide = () =>
        page.addStyleTag({
          content:
            'body * { visibility: hidden !important; } canvas.map[aria-hidden="false"], canvas.map3d { visibility: visible !important; }',
        });
      await hide();
      const on = await frameTiming(page);
      const path = info.outputPath(`${cameraTarget.camera}${view === '3d' ? '-3d' : ''}.png`);
      await target.screenshot({ path, animations: 'disabled' });
      await show();
      await button(page, 'Layers').click();
      await layers.getByLabel('Parked cars', { exact: true }).uncheck();
      await expect(target).toHaveAttribute('data-parked-cars', '0');
      await button(page, 'Layers').click();
      await hide();
      const off = await frameTiming(page);
      if (!process.env.CI)
        expect
          .soft(on.frameMs, `controlled customer-lot ${view}: parked cars frame cost`)
          .toBeLessThanOrEqual(off.frameMs * 1.2);
      await show();
      await button(page, 'Layers').click();
      await layers.getByLabel('Parked cars', { exact: true }).check();
      await button(page, 'Layers').click();
      records.push({
        view,
        centre,
        zoom,
        path,
        on,
        off,
        frameRatio: on.frameMs / off.frameMs,
        renderRatio: on.renderMs / off.renderMs,
      });
    }
    const report = {
      scenario: 'Controlled customer arrival events; separate from the default morning benchmark',
      events,
      arrivals,
      timeS: 8 * 3600,
      metrics: await metrics(page),
      records,
    };
    console.info(
      'T52 controlled lot arrivals',
      JSON.stringify({
        city: cameraTarget.city,
        arrivals: arrivals.map(({ lotId, occupied }) => ({ lotId, occupied })),
        records,
      }),
    );
    await writeFile(info.outputPath('customer-lot-frames.json'), JSON.stringify(report, null, 2));
    expect(await city(page)).toEqual(edited);
    expect(errors).toEqual([]);
  });
}

for (const name of ['munich-donnersberger', 'sindelfingen-a81']) {
  test(`T52 ${name}: occupied parking in both views and on/off frame times @smoke`, async ({
    page,
  }, info) => {
    // CI's software GPU ran this past 420 s (TASK-103 merge); 3.3 min locally in CI mode.
    test.setTimeout(process.env.CI ? 600_000 : 420_000);
    const errors = pageErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(/^https:\/\//, (route) => route.abort());
    const osm = `fixtures/osm/${name}.osm`;
    await fixtureTerrain(page, osm);
    await page.goto('/');
    await expect(button(page, 'Play')).toBeEnabled();
    await importOsm(page, osm, { terrain: true });
    const source = await city(page),
      result = compile(source);
    if (!result.ok) throw new Error('Imported parking city must compile');
    const net = result.compiled;
    const map = page.getByLabel('City map', { exact: true });
    // The layer has drawn; Sindelfingen's few residents may park no visible car by 07:00
    // (lead, starting stock per person), Munich's must.
    await expect.poll(() => map.getAttribute('data-parked-cars')).not.toBeNull();
    if (name.startsWith('munich'))
      await expect
        .poll(async () => Number(await map.getAttribute('data-parked-cars')))
        .toBeGreaterThan(0);
    const at0700 = await metrics(page);
    const stock0700 = await page.evaluate(() => window.cityflows!.parkedCars!());
    const parked0700 = occupiedSpaces(stock0700, net.parkingSpaces!.length).length;
    const advance = async (time: number) => {
      const current = (await metrics(page)).timeS;
      await page.evaluate(
        (steps) => window.cityflows!.step(steps),
        Math.round((time - current) / 0.1),
      );
      await expect
        .poll(() => page.evaluate(() => window.cityflows!.drawnSnapshot!()?.timeS), {
          timeout: 120_000,
        })
        .toBeCloseTo(time, 2);
    };
    await advance(8 * 3600);
    const stock = await page.evaluate(() => window.cityflows!.parkedCars!());
    const occupied = occupiedSpaces(stock, net.parkingSpaces!.length);
    const nearest = (points: Vec2[], target: Vec2) =>
      [...points].sort(
        (a, b) =>
          Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y),
      )[0];
    const cameras: { id: string; centre: Vec2; zoom: number }[] = [];
    if (name.startsWith('munich')) {
      const points = occupied
        .filter((index) => {
          const facility = net.parking[net.parkingSpaces![index]!.parking]!;
          return (
            facility.kind === 'roadside' && facility.source.provenance.inferred?.includes('strip')
          );
        })
        .map((index) => net.parkingSpaces![index]!.position);
      expect(points.length).toBeGreaterThan(0);
      cameras.push(
        { id: 'V103-munich-street', centre: nearest(points, { x: -300, y: 290 })!, zoom: 8 },
        { id: 'V103-munich-lot', centre: { x: 135.7, y: 305.3 }, zoom: 7 },
      );
    } else {
      const facilities = net.parking.filter(
        (p) => p.kind === 'lot' && p.source.provenance.inferred?.includes('driveway'),
      );
      expect(facilities.length).toBeGreaterThan(0);
      const active = facilities.filter((p) =>
        occupied.some((index) => net.parkingSpaces![index]!.parking === p.idx),
      );
      const centre = nearest(
        (active.length ? active : facilities).map((p) => p.centroid),
        { x: -379, y: -498.4 },
      )!;
      cameras.push({ id: 'V103-sindelfingen-lot', centre, zoom: 5 });
    }
    await button(page, 'Layers').click();
    const layers = page.getByRole('region', { name: 'Map layers' });
    for (const label of ['Basemap', 'Places', 'Entrances and exits'])
      await layers.getByLabel(label, { exact: true }).uncheck();
    await button(page, 'Layers').click();
    const records: unknown[] = [];
    const showControls = () =>
      page.addStyleTag({
        content:
          'body * { visibility: visible !important; } canvas.map[aria-hidden="true"] { visibility: hidden !important; }',
      });
    const hideControls = () =>
      page.addStyleTag({
        content:
          'body * { visibility: hidden !important; } canvas.map[aria-hidden="false"], canvas.map3d { visibility: visible !important; }',
      });
    for (const view of ['2d', '3d']) {
      await showControls();
      if (view === '3d') {
        await button(page, '3D').click();
        await expect
          .poll(() => page.evaluate(() => !!window.cityflows?.view3D?.()), { timeout: 120_000 })
          .toBe(true);
      }
      const target = page.getByLabel(view === '3d' ? '3D city view' : 'City map', { exact: true });
      await expect
        .poll(async () => Number(await target.getAttribute('data-parked-cars')))
        .toBeGreaterThan(0);
      const targets = [
        ...cameras,
        ...(name.startsWith('munich')
          ? [{ id: 'V103-munich-overview', centre: { x: 0, y: 0 }, zoom: 0.55 }]
          : []),
      ];
      for (const camera of targets) {
        if (view === '2d') await placeCamera(page, [camera.centre.x, camera.centre.y], camera.zoom);
        else
          await page.evaluate(
            ({ centre, zoom }) => window.cityflows!.setView3D!(centre, zoom, 60, 30),
            camera,
          );
        await hideControls();
        const on = await frameTiming(page);
        const path = info.outputPath(`${camera.id}${view === '3d' ? '-3d' : ''}.png`);
        await target.screenshot({ path, animations: 'disabled' });
        await showControls();
        await button(page, 'Layers').click();
        await layers.getByLabel('Parked cars', { exact: true }).uncheck();
        await expect(target).toHaveAttribute('data-parked-cars', '0');
        await button(page, 'Layers').click();
        await hideControls();
        const off = await frameTiming(page);
        if (name.startsWith('munich') && !process.env.CI)
          expect
            .soft(on.frameMs, `${camera.id} ${view}: parked cars frame cost`)
            .toBeLessThanOrEqual(off.frameMs * 1.2);
        await showControls();
        await button(page, 'Layers').click();
        await layers.getByLabel('Parked cars', { exact: true }).check();
        await button(page, 'Layers').click();
        const localCars = occupied.filter((index) => {
          const p = net.parkingSpaces![index]!.position;
          return (
            Math.abs(p.x - camera.centre.x) < 500 / camera.zoom &&
            Math.abs(p.y - camera.centre.y) < 300 / camera.zoom
          );
        }).length;
        records.push({
          ...camera,
          view,
          path,
          localCars,
          occupied: occupied.length,
          on,
          off,
          frameRatio: on.frameMs / off.frameMs,
          renderRatio: on.renderMs / off.renderMs,
          streetPlacementMs: await target.getAttribute('data-street-placement-ms'),
          buildMs: await target.getAttribute('data-build-ms'),
        });
      }
    }
    await advance(9.5 * 3600);
    const at0930 = await metrics(page);
    const stock0930 = await page.evaluate(() => window.cityflows!.parkedCars!());
    const parked0930 = occupiedSpaces(stock0930, net.parkingSpaces!.length).length;
    const report = { name, at0700, parked0700, at0930, parked0930, records };
    console.info('T52 parking frames', JSON.stringify({ name, parked0700, parked0930, records }));
    await writeFile(info.outputPath('parking-frames.json'), JSON.stringify(report, null, 2));
    expect(parked0700).not.toBe(parked0930);
    expect(await city(page)).toEqual(source);
    expect(errors).toEqual([]);
  });
}
