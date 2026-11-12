import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { importOsmCached } from './city-cache.ts';
import { compile } from '../src/network/index.ts';
import { transitionGeometry } from '../src/render/marking-geometry.ts';
import { distance } from '../src/geo/polyline.ts';
const phase = process.argv[2];
const result = importOsmCached(readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8'), { importerVersion: '1', drivingSide: 'right', bbox: [11.525, 48.135, 11.545, 48.148] });
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
const compiled = compile(result.city);
if (!compiled.ok) throw new Error('compile');
const net = compiled.compiled;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const road = net.roads.find(r => r.id === 'r:654')!;
const geometry = transitionGeometry(net, road);
const seam = Math.max(...geometry.lanes[3]!.right.map((p, i) => distance(p, geometry.lanes[4]!.left[i]!)));
const audit = {
  canonicalRoads: hash(result.city.roads),
  laneDriving: hash(net.lanes.map(l => ({ id: l.id, allowed: l.allowed, polyline: l.polyline, lengthM: l.lengthM, taperStartM: l.taperStartM, taperEndM: l.taperEndM }))),
  movementGeometry: hash(net.movements.map(m => ({ id: m.id, fromLane: m.fromLane, toLane: m.toLane, turn: m.turn, polyline: m.polyline }))),
  laneCount: net.lanes.length,
  movementCount: net.movements.length,
  seamGapM: seam,
};
writeFileSync(`test-results/task146/${phase}-identity.json`, JSON.stringify(audit, null, 2));
if (phase === 'after') {
  const before = JSON.parse(readFileSync('test-results/task146/before-identity.json', 'utf8'));
  for (const key of ['canonicalRoads', 'laneDriving', 'movementGeometry'])
    if (before[key] !== audit[key as keyof typeof audit]) throw new Error(`${key} changed`);
  if (seam > 0.001) throw new Error(`seam ${seam}`);
}
console.log(audit);
