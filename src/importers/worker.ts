import { importOsm } from './osm';
import type { ImportOptions, ImportResult } from './types';

export type ImportMessage =
  { type: 'progress'; message: string } | { type: 'result'; result: ImportResult };
self.onmessage = (event: MessageEvent<{ xml: string; options: ImportOptions }>) => {
  self.postMessage({
    type: 'progress',
    message: 'Parsing roads and checking connections…',
  } satisfies ImportMessage);
  try {
    const result = importOsm(event.data.xml, event.data.options);
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
