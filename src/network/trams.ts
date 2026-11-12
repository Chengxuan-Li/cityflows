import type { RailGraph } from './rail';
import { buildTimetable, trainTimetable, type TrainTimetable } from './trains';

export const buildTramTimetable = (rail: RailGraph) => buildTimetable(rail, 'tram');
const trams = new WeakMap<RailGraph, TrainTimetable>();
const combined = new WeakMap<RailGraph, TrainTimetable>();
export function tramTimetable(rail: RailGraph): TrainTimetable {
  let table = trams.get(rail);
  if (!table) {
    table = buildTramTimetable(rail);
    trams.set(rail, table);
  }
  return table;
}

/** Both services keep their real cadence; train route indices remain unchanged. */
export function railTimetable(rail: RailGraph): TrainTimetable {
  let table = combined.get(rail);
  if (table) return table;
  const train = trainTimetable(rail),
    tram = tramTimetable(rail);
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const periodS = (train.periodS * tram.periodS) / gcd(train.periodS, tram.periodS);
  const departures: TrainTimetable['departures'] = [];
  for (const [source, offset] of [
    [train, 0],
    [tram, train.routes.length],
  ] as const)
    for (let cycle = 0; cycle < periodS / source.periodS; cycle++)
      for (const d of source.departures)
        departures.push({
          route: d.route + offset,
          timeS: d.timeS + cycle * source.periodS,
          requestedS: d.requestedS + cycle * source.periodS,
        });
  table = {
    routes: [...train.routes, ...tram.routes],
    periodS,
    departures,
    unused: train.unused.filter((id) => tram.unused.includes(id)),
    hash: `${train.hash}/${tram.hash}`,
  };
  combined.set(rail, table);
  return table;
}

export function tramCensus(rail: RailGraph, table = tramTimetable(rail)) {
  const served = new Set(table.routes.flatMap((r) => r.stops.map((s) => s.platform)));
  return {
    synthetic: true,
    hash: table.hash,
    periodS: table.periodS,
    routes: table.routes.map((r, i) => ({
      id: r.id,
      destination: r.destination,
      sections: r.sections.map((s) => rail.tracks[s.track]!.id),
      stops: r.stops.map((s) => ({ id: s.platform, name: s.name, arrivalS: s.arrivalS })),
      perHour: (table.departures.filter((d) => d.route === i).length * 3600) / table.periodS,
    })),
    servedStops: [...served],
    unservedStops: (rail.tramStops ?? [])
      .filter((s) => !served.has(s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        reason: 'No connected boundary service through mapped halt',
      })),
    usedSections: rail.tracks.filter((t) => t.kind === 'tram' && !table.unused.includes(t.id))
      .length,
    unusedSections: rail.tracks
      .filter((t) => t.kind === 'tram' && table.unused.includes(t.id))
      .map((t) => ({
        id: t.id,
        reason: t.service ? 'Service/depot track' : 'No permitted connected boundary path',
      })),
  };
}
