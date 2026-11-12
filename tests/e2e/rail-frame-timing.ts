import { expect, type Page } from '@playwright/test';

/** Keep raw intervals beside submission times: rAF also includes GPU and scheduling waits. */
export async function railFrameTiming(
  page: Page,
  measure: string,
  sample: { frames: number; warm: number },
) {
  const result = await page.evaluate(
    async ({ measure, sample }) => {
      const api = window.cityflows;
      const timeBefore = api ? (await api.metrics()).timeS : null;
      window.cityflowsRenderContinuously = true;
      const frames: number[] = [],
        entries: { startTime: number; duration: number }[] = [];
      const collect = (records: PerformanceEntry[]) => {
        for (const { name, startTime, duration } of records)
          if (name === measure) entries.push({ startTime, duration });
      };
      const observer = new PerformanceObserver((list) => collect(list.getEntries()));
      observer.observe({ entryTypes: ['measure'] });
      // The renderer runs before this sampler: start after the last warm frame's callback.
      let start = 0,
        last = 0;
      for (let i = 0; i < sample.frames; i++) {
        const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        if (i === sample.warm - 1) start = performance.now();
        if (i >= sample.warm && last) frames.push(now - last);
        last = now;
      }
      const end = performance.now();
      collect(observer.takeRecords());
      observer.disconnect();
      window.cityflowsRenderContinuously = false;
      const renders = entries
        .filter((e) => e.startTime > start && e.startTime <= end)
        .map((e) => e.duration);
      const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
      const canvas = document.querySelector<HTMLCanvasElement>(
        measure === 'cityflows:render3d' ? 'canvas[data-view="3d"]' : 'canvas[data-view="2d"]',
      );
      return {
        sample,
        frameMs: mean(frames),
        renderMs: mean(renders),
        drawn: renders.length,
        frames,
        renders,
        start,
        end,
        startedAt: new Date(performance.timeOrigin + start).toISOString(),
        endedAt: new Date(performance.timeOrigin + end).toISOString(),
        timeBefore,
        timeAfter: api ? (await api.metrics()).timeS : null,
        view3D: measure === 'cityflows:render3d' ? api?.view3D?.() : null,
        projection: api?.worldToScreen
          ? {
              origin: api.worldToScreen({ x: 0, y: 0 }),
              east: api.worldToScreen({ x: 1, y: 0 }),
              south: api.worldToScreen({ x: 0, y: 1 }),
            }
          : null,
        canvas: canvas ? { ...canvas.dataset } : null,
      };
    },
    { measure, sample },
  );
  expect(result.drawn, 'one render submission per captured continuous frame').toBe(
    result.frames.length,
  );
  return result;
}

export async function railTimingEnvironment(page: Page) {
  const browser = page.context().browser()!;
  const session = await browser.newBrowserCDPSession();
  const { gpu } = await session.send('SystemInfo.getInfo');
  await session.detach();
  return {
    browser: browser.version(),
    gpu: {
      devices: gpu.devices,
      renderer: gpu.auxAttributes?.glRenderer,
      vendor: gpu.auxAttributes?.glVendor,
      version: gpu.auxAttributes?.glVersion,
      featureStatus: gpu.featureStatus,
    },
    ci: Boolean(process.env.CI),
    workers: 1,
    viewport: page.viewportSize(),
    display: await page.evaluate(() => ({ devicePixelRatio, userAgent: navigator.userAgent })),
  };
}
