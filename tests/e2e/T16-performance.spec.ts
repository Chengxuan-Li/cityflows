import { expect, test, type CDPSession } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { workload, type WorkloadName } from '../../bench/workloads';

interface Samples {
  capturing: boolean;
  frames: number[];
  render: number[];
  snapshots: number[];
}

declare global {
  interface Window {
    performanceSamples: Samples;
  }
}

function distribution(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return {
    samples: sorted.length,
    meanMs: samples.reduce((sum, n) => sum + n, 0) / Math.max(1, samples.length),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted.at(-1) ?? 0,
  };
}

// A page's JS heap excludes the simulation worker. Query both isolates over CDP.
function workerHeap(cdp: CDPSession) {
  let workerSession: string | undefined;
  let nextId = 0;
  const pending = new Map<
    number,
    {
      resolve: (value: { usedSize: number; backingStorageSize: number }) => void;
      reject: (error: Error) => void;
    }
  >();
  cdp.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
    if (targetInfo.type === 'worker') workerSession = sessionId;
  });
  cdp.on('Target.detachedFromTarget', ({ sessionId }) => {
    if (sessionId === workerSession) workerSession = undefined;
  });
  cdp.on('Target.receivedMessageFromTarget', ({ message }) => {
    const reply = JSON.parse(message);
    const call = pending.get(reply.id);
    if (!call) return;
    pending.delete(reply.id);
    if (reply.error) call.reject(new Error(reply.error.message));
    else call.resolve(reply.result);
  });
  async function send(method: string) {
    if (!workerSession) throw new Error('Simulation worker is not attached');
    const id = ++nextId;
    const result = new Promise<{ usedSize: number; backingStorageSize: number }>(
      (resolve, reject) => pending.set(id, { resolve, reject }),
    );
    await cdp.send('Target.sendMessageToTarget', {
      sessionId: workerSession,
      message: JSON.stringify({ id, method }),
    });
    return result;
  }
  return async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await send('HeapProfiler.collectGarbage');
    const main = await cdp.send('Runtime.getHeapUsage');
    const worker = await send('Runtime.getHeapUsage');
    return {
      mainBytes: main.usedSize + (main.backingStorageSize ?? 0),
      workerBytes: worker.usedSize + (worker.backingStorageSize ?? 0),
    };
  };
}

for (const name of ['grid5x5', 'grid5x5-stress', 'town'] satisfies WorkloadName[]) {
  test(`T16 ${name}: 10x frames, transfer, render and bounded retained heap`, async ({
    page,
    context,
    browser,
  }, info) => {
    test.setTimeout(420_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    const heap = workerHeap(cdp);
    await cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: false,
    });
    await page.addInitScript(() => {
      const data: Samples = (window.performanceSamples = {
        capturing: false,
        frames: [],
        render: [],
        snapshots: [],
      });
      let previous = 0;
      const frame = (now: number) => {
        if (data.capturing && previous) data.frames.push(now - previous);
        previous = data.capturing ? now : 0;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      new PerformanceObserver((list) => {
        if (data.capturing)
          for (const entry of list.getEntries())
            if (entry.name === 'cityflows:render') data.render.push(entry.duration);
      }).observe({ entryTypes: ['measure'] });
      const post = Worker.prototype.postMessage;
      const requests = new WeakMap<Worker, Map<number, number>>();
      Worker.prototype.postMessage = function (message, options) {
        let times = requests.get(this);
        if (!times) {
          times = new Map();
          requests.set(this, times);
          this.addEventListener('message', ({ data: reply }) => {
            const started = times!.get(reply.id);
            if (started === undefined) return;
            times!.delete(reply.id);
            if (data.capturing) data.snapshots.push(performance.now() - started);
          });
        }
        if (data.capturing && message?.type === 'snapshot')
          times.set(message.id, performance.now());
        // Preserve the browser's transfer-list/structured-options overload unchanged.
        post.call(this, message, options as StructuredSerializeOptions);
      };
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
    const input = workload(name);
    // Distinguish the uploaded grid from the identically named initial project.
    input.city.name = `Performance: ${input.city.name}`;
    const { manifest } = JSON.parse(
      await readFile('fixtures/projects/grid5x5.cityflows.json', 'utf8'),
    );
    const project = {
      city: input.city,
      population: input.population,
      scenarios: [input.scenario],
    };
    manifest.name = input.city.name;
    manifest.files = Object.fromEntries(
      Object.entries(project).map(([key, value]) => [
        `${key}.json`,
        createHash('sha256').update(JSON.stringify(value)).digest('hex'),
      ]),
    );
    const json = JSON.stringify({ manifest, ...project });
    const loadedAt = performance.now();
    await page.getByLabel('Open project').setInputFiles({
      name: `${name}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    await expect(page.getByRole('heading', { name: input.city.name, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => window.cityflows!.metrics().then((m) => m.timeS)))
      .toBe(input.scenario.startS);
    const loadMs = performance.now() - loadedAt;
    const beforePeak = await heap();
    const renderer = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="City map"]')!;
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return debug ? String(gl!.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unavailable';
    });
    // Manual stepping reaches the real morning cheaply; measurements below use the play loop.
    const sampleTimeS = 8 * 3600 + (name === 'grid5x5-stress' ? 4 * 60 : 0);
    await page.evaluate(
      (steps) => window.cityflows!.step(steps),
      (sampleTimeS - input.scenario.startS) * 10,
    );
    await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('10');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(1000);
    const start = await page.evaluate(async () => {
      const metrics = await window.cityflows!.metrics();
      window.cityflowsRenderContinuously = true;
      window.performanceSamples.capturing = true;
      return {
        wallMs: performance.now(),
        timeS: metrics.timeS,
        active: metrics.trips.driving + metrics.trips.queuedDestination,
      };
    });
    await page.waitForTimeout(8000);
    const end = await page.evaluate(async () => {
      const metrics = await window.cityflows!.metrics();
      window.performanceSamples.capturing = false;
      window.cityflowsRenderContinuously = false;
      return {
        wallMs: performance.now(),
        timeS: metrics.timeS,
        active: metrics.trips.driving + metrics.trips.queuedDestination,
        samples: window.performanceSamples,
      };
    });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.evaluate(async () => {
      const { timeS } = await window.cityflows!.metrics();
      await window.cityflows!.step(Math.round((10 * 3600 - timeS) * 10));
    });
    async function cycleDetail(capture = false) {
      if (name !== 'town') return;
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const map = page.getByLabel('City map');
      if (capture) await map.screenshot({ path: info.outputPath('overview.png') });
      await map.hover();
      await page.mouse.wheel(0, -1800);
      await page.waitForTimeout(150);
      if (capture) await map.screenshot({ path: info.outputPath('detail.png') });
      await page.mouse.wheel(0, 1800);
      await page.waitForTimeout(150);
    }
    await cycleDetail(true);
    const afterPeak = await heap();
    // Equal completed workloads across restart cycles separate legitimate retained trip
    // history from a leak. The first cycle warms GPU geometry, JIT and particle pools.
    const retained = [afterPeak];
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.getByRole('button', { name: 'Restart', exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.cityflows!.metrics().then((m) => m.timeS)))
        .toBe(input.scenario.startS);
      await page.evaluate(
        (steps) => window.cityflows!.step(steps),
        (10 * 3600 - input.scenario.startS) * 10,
      );
      await page.waitForTimeout(250);
      await cycleDetail();
      retained.push(await heap());
    }
    const frames = distribution(end.samples.frames);
    const achievedMultiplier = ((end.timeS - start.timeS) * 1000) / (end.wallMs - start.wallMs);
    const report = {
      scenario: name,
      environment: {
        browser: browser.version(),
        cpu: cpus()[0]?.model,
        viewport: page.viewportSize(),
        renderer,
      },
      workload: {
        nodes: Object.keys(input.city.nodes).length,
        roads: Object.keys(input.city.roads).length,
        persons: input.population.length,
        trips: input.trips.length,
        startActive: start.active,
        endActive: end.active,
      },
      loadMs,
      sampleWallMs: end.wallMs - start.wallMs,
      frames,
      fps: 1000 / frames.meanMs,
      renderCpu: distribution(end.samples.render),
      snapshotRoundTrip: distribution(end.samples.snapshots),
      achievedMultiplier,
      heap: {
        beforePeak,
        afterPeak,
        retained,
        includes:
          'V8 used heap + backing storage; main and simulation worker after forced GC; excludes GPU allocations',
      },
      softTargets: {
        fps: name === 'grid5x5' ? 60 : 30,
        fpsMet: 1000 / frames.meanMs >= (name === 'grid5x5' ? 59 : 30),
        multiplier: 10,
        multiplierMet: achievedMultiplier >= 9.5,
      },
      memoryPolicy:
        'Four identical mornings; each later isolate must remain within max(8 MiB, 15%) of its first post-peak retained size. A finite regression guard, not proof for arbitrary durations.',
    };
    const path = info.outputPath('performance.json');
    await writeFile(path, JSON.stringify(report, null, 2));
    await info.attach(`T16-${name}`, { path, contentType: 'application/json' });
    console.info(JSON.stringify(report));
    expect(errors).toEqual([]);
    expect(frames.samples).toBeGreaterThan(0);
    expect(report.renderCpu.samples).toBeGreaterThan(0);
    expect(report.snapshotRoundTrip.samples).toBeGreaterThan(0);
    if (name === 'grid5x5-stress') expect(start.active).toBeGreaterThanOrEqual(2700);
    for (const sample of retained.slice(1))
      for (const key of ['mainBytes', 'workerBytes'] as const) {
        expect(
          sample[key] - retained[0]![key],
          `${name} ${key}: retained heap grows across equal workloads`,
        ).toBeLessThanOrEqual(Math.max(8 * 1024 ** 2, retained[0]![key] * 0.15));
      }
  });
}
