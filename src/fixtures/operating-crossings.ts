import { buildCity } from './build-city';

/** A mapped, served crossing with ample visible approach and departure storage. */
export function operatingCrossing(kind: 'rail' | 'tram' = 'rail') {
  const { city, node, road, place } = buildCity('Operating crossing', 136);
  const west = node(-400, 0),
    east = node(400, 0);
  const forward = road(west, east),
    backward = road(east, west);
  forward.provenance = backward.provenance = { source: 'generated', osmIds: [10] };
  place('Homes', 'residential', { x: -380, y: 15 }, [
    { road: forward, direction: 'out', positionM: 20 },
  ]);
  place('Work', 'work', { x: 380, y: 15 }, [{ road: forward, direction: 'in', positionM: 780 }]);
  city.rail = {
    nodes: {
      'rn:1': { id: 'rn:1', pos: { x: 0, y: -1000 }, kind: 'plain', layer: 0 },
      'rn:2': {
        id: 'rn:2',
        pos: { x: 0, y: 0 },
        kind: 'level_crossing',
        layer: 0,
        crossing: { kind, roadOsmIds: [10] },
      },
      'rn:3': { id: 'rn:3', pos: { x: 0, y: 1000 }, kind: 'plain', layer: 0 },
    },
    tracks: {
      'rt:1': {
        id: 'rt:1',
        from: 'rn:1',
        to: 'rn:2',
        line: [
          { x: 0, y: -1000 },
          { x: 0, y: 0 },
        ],
        layer: 0,
        kind,
        maxSpeedMps: 10,
        preferredDirection: 'forward',
      },
      'rt:2': {
        id: 'rt:2',
        from: 'rn:2',
        to: 'rn:3',
        line: [
          { x: 0, y: 0 },
          { x: 0, y: 1000 },
        ],
        layer: 0,
        kind,
        maxSpeedMps: 10,
        preferredDirection: 'forward',
      },
    },
    platforms: {},
  };
  return city;
}
