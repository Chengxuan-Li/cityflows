import { afterEach, expect, it, vi } from 'vitest';
import type { HostReply, HostWireRequest } from '../host/protocol';
import { bundledProject } from './bundled-projects';

/** A traffic worker that answers the store's load sequence; `hold` keeps its replies back. */
class FakeWorker extends EventTarget {
  static created: FakeWorker[] = [];
  hold = false;
  held: HostReply[] = [];
  terminated = false;
  constructor() {
    super();
    FakeWorker.created.push(this);
  }
  postMessage(request: HostWireRequest) {
    const result =
      request.type === 'metrics'
        ? { timeS: FakeWorker.created.indexOf(this), trips: {} }
        : request.type === 'signalTiming'
          ? {}
          : undefined;
    const reply: HostReply = { id: request.id, ok: true, result };
    if (this.hold) this.held.push(reply);
    else queueMicrotask(() => this.reply(reply));
  }
  reply(data: HostReply) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  release() {
    for (const reply of this.held.splice(0)) this.reply(reply);
  }
  terminate() {
    this.terminated = true;
  }
}

afterEach(() => vi.unstubAllGlobals());

it('answers a query sent to the replaced engine while another project opens (TASK-200)', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  // The store reads the window width once, on creation.
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
  const { useAppStore } = await import('./store');
  // The 3D view draws no preview, so the open does not wait for the map.
  useAppStore.setState({ viewMode: '3d' });
  const result = await bundledProject('signalApproach');
  if (!result.ok) throw new Error(result.error);
  const { loadProject } = useAppStore.getState();
  await loadProject(result.project);
  const [first] = FakeWorker.created;
  const firstEngine = useAppStore.getState().session!.engine;

  // `window.cityflows.metrics()` and the panels read `session.engine` while the open runs.
  first!.hold = true;
  const query = firstEngine.metrics();
  await loadProject(result.project);
  expect(useAppStore.getState().error).toBeNull();
  expect(useAppStore.getState().session!.engine).not.toBe(firstEngine);
  expect(first!.terminated).toBe(false);
  await expect(firstEngine.hash()).rejects.toThrow('Traffic worker retired');

  first!.release();
  await expect(query).resolves.toMatchObject({ timeS: 0 });
  expect(first!.terminated).toBe(true);
  expect(FakeWorker.created[1]!.terminated).toBe(false);
});
