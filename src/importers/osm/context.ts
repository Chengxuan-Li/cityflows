import {
  parallelOffset,
  pointInPolygon,
  polylineCrossings,
  polylineLength,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { Diagnostic } from '../../network';
import type { ContextArea, ContextFeature, ContextLine, RoofShape } from '../../schema';
import { clip, polygonSources } from './buildings';
import { clipPart, type Bounds } from './clip';
import type { OsmData, OsmTags } from './parse';
import { surfaceLot } from './lots';

function areaClass(tag: OsmTags): ContextArea | undefined {
  if (tag.building && tag.building !== 'no') return 'building';
  if (
    tag.natural === 'water' ||
    tag.waterway === 'riverbank' ||
    ['reservoir', 'basin'].includes(tag.landuse ?? '')
  )
    return 'water';
  if (
    ['park', 'garden', 'pitch', 'playground'].includes(tag.leisure ?? '') ||
    [
      'grass',
      'meadow',
      'forest',
      'recreation_ground',
      'village_green',
      'allotments',
      'cemetery',
    ].includes(tag.landuse ?? '') ||
    ['wood', 'scrub', 'grassland'].includes(tag.natural ?? '')
  )
    return 'green';
  if (
    ['residential', 'commercial', 'retail', 'industrial', 'railway', 'construction'].includes(
      tag.landuse ?? '',
    )
  )
    return 'landuse';
  if (tag.amenity === 'parking') return 'parking';
}

function lineClass(tag: OsmTags): ContextLine | undefined {
  if (tag.natural === 'tree_row') return 'tree_row';
  if (tag.tunnel === 'yes' && Number(tag.layer) < 0) return;
  if (['rail', 'light_rail', 'subway', 'narrow_gauge'].includes(tag.railway ?? '')) return 'rail';
  if (tag.railway === 'tram') return 'tram';
  if (['river', 'stream', 'canal'].includes(tag.waterway ?? '')) return 'waterway';
}

// Douglas-Peucker, including closed rings (whose first split is the farthest vertex).
function simplify(points: Vec2[]): Vec2[] {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]);
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const a = points[first!]!,
      b = points[last!]!;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length2 = dx * dx + dy * dy;
    let maximum = 0.3 ** 2,
      split = -1;
    for (let i = first! + 1; i < last!; i++) {
      const p = points[i]!;
      const t = length2
        ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
        : 0;
      const distance2 = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
      if (distance2 > maximum) {
        maximum = distance2;
        split = i;
      }
    }
    if (split >= 0) {
      keep.add(split);
      stack.push([first!, split], [split, last!]);
    }
  }
  return points.filter((_, i) => keep.has(i));
}

const area = (ring: Vec2[]) =>
  Math.abs(
    ring.reduce((sum, a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      return sum + a.x * b.y - b.x * a.y;
    }, 0) / 2,
  );

function measurement(value: string | undefined, allowZero = false): number | undefined {
  if (!value) return;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(m|ft|')?\s*$/.exec(value);
  if (!match) return;
  const n = Number(match[1]) * (match[2] === 'ft' || match[2] === "'" ? 0.3048 : 1);
  return Number.isFinite(n) && (n > 0 || (allowZero && n === 0)) ? n : undefined;
}

const roofShapes = new Set<RoofShape>([
  'flat',
  'gabled',
  'hipped',
  'pyramidal',
  'skillion',
  'mansard',
  'gambrel',
  'half-hipped',
  'round',
  'dome',
  'onion',
]);
const namedColours: Record<string, string> = {
  black: '#000000',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  white: '#ffffff',
  maroon: '#800000',
  red: '#ff0000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  green: '#008000',
  lime: '#00ff00',
  olive: '#808000',
  yellow: '#ffff00',
  navy: '#000080',
  blue: '#0000ff',
  teal: '#008080',
  aqua: '#00ffff',
  orange: '#ffa500',
  brown: '#a52a2a',
  beige: '#f5f5dc',
  tan: '#d2b48c',
  pink: '#ffc0cb',
  gold: '#ffd700',
  darkred: '#8b0000',
  darkgreen: '#006400',
  darkblue: '#00008b',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  lightblue: '#add8e6',
  lightgreen: '#90ee90',
  lightyellow: '#ffffe0',
  salmon: '#fa8072',
  darksalmon: '#e9967a',
  coral: '#ff7f50',
  bisque: '#ffe4c4',
  ivory: '#fffff0',
  whitesmoke: '#f5f5f5',
  gainsboro: '#dcdcdc',
  chocolate: '#d2691e',
  sienna: '#a0522d',
  saddlebrown: '#8b4513',
  firebrick: '#b22222',
  rosybrown: '#bc8f8f',
  slategray: '#708090',
  slategrey: '#708090',
};

function colour(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return;
  if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized;
  if (/^#[0-9a-f]{3}$/.test(normalized))
    return '#' + [...normalized.slice(1)].map((c) => c + c).join('');
  return Object.hasOwn(namedColours, normalized) ? namedColours[normalized] : undefined;
}

function nonnegativeMeasurement(value: string | undefined): number | undefined {
  return measurement(value, true);
}

function direction(value: string | undefined): number | undefined {
  if (!value?.trim()) return;
  const compass = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  const index = compass.indexOf(value.trim().toUpperCase());
  if (index >= 0) return index * 22.5;
  const degrees = Number(value);
  return Number.isFinite(degrees) ? ((degrees % 360) + 360) % 360 : undefined;
}

function buildingDetails(
  tag: OsmTags,
  mappedShapes: Map<string, { shape: RoofShape; count: number }>,
) {
  const colourValue = colour(tag['building:colour']);
  const material = tag['building:material']?.trim().toLowerCase();
  const minLevel = nonnegativeMeasurement(tag['building:min_level']);
  const minHeightM =
    nonnegativeMeasurement(tag.min_height) ??
    (minLevel !== undefined ? minLevel * 3 : tag.building === 'roof' ? 3 : undefined);
  const rawShape = tag['roof:shape']?.trim().toLowerCase();
  let shape: RoofShape = 'flat';
  if (rawShape) {
    if (roofShapes.has(rawShape as RoofShape)) shape = rawShape as RoofShape;
    else {
      shape =
        rawShape === 'quadruple_saltbox' ? 'hipped' : rawShape === 'saltbox' ? 'gabled' : 'flat';
      const previous = mappedShapes.get(rawShape);
      mappedShapes.set(rawShape, { shape, count: (previous?.count ?? 0) + 1 });
    }
  }
  const heightM = nonnegativeMeasurement(tag['roof:height']);
  const levels = nonnegativeMeasurement(tag['roof:levels']);
  const roofColour = colour(tag['roof:colour']);
  const roofMaterial = tag['roof:material']?.trim().toLowerCase();
  const orientation = tag['roof:orientation'];
  const directionDeg = direction(tag['roof:direction']);
  const details: Omit<NonNullable<Extract<ContextFeature, { kind: 'area' }>['roof']>, 'shape'> = {
    ...(heightM !== undefined && { heightM }),
    ...(levels !== undefined && { levels }),
    ...(roofColour && { colour: roofColour }),
    ...(roofMaterial && { material: roofMaterial }),
    ...((orientation === 'along' || orientation === 'across') && { orientation }),
    ...(directionDeg !== undefined && { directionDeg }),
  };
  return {
    ...(rawShape || Object.keys(details).length ? { roof: { shape, ...details } } : {}),
    ...(colourValue && { colour: colourValue }),
    ...(material && { material }),
    ...(minHeightM !== undefined && { minHeightM }),
  };
}

export function importContext(
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  diagnostics: Diagnostic[] = [],
  omitLots = false,
): ContextFeature[] {
  // Snap inward at the boundary: every serialized tenth of a metre remains in the bbox.
  const snapped: Bounds = {
    min: { x: Math.ceil(bounds.min.x * 10) / 10, y: Math.ceil(bounds.min.y * 10) / 10 },
    max: { x: Math.floor(bounds.max.x * 10) / 10, y: Math.floor(bounds.max.y * 10) / 10 },
  };
  const round = (line: Vec2[]) =>
    simplify(line)
      .map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }))
      .filter((p, i, a) => !i || p.x !== a[i - 1]!.x || p.y !== a[i - 1]!.y);
  const features: ContextFeature[] = [];
  const mappedShapes = new Map<string, { shape: RoofShape; count: number }>();
  for (const node of data.node) {
    const lamp = node.tag.highway === 'street_lamp';
    if (!lamp && node.tag.natural !== 'tree') continue;
    const p = positions.get(node.id);
    if (
      !p ||
      p.x < snapped.min.x ||
      p.y < snapped.min.y ||
      p.x > snapped.max.x ||
      p.y > snapped.max.y
    )
      continue;
    const pos = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
    const heightM = measurement(node.tag.height),
      crownM = lamp ? undefined : measurement(node.tag.diameter_crown);
    const sub = lamp ? (node.tag.lamp_mount ?? node.tag.support) : node.tag.leaf_type;
    features.push({
      kind: 'point',
      class: lamp ? 'street_lamp' : 'tree',
      pos,
      ...(heightM !== undefined && { heightM }),
      ...(crownM !== undefined && { crownM }),
      ...(sub && { sub }),
    });
  }
  for (const source of polygonSources(data, (tag) => areaClass(tag) !== undefined)) {
    if (omitLots && surfaceLot(source.tag)) continue;
    const projected = source.rings.flatMap(({ role, ids }) => {
      const ring = ids.slice(0, -1).map((id) => positions.get(id));
      return ring.every((p): p is Vec2 => p !== undefined) ? [{ role, ring }] : [];
    });
    const outers = projected.filter((r) => r.role === 'outer');
    const innerOwners = projected
      .filter((r) => r.role === 'inner')
      .map(({ ring }) => ({
        ring,
        owner: outers
          .filter((outer) => pointInPolygon(ring[0]!, [...outer.ring, outer.ring[0]!]))
          .sort((a, b) => area(a.ring) - area(b.ring))[0],
      }));
    const close = (ring: Vec2[]) => {
      const clipped = clip(ring, snapped);
      if (clipped.length < 3) return;
      const points = round([...clipped, clipped[0]!]);
      return points.length >= 4 && area(points) >= 4 ? points : undefined;
    };
    for (const shape of outers) {
      const outer = close(shape.ring);
      if (!outer) continue;
      const holes = innerOwners
        .filter((inner) => inner.owner === shape)
        .map((inner) => close(inner.ring))
        .filter((ring): ring is Vec2[] => !!ring);
      if (area(outer) - holes.reduce((sum, hole) => sum + area(hole), 0) < 4) continue;
      const tag = source.tag;
      const kind = areaClass(tag)!;
      const sub =
        kind === 'building'
          ? tag.building
          : kind === 'parking'
            ? tag.parking
            : (tag.landuse ?? tag.natural ?? tag.leisure ?? tag.waterway);
      const heightM = kind === 'building' ? measurement(tag.height) : undefined;
      const levels = kind === 'building' ? measurement(tag['building:levels']) : undefined;
      features.push({
        kind: 'area',
        class: kind,
        rings: [outer, ...holes],
        ...(sub && { sub }),
        ...(heightM !== undefined && { heightM }),
        ...(levels !== undefined && { levels }),
        ...(kind === 'building' && buildingDetails(tag, mappedShapes)),
      });
    }
  }
  const wooded = features.filter(
    (f): f is Extract<ContextFeature, { kind: 'area' }> =>
      f.kind === 'area' &&
      f.class === 'green' &&
      ['wood', 'forest', 'scrub', 'park'].includes(f.sub ?? ''),
  );
  for (const way of data.way) {
    const kind = lineClass(way.tag);
    const path = ['footway', 'path', 'cycleway', 'pedestrian', 'steps', 'track'].includes(
      way.tag.highway ?? '',
    );
    if (!kind && !path) continue;
    // Missing nodes break a line rather than drawing a fabricated bridge across the gap.
    let run: Vec2[] = [];
    const flush = () => {
      for (const part of clipPart(
        run.map((pos, i) => ({ key: String(i), pos })),
        snapped,
        'context',
        new Set(),
      )) {
        const line = round(part.points.map((point) => point.pos));
        if (line.length < 2 || polylineLength(line) < 2) continue;
        const widthM = measurement(way.tag.width);
        if (path) {
          if (
            !wooded.some(
              (area) =>
                line.some((p) => pointInPolygon(p, area.rings[0]!)) ||
                polylineCrossings(line, area.rings[0]!).length > 0,
            )
          )
            continue;
          const width = widthM ?? (way.tag.highway === 'pedestrian' ? 3 : 2);
          const ring = round(
            clip(
              [...parallelOffset(line, -width / 2), ...parallelOffset(line, width / 2).reverse()],
              snapped,
            ),
          );
          if (ring.length >= 3)
            features.push({
              kind: 'area',
              class: 'landuse',
              sub: 'path',
              rings: [[...ring, ring[0]!]],
            });
          continue;
        }
        const spacing = kind === 'tree_row' ? measurement(way.tag.spacing) : undefined;
        const spacingM = spacing !== undefined && spacing >= 2 ? spacing : undefined;
        const layer = way.tag.layer === undefined ? undefined : Number(way.tag.layer);
        features.push({
          kind: 'line',
          class: kind!,
          line,
          ...(widthM !== undefined && { widthM }),
          ...(spacingM !== undefined && { spacingM }),
          ...(Number.isInteger(layer) && { layer }),
        });
      }
      run = [];
    };
    for (const id of way.nd) {
      const p = positions.get(id);
      if (p) run.push(p);
      else flush();
    }
    flush();
  }
  for (const [shape, mapped] of mappedShapes)
    diagnostics.push({
      severity: 'warning',
      code: 'osm_unsupported_tag',
      refs: [],
      message: `Mapped ${mapped.count} building roofs from ${shape} to ${mapped.shape}`,
    });
  return features;
}
