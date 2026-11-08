import { expect, test } from '@playwright/test';
import { pointAtDistance } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import type { City } from '../../src/schema';
import { button, city, clickWorld, importOsm, metrics, pageErrors } from './helpers';

test('T47 local traffic only reroutes a live through trip and undo restores access @smoke', async ({
  page,
}, info) => {
  const errors = pageErrors(page);
  await page.goto('/');
  await expect(button(page, 'Step')).toBeEnabled();
  await button(page, 'Step').click();
  const before = await page.evaluate(async () => {
    const api = window.cityflows!;
    const vehicle = await api.inspect(1);
    return vehicle!.route!.movements.map((index) => api.movementId(index));
  });
  const roadId = before[1]!.split('>')[1]!.split('#')[0]!;
  const original = await city(page);
  const road = original.roads[roadId]!;
  const a = road.centerline[0]!,
    b = road.centerline.at(-1)!;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  await clickWorld(page, {
    x: (a.x + b.x) / 2 - ((b.y - a.y) / length) * road.lateralOffsetM,
    y: (a.y + b.y) / 2 + ((b.x - a.x) / length) * road.lateralOffsetM,
  });
  await page.getByText('Lanes and street settings', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Access', exact: true }).selectOption('destination');
  await expect(page.getByText(/^Edit applied/)).toBeVisible();
  expect((await city(page)).roads[roadId]!.access).toEqual({ all: 'destination' });
  await page.evaluate(() => window.cityflows!.step(200));
  const after = await page.evaluate(async () => {
    const api = window.cityflows!;
    const vehicle = await api.inspect(1);
    return {
      id: vehicle!.id,
      reason: vehicle!.routeReason,
      roads: vehicle!.route!.movements.map((index) => api.movementId(index)),
    };
  });
  expect(after.id).toBe(1);
  expect(after.roads.length).toBeGreaterThan(0);
  expect(after.roads.some((movement) => movement.includes(`${roadId}#`))).toBe(false);
  await page.getByText('Vehicle classes', { exact: true }).click();
  await page.getByRole('combobox', { name: 'bus access', exact: true }).selectOption('yes');
  await expect
    .poll(async () => (await city(page)).roads[roadId]!.access)
    .toEqual({ all: 'destination', bus: 'yes' });
  await button(page, 'Undo').click();
  await button(page, 'Undo').click();
  await expect(page.getByRole('combobox', { name: 'Access', exact: true })).toHaveValue('');
  expect((await city(page)).roads[roadId]).not.toHaveProperty('access');
  await page.screenshot({ path: info.outputPath('local-access-inspector.png') });
  expect(errors).toEqual([]);
});

test('T47 Munich local access diverts through traffic and permits a local departure @smoke', async ({
  page,
}, info) => {
  const errors = pageErrors(page);
  await page.goto('/');
  await expect(button(page, 'Play')).toBeEnabled();
  await importOsm(page, 'fixtures/osm/munich-donnersberger.osm');
  const source = await city(page);
  const result = compile(source);
  if (!result.ok) throw new Error('Munich must compile');
  const net = result.compiled;
  let chosen: { roadId: string; vehicleId: number; point: { x: number; y: number } } | undefined;
  for (let minute = 0; minute < 3 && !chosen; minute++) {
    await page.evaluate(() => window.cityflows!.step(600));
    const vehicles = await page.evaluate(async () => {
      const api = window.cityflows!;
      const snapshot = await api.snapshot!();
      return Promise.all(
        [...snapshot.id.subarray(0, snapshot.count)].slice(0, 128).map((id) => api.inspect(id)),
      );
    });
    for (const vehicle of vehicles) {
      if (!vehicle?.route || vehicle.state !== 'driving') continue;
      const current = net.lanes[vehicle.lane]!.road;
      const last = vehicle.route.roads.at(-1)!;
      const destination = net.connectors.find(
        (c) =>
          c.direction !== 'out' &&
          net.places[c.place]!.id === vehicle.destinationPlace &&
          net.lanes[c.lane]!.road === last,
      );
      if (!destination) continue;
      for (const idx of vehicle.route.roads.slice(vehicle.route.roads.indexOf(current) + 1, -1)) {
        const road = net.roads[idx]!;
        if (source.roads[road.id]!.roadClass !== 'residential' || source.roads[road.id]!.access)
          continue;
        const edited: City = {
          ...source,
          roads: {
            ...source.roads,
            [road.id]: { ...source.roads[road.id]!, access: { all: 'destination' } },
          },
        };
        const changed = compile(edited);
        if (!changed.ok) throw new Error('Access edit must compile');
        const provider = createRouteProvider(),
          costs = freeFlowLinkCosts(changed.compiled);
        const request = {
          fromLane: vehicle.lane,
          fromPosM: vehicle.positionM,
          toConnector: destination.idx,
          vehicleClass: 'car' as const,
          desiredSpeedFactor: 1,
          noise: 0,
          seed: 1,
        };
        const through = provider.route(changed.compiled, costs, request);
        const local = provider.route(changed.compiled, costs, {
          ...request,
          fromLane: road.lanes[0]!,
          fromPosM: 0,
        });
        if (!through.ok || through.route.roads.includes(idx) || !local.ok) continue;
        expect(local.route.roads[0]).toBe(idx);
        const lane = net.lanes[road.lanes[0]!]!;
        const point = await page.evaluate(
          async (points) => {
            const api = window.cityflows!,
              snapshot = await api.snapshot!();
            return points.find((point) => {
              const screen = api.worldToScreen!(point);
              for (let i = 0; i < snapshot.count; i++) {
                const car = api.worldToScreen!({ x: snapshot.x[i]!, y: snapshot.y[i]! });
                if (Math.hypot(car.x - screen.x, car.y - screen.y) < 16) return false;
              }
              return true;
            });
          },
          [0.25, 0.5, 0.75].map((part) =>
            pointAtDistance(lane.polyline, lane.cumulative, lane.lengthM * part),
          ),
        );
        if (!point) continue;
        chosen = {
          roadId: road.id,
          vehicleId: vehicle.id,
          point,
        };
        break;
      }
      if (chosen) break;
    }
  }
  expect(chosen, 'a live Munich through trip with a residential alternative').toBeDefined();
  await clickWorld(page, chosen!.point);
  await page.getByText('Lanes and street settings', { exact: true }).click();
  const start = (await metrics(page)).timeS;
  await page.getByRole('combobox', { name: 'Access', exact: true }).selectOption('destination');
  await expect(page.getByText(/^Edit applied/)).toBeVisible();
  await button(page, 'Play').click();
  await expect(button(page, 'Pause')).toBeEnabled();
  await expect.poll(async () => (await metrics(page)).timeS).toBeGreaterThan(start);
  await expect
    .poll(async () =>
      page.evaluate(
        async ({ id, roadId }) => {
          const api = window.cityflows!,
            vehicle = await api.inspect(id);
          return vehicle?.route?.movements.some((idx) =>
            api.movementId(idx).includes(`${roadId}#`),
          );
        },
        { id: chosen!.vehicleId, roadId: chosen!.roadId },
      ),
    )
    .toBe(false);
  await button(page, 'Pause').click();
  expect((await city(page)).roads[chosen!.roadId]!.access).toEqual({ all: 'destination' });
  await info.attach('Munich access example', {
    body: JSON.stringify(chosen),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('munich-local-access.png') });
  expect(errors).toEqual([]);
});
