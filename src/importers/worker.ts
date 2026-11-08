import { importOsm } from './osm';
import { includeTerrain } from './terrain';
import type { ImportOptions, ImportResult } from './types';

export type ImportMessage =
  { type: 'progress'; message: string } | { type: 'result'; result: ImportResult };
self.onmessage = async (event: MessageEvent<{ xml: string; options: ImportOptions }>) => {
  self.postMessage({
    type: 'progress',
    message: 'Parsing roads and checking connections…',
  } satisfies ImportMessage);
  try {
    let result = importOsm(event.data.xml, event.data.options);
    if (result.ok && event.data.options.terrain !== false) {
      self.postMessage({
        type: 'progress',
        message: 'Downloading terrain…',
      } satisfies ImportMessage);
      result = await includeTerrain(result);
    }
    self.postMessage({ type: 'result', result } satisfies ImportMessage);
  } catch (error) {
    self.postMessage({
      type: 'result',
      result: {
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'import_failed',
            refs: [],
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      },
    } satisfies ImportMessage);
  }
};
