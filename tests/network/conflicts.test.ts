import { expect, it } from 'vitest';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { compile } from '../../src/network';

it('detects opposing crossing and convergent movements, except from one source lane', () => {
  const city = signalApproach();
  const center = Object.values(city.nodes).find((n) => n.control === 'signal')!;
  center.control = 'yield';
  center.signal = null;
  const inbound = Object.values(city.roads).filter((r) => r.to === center.id);
  const west = inbound.find((r) => r.centerline[0]!.x < center.pos.x)!;
  const east = inbound.find((r) => r.centerline[0]!.x > center.pos.x)!;
  const south = inbound.find((r) => r.centerline[0]!.y > center.pos.y)!;
  const north = inbound.find((r) => r.centerline[0]!.y < center.pos.y)!;
  west.roadClass = 'primary';
  east.roadClass = 'secondary';
  center.minorRoads = [east.id];
  const northOut = Object.values(city.roads).find(
    (r) => r.from === center.id && r.to === north.from,
  )!;
  const eastOut = Object.values(city.roads).find(
    (r) => r.from === center.id && r.to === east.from,
  )!;
  // An extra lane pair in the same direction gives two through movements from lane 0.
  center.turnRules.push({
    from: west.id,
    to: eastOut.id,
    fromLane: 0,
    toLane: 1,
    allowed: true,
    provenance: center.provenance,
  });
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { movements, index } = result.compiled;
  const get = (from: string, to: string, a = 0, b = 0) =>
    movements[index.movement.get(`${from}#${a}>${to}#${b}`)!]!;
  const left = get(west.id, northOut.id);
  const through = movements.find((m) => m.id.startsWith(east.id + '#0>') && m.turn === 'through')!;
  const converging = get(south.id, northOut.id);
  expect(left.conflicts).toContain(through.idx);
  expect(through.conflicts).toContain(left.idx);
  expect(left.conflicts).toContain(converging.idx);
  expect(get(west.id, eastOut.id).conflicts).not.toContain(get(west.id, eastOut.id, 0, 1).idx);
  expect(left.priority).toBe(61);
  expect(through.priority).toBe(2);
  expect(get(west.id, eastOut.id).priority).toBe(62);
  center.minorRoads = [];
  const inferred = compile(city);
  if (!inferred.ok) throw new Error(JSON.stringify(inferred.diagnostics));
  expect(inferred.compiled.movements[through.idx]!.priority).toBe(2);
});
