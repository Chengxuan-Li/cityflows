import { afterEach, expect, test, vi } from 'vitest';
import { areaError, buildQuery, fetchOverpass } from './overpass';

afterEach(() => vi.unstubAllGlobals());

test('validates bounds and the 50 square kilometer cap before requesting', () => {
  expect(areaError([-74.008, 40.711, -74.004, 40.715])).toBeNull();
  expect(areaError([-74, 40, -70, 41])).toContain('50 km²');
  expect(areaError([NaN, 40, -74, 41])).toContain('valid');
  expect(() => buildQuery([-74, 41, -73, 40])).toThrow('valid');
  expect(buildQuery([-74.008, 40.711, -74.004, 40.715])).toContain(
    'rel(bw.roads)[type=restriction]',
  );
});

test('allows one abortable request and releases the slot on cancellation or failure', async () => {
  const bbox: [number, number, number, number] = [-74.008, 40.711, -74.004, 40.715];
  const controller = new AbortController();
  const fetchMock = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () =>
          reject(new DOMException('Cancelled', 'AbortError')),
        );
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const pending = fetchOverpass(bbox, controller.signal, 'https://example.test/interpreter');
  await expect(fetchOverpass(bbox, controller.signal)).rejects.toThrow('already running');
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchMock.mock.calls[0]![0]).toBe('https://example.test/interpreter');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('busy', { status: 429 })));
  await expect(fetchOverpass(bbox, new AbortController().signal)).rejects.toThrow('429');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<osm/>')));
  await expect(fetchOverpass(bbox, new AbortController().signal)).resolves.toBe('<osm/>');
});
