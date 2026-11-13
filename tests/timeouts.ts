import process from 'node:process';

// TASK-171: one setting for every test and hook limit. `CITYFLOWS_TEST_TIMEOUT_MS` is the
// per-test limit (default 60 s, vite.config.ts); each limit written into a test file is passed
// through `limit`, which scales it by the same ratio. A loaded machine sets one variable
// (`CITYFLOWS_TEST_TIMEOUT_MS=240000` is four times every limit); unset, every value is as
// written.
const defaultMs = 60_000;

export const timeoutScale = Number(process.env.CITYFLOWS_TEST_TIMEOUT_MS ?? defaultMs) / defaultMs;

/** `ms` scaled by `CITYFLOWS_TEST_TIMEOUT_MS`. */
export const limit = (ms: number) => ms * timeoutScale;
