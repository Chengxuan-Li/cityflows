import { segmentsIntersect } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { CompiledCity } from '../../network';
import type { City, Place } from '../../schema';
import type { Bounds } from './clip';
import type { OsmData, OsmTags } from './parse';
import { addPlace, placeConnector, polygonCenter } from './places';

type Use = 'residential' | 'commercial' | 'retail' | 'industrial';
const uses = new Set(['residential', 'commercial', 'retail', 'industrial']);
const levelsByUse: Record<Use, number> = {
  residential: 4,
  commercial: 4,
  retail: 1,
  industrial: 1,
};
const areaPerPerson: Record<Use, number> = {
  residential: 45,
  commercial: 35,
  retail: 45,
  industrial: 80,
};

function signedArea(ring: Vec2[]): number {
  return (
    ring.reduce((sum, a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      return sum + a.x * b.y - b.x * a.y;
    }, 0) / 2
  );
}

function inside(point: Vec2, ring: Vec2[]): boolean {
  let result = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < a.x + ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y)
    )
      result = !result;
  }
  return result;
}

export function clip(ring: Vec2[], bounds: Bounds): Vec2[] {
  for (const [axis, edge, greater] of [
    ['x', bounds.min.x, true],
    ['x', bounds.max.x, false],
    ['y', bounds.min.y, true],
    ['y', bounds.max.y, false],
  ] as const) {
    const output: Vec2[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      const aIn = greater ? a[axis] >= edge : a[axis] <= edge;
      const bIn = greater ? b[axis] >= edge : b[axis] <= edge;
      if (aIn) output.push(a);
      if (aIn !== bIn) {
        const t = (edge - a[axis]) / (b[axis] - a[axis]);
        output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    ring = output;
  }
  return ring;
}

// Trace the bounded faces of surface streets. Service accesses do not divide a city block.
function streetBlocks(city: City): Vec2[][] {
  const edges: { from: string; to: string; line: Vec2[]; reverse: number }[] = [];
  const groups = new Set<string>();
  for (const road of Object.values(city.roads)) {
    if (
      ['motorway', 'trunk', 'ramp', 'service'].includes(road.roadClass) ||
      city.nodes[road.from]!.layer !== 0 ||
      city.nodes[road.to]!.layer !== 0
    )
      continue;
    if (road.streetGroupId && groups.has(road.streetGroupId)) continue;
    if (road.streetGroupId) groups.add(road.streetGroupId);
    const i = edges.length;
    edges.push(
      { from: road.from, to: road.to, line: road.centerline, reverse: i + 1 },
      { from: road.to, to: road.from, line: [...road.centerline].reverse(), reverse: i },
    );
  }
  const exits = new Map<string, number[]>();
  for (const [i, edge] of edges.entries()) {
    const list = exits.get(edge.from) ?? [];
    list.push(i);
    exits.set(edge.from, list);
  }
  const heading = (i: number) => {
    const [a, b] = edges[i]!.line;
    return Math.atan2(b!.y - a!.y, b!.x - a!.x);
  };
  for (const list of exits.values()) list.sort((a, b) => heading(a) - heading(b));
  const visited = new Set<number>(),
    result: Vec2[][] = [];
  for (let start = 0; start < edges.length; start++) {
    if (visited.has(start)) continue;
    const ring: Vec2[] = [];
    let current = start;
    do {
      visited.add(current);
      const edge = edges[current]!;
      ring.push(...edge.line.slice(0, -1));
      const list = exits.get(edge.to)!;
      current = list[(list.indexOf(edge.reverse) + list.length - 1) % list.length]!;
    } while (current !== start);
    if (signedArea(ring) > 1000) result.push(ring);
  }
  return result.sort((a, b) => signedArea(a) - signedArea(b));
}

export function polygonSources(data: OsmData, accepts: (tags: OsmTags) => boolean) {
  const ways = new Map(data.way.map((way) => [way.id, way]));
  const used = new Set<number>();
  const shapes: {
    id: number;
    tag: OsmTags;
    rings: { role: 'outer' | 'inner'; ids: number[] }[];
  }[] = [];
  for (const relation of data.relation) {
    if (relation.tag.type !== 'multipolygon' || !accepts(relation.tag)) continue;
    const rings: { role: 'outer' | 'inner'; ids: number[] }[] = [];
    for (const role of ['outer', 'inner'] as const) {
      const parts = relation.member
        .filter((m) => m.type === 'way' && (m.role || 'outer') === role)
        .map((m) => ways.get(m.ref))
        .filter((w) => w !== undefined);
      const remaining = parts.map((w) => [...w.nd]);
      while (remaining.length) {
        const chain = remaining.shift()!;
        while (chain[0] !== chain.at(-1)) {
          const i = remaining.findIndex((p) => p[0] === chain.at(-1) || p.at(-1) === chain.at(-1));
          if (i < 0) break;
          const next = remaining.splice(i, 1)[0]!;
          if (next[0] !== chain.at(-1)) next.reverse();
          chain.push(...next.slice(1));
        }
        if (chain.length >= 4 && chain[0] === chain.at(-1)) rings.push({ role, ids: chain });
      }
      parts.forEach((w) => used.add(w.id));
    }
    shapes.push({ id: relation.id, tag: relation.tag, rings });
  }
  for (const way of data.way) {
    if (!used.has(way.id) && accepts(way.tag) && way.nd.length >= 4 && way.nd[0] === way.nd.at(-1))
      shapes.push({ id: way.id, tag: way.tag, rings: [{ role: 'outer', ids: way.nd }] });
  }
  return shapes;
}

function polygons(data: OsmData, positions: Map<number, Vec2>, bounds: Bounds) {
  const shapes = polygonSources(data, (tag) => Boolean(tag.building || tag.landuse));
  return shapes.flatMap(({ id, tag, rings }) => {
    const projected = rings
      .map(({ ids }) => ids.slice(0, -1).map((ref) => positions.get(ref)))
      .filter((ring): ring is Vec2[] => ring.every((p) => p !== undefined))
      .map((ring) => clip(ring, bounds))
      .filter((ring) => ring.length >= 3 && Math.abs(signedArea(ring)) > 1);
    return projected.flatMap((ring) => {
      const center = polygonCenter(ring);
      if (!center) return [];
      const area = Math.abs(signedArea(ring));
      const containers = projected.filter(
        (other) => other !== ring && Math.abs(signedArea(other)) > area && inside(center, other),
      );
      if (containers.length % 2) return [];
      const holes = projected.filter(
        (other) =>
          other !== ring &&
          Math.abs(signedArea(other)) < area &&
          inside(polygonCenter(other)!, ring) &&
          projected.filter(
            (container) =>
              Math.abs(signedArea(container)) > Math.abs(signedArea(other)) &&
              inside(polygonCenter(other)!, container),
          ).length ===
            containers.length + 1,
      );
      const netArea = area - holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
      return netArea > 1 ? [{ id, tag, ring, holes, center, area: netArea }] : [];
    });
  });
}

export function addBuildings(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  compiled: CompiledCity,
): void {
  const shapes = polygons(data, positions, bounds);
  const land = shapes.filter((s) => uses.has(s.tag.landuse ?? '')).sort((a, b) => a.area - b.area);
  const blocks = streetBlocks(city);
  const covered = new Set<(typeof land)[number]>();
  type Demand = {
    id: number;
    use: Use;
    count: number;
    center: Vec2;
    ring: Vec2[];
    block: number;
    land: number | undefined;
    inferred: string[];
  };
  const demand: Demand[] = [];
  for (const shape of shapes) {
    const { tag, center, area } = shape;
    const building = tag.building;
    if (
      !building ||
      tag.amenity === 'parking' ||
      tag.amenity === 'school' ||
      tag.railway === 'station'
    )
      continue;
    const plot = land.find(
      (l) => inside(center, l.ring) && !l.holes.some((h) => inside(center, h)),
    );
    let use: Use | undefined;
    if (
      ['apartments', 'residential', 'house', 'detached', 'dormitory', 'terrace'].includes(building)
    )
      use = 'residential';
    else if (['office', 'commercial', 'hotel'].includes(building)) use = 'commercial';
    else if (building === 'retail') use = 'retail';
    else if (['industrial', 'warehouse'].includes(building)) use = 'industrial';
    else if (building === 'yes') use = (plot?.tag.landuse as Use | undefined) ?? 'residential';
    if (!use) continue;
    const taggedLevels = Number(tag['building:levels']);
    const defaultLevels = ['house', 'detached', 'terrace'].includes(building)
      ? 2
      : levelsByUse[use];
    const levels =
      Number.isFinite(taggedLevels) && taggedLevels > 0 && taggedLevels <= 200
        ? taggedLevels
        : defaultLevels;
    demand.push({
      id: shape.id,
      use,
      count: (area * levels) / areaPerPerson[use],
      center,
      ring: shape.ring,
      block: blocks.findIndex((ring) => inside(center, ring)),
      land: plot ? land.indexOf(plot) : undefined,
      inferred: [
        'occupancy',
        ...(levels === taggedLevels ? [] : ['building:levels']),
        ...(building === 'yes' ? ['buildingUse'] : []),
      ],
    });
    if (plot) covered.add(plot);
  }
  // Land use supplies demand only where no usable footprint is mapped, avoiding double counting.
  for (const plot of land) {
    if (covered.has(plot)) continue;
    const use = plot.tag.landuse as Use;
    demand.push({
      id: plot.id,
      use,
      count: (plot.area * 0.35 * levelsByUse[use]) / areaPerPerson[use],
      center: plot.center,
      ring: plot.ring,
      block: blocks.findIndex((ring) => inside(plot.center, ring)),
      land: land.indexOf(plot),
      inferred: ['footprintCoverage', 'building:levels', 'occupancy'],
    });
  }
  const groups: Demand[][] = [];
  const streets = Object.values(city.roads)
    .filter((r) => r.roadClass !== 'service')
    .flatMap((r) => r.centerline.slice(1).map((b, i) => [r.centerline[i]!, b] as const));
  for (const item of demand) {
    const group = groups.find(
      (g) =>
        g[0]!.use === item.use &&
        (item.block >= 0
          ? g[0]!.block === item.block
          : g[0]!.block < 0 &&
            ((item.land !== undefined && item.land === g[0]!.land) ||
              g.some(
                (other) =>
                  Math.hypot(item.center.x - other.center.x, item.center.y - other.center.y) <
                    100 &&
                  !streets.some(([a, b]) => segmentsIntersect(item.center, other.center, a, b)),
              ))),
    );
    if (group) group.push(item);
    else groups.push([item]);
  }
  const connector = placeConnector(city, compiled);
  for (const group of groups) {
    const first = group[0]!;
    const total = group.reduce((sum, item) => sum + item.count, 0);
    const count = Math.round(total);
    if (count === 0) continue;
    const center = {
      x: group.reduce((s, d) => s + d.center.x * d.count, 0) / total,
      y: group.reduce((s, d) => s + d.center.y * d.count, 0) / total,
    };
    const kind: Place['kind'] =
      first.use === 'residential' ? 'residential' : first.use === 'retail' ? 'retail' : 'work';
    const shape: Place['shape'] =
      first.block >= 0
        ? { kind: 'polygon', ring: blocks[first.block]! }
        : group.length === 1
          ? { kind: 'polygon', ring: first.ring }
          : { kind: 'point', pos: center };
    const place = addPlace(
      city,
      kind,
      kind === 'residential'
        ? 'Homes'
        : first.use === 'industrial'
          ? 'Industry'
          : kind === 'retail'
            ? 'Shops'
            : 'Workplaces',
      shape,
      {
        source: 'osm',
        osmIds: [...new Set(group.map((d) => d.id))].sort((a, b) => a - b),
        inferred: [
          ...new Set(group.flatMap((d) => d.inferred)),
          'population',
          'jobs',
          'blockAggregation',
          'connectedLane',
        ],
      },
    );
    place.population = kind === 'residential' ? count : 0;
    place.jobs = kind === 'residential' ? 0 : count;
    place.connectors.push(connector(center));
  }
}
