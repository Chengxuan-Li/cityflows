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
  // Cinematic captures: the station discs are drawn in 2D only (`only2d`), each shape otherwise
  // the same.
  freiburg: 'dab93b9295e1d43ae67355979f1ea84ce0a036ead23a11664af3ff1aa81d71d4',
  munich: '5887e514af95b5784a69b64b010cc1330eb2d12a5dd290c172f2a7be2ec2d52e',
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
