import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { openFreiburg } from '../../bench/freiburg';
import { loadAuditCity } from '../../bench/junction-audit';
import { compile } from '../../src/network';
import { railGeometry } from '../../src/render/rail-geometry';
import type { City } from '../../src/schema';
import { limit } from '../timeouts';

// TASK-266: the level crossings' rails are cut to the roads within reach only, with the other
// roads' scanline levels kept. Every shape, to the bit, equals main 41e50d3's, which cut them to
// every ground road.
const pins = {
  // TASK-270 (lead merge): the same triangles, two level-crossing shapes list theirs in another
  // order after the gateway ids move.
  // TASK-281: one shape changes, platform 5's surface: the same 942.3 m² and bounds in another
  // triangulation, once the unreachable lots' aisles near the Hauptbahnhof are left out.
  freiburg: '39d8defbab784b9e0dddc61f3141cd7da9aae5c5c552379c460e82ed58fdc1cc',
  munich: 'f35c2fa18c1fc8c56dac4d8385c1dc65714009d42166b2d909517c85b4e3c6bf',
  // TASK-271 (lead merge): the Daimler passage road at grade is a ground road the level-crossing
  // rails are cut to.
  sindelfingen: 'b1d5677b314f0d7a4db73c301397cabe5ef79ce7e056aad6c73b5f58035c11b4',
};

for (const [name, pin] of Object.entries(pins))
  test(
    `${name}: rail geometry is unchanged`,
    async () => {
      const city: City =
        name === 'freiburg'
          ? (await openFreiburg()).city
          : loadAuditCity(name as 'munich' | 'sindelfingen');
      const result = compile(city);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
      const shapes = railGeometry(result.compiled, city);
      expect(createHash('sha256').update(JSON.stringify(shapes)).digest('hex')).toBe(pin);
    },
    limit(120_000),
  );
