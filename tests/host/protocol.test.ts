import { afterEach, expect, test, vi } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { createEditor } from '../../src/editor';
import { createEngine } from '../../src/sim/engine';
import { createEngineClient } from '../../src/host/client';
import type { HostEvent, HostReply, HostWireRequest } from '../../src/host/protocol';
import { scenario, setup, trips } from '../sim/fixtures';

afterEach(() => vi.unstubAllGlobals());

test('round-trips every request through the worker and matches replies by ID', async () => {
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const requests: HostWireRequest[] = [];
  const replies: HostReply[] = [];
  const main = new EventTarget();
  const worker = new EventTarget();
  const deliver = (target: EventTarget, data: unknown) =>
    target.dispatchEvent(new MessageEvent('message', { data }));
  const port = Object.assign(main, {
    postMessage(request: HostWireRequest) {
      requests.push(request);
      const copy = structuredClone(request);
      queueMicrotask(() => deliver(worker, copy));
    },
    terminate: vi.fn(),
  }) as unknown as Worker;
  let deferReplies = false;
  const deferred: HostReply[] = [];
  let transferred: number[] = [];
  vi.stubGlobal(
    'self',
    Object.assign(worker, {
      postMessage(message: HostReply | HostEvent, options?: StructuredSerializeOptions) {
        const copy = structuredClone(message, options);
        if (options?.transfer) {
          transferred = options.transfer.map((buffer) => (buffer as ArrayBuffer).byteLength);
        }
        if ('id' in copy) {
          replies.push(copy);
          if (deferReplies) {
            deferred.push(copy);
            return;
          }
        }
        deliver(main, copy);
      },
    }),
  );
  await import('../../src/host/worker');

  const client = createEngineClient(port);
  const city = grid5x5();
  const input = {
    compiled: setup(city),
    trips: trips(city, 1).map((trip) => ({
      ...trip,
      vehicleClass: 'truck' as const,
      purpose: 'through' as const,
    })),
    scenario: { ...scenario(), endS: 101 },
  };
  const events: HostEvent[] = [];
  const unsubscribe = client.onEvent((event) => events.push(event));

  await expect(client.metrics()).rejects.toThrow('Load a scenario');
  expect(replies[0]).toEqual({
    id: requests[0]!.id,
    ok: false,
    error: 'Load a scenario before using the traffic engine',
  });

  await client.load(input);
  const initialHash = await client.hash();
  await client.setSpeed(10);
  await client.play();
  await client.pause();
  await client.step(10);

  const first = client.snapshot();
  const second = client.snapshot();
  const snapshot = await first;
  expect(await second).toBe(snapshot);
  expect(requests.filter((request) => request.type === 'snapshot')).toHaveLength(1);
  expect(snapshot).toMatchObject({ timeS: 101, count: 1 });
  expect(snapshot.id.byteLength).toBe(4);
  expect(snapshot.vclass).toBeInstanceOf(Uint8Array);
  expect([...snapshot.vclass]).toEqual([2]);
  // TASK-103: four separate stock buffers accompany the first snapshot, even in a city
  // with no visible spaces, so replacing a previous city's stock also clears the layer.
  // TASK-118 transfers the authoritative parking-pose lane alongside moving vehicles.
  // TASK-125 also transfers the three claim-state buffers.
  expect(transferred).toEqual(Array(20).fill(0));
  expect(snapshot.parkedCars?.occupied).toBeInstanceOf(Uint8Array);
  expect(snapshot.roadSpeedRatio).toHaveLength(input.compiled.roads.length);
  expect(snapshot.parkingOccupancy).toBeInstanceOf(Uint32Array);
  expect(snapshot.parkingOccupancy).toHaveLength(input.compiled.parking.length);
  now = 499;
  const throttled = await client.snapshot();
  expect(throttled.roadSpeedRatio).toBeUndefined();
  expect(throttled.parkingOccupancy).toBeUndefined();
  expect(throttled.parkedCars).toBeUndefined();
  expect(transferred).toEqual(Array(14).fill(0));
  now = 500;
  const updated = await client.snapshot();
  expect(updated.roadSpeedRatio).toHaveLength(input.compiled.roads.length);
  expect(updated.parkingOccupancy).toHaveLength(input.compiled.parking.length);
  expect(updated.parkedCars).toBeUndefined();
  expect(await client.metricsSeries()).toMatchObject([{ timeS: 100, driving: 0 }]);

  deferReplies = true;
  const metrics = client.metrics();
  const inspect = client.inspect(1);
  await Promise.resolve();
  for (const reply of deferred.reverse()) deliver(main, reply);
  expect(await metrics).toMatchObject({
    timeS: 101,
    trips: { driving: 1 },
    completedByClass: { car: 0, van: 0, truck: 0, bus: 0 },
  });
  expect(await inspect).toMatchObject({
    id: 1,
    state: 'driving',
    vehicleClass: 'truck',
    purpose: 'through',
  });
  deferReplies = false;

  expect(events).toEqual([{ type: 'finished', timeS: 101 }]);
  unsubscribe();
  await client.restart();
  expect(await client.metricsSeries()).toHaveLength(1);
  const restarted = await client.snapshot();
  expect(restarted.roadSpeedRatio).toBeDefined();
  expect(restarted.parkingOccupancy).toHaveLength(input.compiled.parking.length);
  expect(restarted.parkedCars).toBeDefined();
  expect(await client.hash()).toBe(initialHash);
  await client.step(10);
  expect(events).toHaveLength(1);
  expect(requests.map((request) => request.type)).toEqual([
    'metrics',
    'load',
    'hash',
    'setSpeed',
    'play',
    'pause',
    'step',
    'snapshot',
    'snapshot',
    'snapshot',
    'metricsSeries',
    'metrics',
    'inspect',
    'restart',
    'metricsSeries',
    'snapshot',
    'hash',
    'step',
  ]);
  expect(await client.tripRecords()).toMatchObject([{ vehicleClass: 'truck', purpose: 'through' }]);
  const beforeComparison = await client.metrics();
  const comparisonHash = await client.hash();
  const historyBefore = await client.metricsSeries();
  const comparisonEvents: HostEvent[] = [];
  client.onEvent((event) => comparisonEvents.push(event));
  const headless = await client.runHeadless();
  expect(headless.metrics.timeS).toBe(101);
  expect(await client.hash()).toBe(comparisonHash);
  expect(await client.metrics()).toEqual(beforeComparison);
  expect(await client.metricsSeries()).toEqual(historyBefore);
  expect(comparisonEvents).toEqual([
    { type: 'headlessProgress', timeS: 100 },
    { type: 'headlessProgress', timeS: 101 },
  ]);
  const editor = createEditor(city);
  expect(editor.apply({ kind: 'setRoadAttributes', roadId: 'r:26', speedLimitMps: 8 }).ok).toBe(
    true,
  );
  const patch = await client.patch(editor.compiled);
  expect(patch.version).toBe(editor.city.version);
  expect(patch.timeS).toBe(beforeComparison.timeS);
  expect((await client.metrics()).timeS).toBe(beforeComparison.timeS);
  expect(await client.metricsSeries()).toEqual(historyBefore);
  const patched = await client.snapshot();
  expect(patched.roadSpeedRatio).toBeDefined();
  expect(patched.parkingOccupancy).toHaveLength(editor.compiled.parking.length);
  const wire = requests.find((request) => request.type === 'patch')!;
  expect(wire.type === 'patch' && wire.compiled.laneSpatial.data).toBeInstanceOf(ArrayBuffer);
  await client.restart();
  const fresh = createEngine();
  fresh.load({ ...input, compiled: editor.compiled });
  await client.step(10);
  fresh.step(10);
  expect(await client.hash()).toBe(fresh.stateHash());
  const pending = client.hash();
  client.terminate();
  await expect(pending).rejects.toThrow('terminated');
  expect(port.terminate).toHaveBeenCalledOnce();
  clock.mockRestore();
});
