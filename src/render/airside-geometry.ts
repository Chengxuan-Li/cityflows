import { areaD, EndType, FillRule, inflatePathsD, JoinType, unionD } from 'clipper2-ts';
import { pointInPolygon } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { Airport, Runway } from '../schema/airport';

/** TASK-295: a paved airside area, outer ring then holes, open. */
export interface AirsideArea {
  kind: 'apron' | 'taxiway' | 'runway';
  rings: Vec2[][];
}

export function runwayCentreline(airport: Airport, runway: Runway): Vec2[] {
  return runway.edges.flatMap((id, i) => airport.edges[id]!.line.slice(i ? 1 : 0));
}

/** Outer rings with the holes inside each (Clipper's outers wind positive). */
function polygons(paths: Vec2[][]): Vec2[][][] {
  const outers = paths.filter((p) => areaD(p) > 0).sort((a, b) => areaD(a) - areaD(b));
  const shapes = outers.map((outer) => [outer]);
  for (const hole of paths.filter((p) => areaD(p) < 0)) {
    const i = outers.findIndex((outer) => pointInPolygon(hole[0]!, [...outer, outer[0]!]));
    if (i >= 0) shapes[i]!.push(hole);
  }
  return shapes.map((rings) => rings.map((ring) => ring.map(({ x, y }) => ({ x, y }))));
}

/** The airside drawn as surfaces, bottom first: mapped aprons and paved areas, then the taxi
 * network at its widths (taxiways and taxilanes, round ends; stand lead-ins are paint on the apron,
 * TASK-297), then each runway along its centreline from end to end with its stopways (square
 * ends). All at grade 0. */
export function airsideAreas(airport: Airport): AirsideArea[] {
  const cached = drawn.get(airport);
  if (cached) return cached;
  const areas: AirsideArea[] = airport.surfaces
    .filter((s) => s.kind !== 'helipad')
    .map((s) => ({ kind: 'apron', rings: s.rings }));
  const taxi = Object.values(airport.edges).filter(
    (e) => e.kind === 'taxiway' || e.kind === 'taxilane',
  );
  const byWidth = new Map<number, Vec2[][]>();
  for (const edge of taxi) {
    const lines = byWidth.get(edge.widthM);
    if (lines) lines.push(edge.line);
    else byWidth.set(edge.widthM, [edge.line]);
  }
  const taxiPaths = [...byWidth].flatMap(([width, lines]) =>
    inflatePathsD(lines, width / 2, JoinType.Round, EndType.Round, 2, 2),
  );
  if (taxiPaths.length)
    for (const rings of polygons(unionD(taxiPaths, FillRule.NonZero)))
      areas.push({ kind: 'taxiway', rings });
  const onRunway = new Set<string>();
  const runwayPaths = Object.values(airport.runways).flatMap((runway) => {
    runway.edges.forEach((id) => onRunway.add(id));
    const line = runwayCentreline(airport, runway);
    return [line, ...runway.stopways].flatMap((path) =>
      inflatePathsD([path], runway.widthM / 2, JoinType.Miter, EndType.Butt, 2, 2),
    );
  });
  for (const edge of Object.values(airport.edges))
    if (edge.kind === 'runway' && !onRunway.has(edge.id))
      runwayPaths.push(
        ...inflatePathsD([edge.line], edge.widthM / 2, JoinType.Miter, EndType.Butt, 2, 2),
      );
  if (runwayPaths.length)
    for (const rings of polygons(unionD(runwayPaths, FillRule.NonZero)))
      areas.push({ kind: 'runway', rings });
  drawn.set(airport, areas);
  return areas;
}
const drawn = new WeakMap<Airport, AirsideArea[]>();
