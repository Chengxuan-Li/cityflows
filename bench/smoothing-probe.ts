import { registerHooks } from 'node:module';
import process from 'node:process';

// Isolate B30: always bypass the later realignment pass, and optionally smoothing.
// node --experimental-strip-types --import ./bench/register.ts ./bench/smoothing-probe.ts --skip-smoothing --output=before.json
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.endsWith('/src/importers/osm/index.ts')) {
      if (
        !String(result.source).includes('  realignRoads(') ||
        !String(result.source).includes('  smoothRoads(')
      )
        throw new Error('Import pass call sites changed; cannot isolate smoothing');
      let source = String(result.source).replace('  realignRoads(', '  if (false) realignRoads(');
      if (process.argv.includes('--skip-smoothing'))
        source = source.replace('  smoothRoads(', '  if (false) smoothRoads(');
      return { ...result, source };
    }
    return result;
  },
});
await import('./zone-probe');
