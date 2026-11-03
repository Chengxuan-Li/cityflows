import { buildCity, generated } from './build-city';

export function ramp(seed = 1) {
  const { city, node, road, place } = buildCity('Motorway ramps', seed);
  const merge = node(0, 0);
  const exit = node(250, 0);
  const motorway = { roadClass: 'motorway', speedKmh: 100, lanes: 2 } as const;
  const slip = { roadClass: 'ramp', speedKmh: 60 } as const;
  const upstream = road(node(-160, 0), merge, motorway);
  const mainline = road(merge, exit, motorway);
  const downstream = road(exit, node(410, 0), motorway);
  const on = road(node(-100, 30), merge, slip);
  const off = road(exit, node(350, 30), slip);
  merge.turnRules.push({
    from: on.id,
    to: mainline.id,
    toLane: 0,
    allowed: false,
    provenance: generated,
  });
  exit.turnRules.push({
    from: mainline.id,
    to: off.id,
    fromLane: 0,
    allowed: false,
    provenance: generated,
  });
  place('Ramp entrance', 'residential', { x: -95, y: 35 }, [
    { road: on, direction: 'out' },
    { road: upstream, direction: 'out' },
  ]);
  place('Ramp exit', 'work', { x: 340, y: 35 }, [
    { road: off, direction: 'in', positionM: 65 },
    { road: downstream, direction: 'in', positionM: 85 },
  ]);
  return city;
}
