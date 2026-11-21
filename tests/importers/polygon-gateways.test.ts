import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';

// TASK-270: polygon gateways that route (TASK-259's D7).

const square: [number, number][] = [
  [-0.001, -0.001],
  [0.001, -0.001],
  [0.001, 0.001],
  [-0.001, 0.001],
];

test('a polygon gateway is made only where its lanes reach the public network', () => {
  // Main crosses the ring both sides round a block of public streets. Pocket enters from the
  // north and joins the block only through Gate, a destination street: no car may drive through
  // it, so Pocket's cut end would be a gateway no route reaches (Lübeck's Wallstraße).
  const osm = `<osm>
    <node id="1" lat="0" lon="-0.003"/><node id="2" lat="0" lon="-0.0005"/>
    <node id="3" lat="0" lon="0.0005"/><node id="4" lat="0" lon="0.003"/>
    <node id="5" lat="0.0005" lon="-0.0005"/><node id="6" lat="0.0005" lon="0.0005"/>
    <node id="7" lat="0.003" lon="0.0005"/><node id="8" lat="0.0008" lon="0.0005"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><tag k="highway" v="primary"/><tag k="name" v="Main"/></way>
    <way id="11"><nd ref="2"/><nd ref="5"/><nd ref="6"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="name" v="Block"/></way>
    <way id="12"><nd ref="7"/><nd ref="8"/><tag k="highway" v="secondary"/><tag k="name" v="Pocket"/></way>
    <way id="13"><nd ref="8"/><nd ref="6"/><tag k="highway" v="residential"/><tag k="name" v="Gate"/><tag k="access" v="destination"/></way>
  </osm>`;
  const result = importOsm(osm, { importerVersion: 'test', polygon: square });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { city } = result;
  expect(Object.values(city.roads).some((r) => r.name === 'Pocket')).toBe(true);
  const gateways = Object.values(city.places).filter((p) => p.kind === 'gateway');
  expect(gateways.map((g) => g.provenance.osmIds)).toEqual([[10], [10]]);
  expect(compile(city).ok).toBe(true);
});

test.each(['roundabout', 'circular'])(
  'a polygon ring takes in a %s it crosses whole, with entries on its arms',
  (junction) => {
    // An eight-node roundabout of radius about 22 m centred 0.0008° east; the ring's east edge at
    // 0.00085° crosses it east of its centre (Cambridge's Newmarket Road roundabout, mapped `junction=circular`).
    const centre = { lon: 0.0008, lat: 0 };
    const r = 0.0002;
    const ringNodes = Array.from({ length: 8 }, (_, k) => {
      const angle = (k * Math.PI) / 4;
      const lon = centre.lon + r * Math.cos(angle);
      const lat = centre.lat + r * Math.sin(angle);
      return `<node id="${100 + k}" lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"/>`;
    });
    const osm = `<osm>
    ${ringNodes.join('')}
    <node id="1" lat="0" lon="-0.003"/><node id="2" lat="0" lon="0.004"/>
    <node id="3" lat="0.003" lon="0.0008"/><node id="4" lat="-0.003" lon="0.0008"/>
    <way id="20"><nd ref="100"/><nd ref="101"/><nd ref="102"/><nd ref="103"/><nd ref="104"/><nd ref="105"/><nd ref="106"/><nd ref="107"/><nd ref="100"/>
      <tag k="highway" v="primary"/><tag k="junction" v="${junction}"/><tag k="name" v="Circus"/></way>
    <way id="21"><nd ref="1"/><nd ref="104"/><tag k="highway" v="primary"/><tag k="name" v="West"/></way>
    <way id="22"><nd ref="100"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="name" v="East"/></way>
    <way id="23"><nd ref="3"/><nd ref="102"/><tag k="highway" v="tertiary"/><tag k="name" v="North"/></way>
    <way id="24"><nd ref="106"/><nd ref="4"/><tag k="highway" v="tertiary"/><tag k="name" v="South"/></way>
  </osm>`;
    const polygon: [number, number][] = [
      [-0.001, -0.001],
      [0.00085, -0.001],
      [0.00085, 0.001],
      [-0.001, 0.001],
    ];
    const result = importOsm(osm, { importerVersion: 'test', polygon });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const { city } = result;
    const length = (points: { x: number; y: number }[]) =>
      points
        .slice(1)
        .reduce((sum, p, i) => sum + Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y), 0);
    const circus = Object.values(city.roads).filter((road) => road.name === 'Circus');
    // The whole octagon, about 136 m, one way round.
    const perimeter = 8 * 2 * 22.24 * Math.sin(Math.PI / 8);
    expect(circus.reduce((sum, road) => sum + length(road.centerline), 0)).toBeGreaterThan(
      0.9 * perimeter,
    );
    const gateways = Object.values(city.places).filter((p) => p.kind === 'gateway');
    expect(gateways.some((g) => g.provenance.osmIds!.includes(20))).toBe(false);
    const east = gateways.find((g) => g.provenance.osmIds!.includes(22))!;
    expect(east.connectors.map((c) => c.direction).sort()).toEqual(['in', 'out']);
    // Cut on the kept circle, 30 m past the roundabout's nodes.
    const centreLocal = circus
      .flatMap((road) => road.centerline)
      .reduce((sum, p, _, all) => ({ x: sum.x + p.x / all.length, y: sum.y + p.y / all.length }), {
        x: 0,
        y: 0,
      });
    if (east.shape.kind !== 'point') throw new Error('gateway shape');
    const distance = Math.hypot(east.shape.pos.x - centreLocal.x, east.shape.pos.y - centreLocal.y);
    expect(distance).toBeGreaterThan(45);
    expect(distance).toBeLessThan(60);
  },
);

test('a roundabout that goes on outside the extract is cut where its ways stop', () => {
  // Overpass returns only ways that touch the ring: here the roundabout's east arc (101 back to
  // 107 through 100) is missing, so its way stops outside the ring at 101 and 107, as Newmarket
  // Road's gyratory does. Both ends are cut, and the roundabout's own way is the entry there.
  const r = 0.0002;
  const node = (k: number) => {
    const angle = (k * Math.PI) / 4;
    return `<node id="${100 + k}" lat="${(r * Math.sin(angle)).toFixed(7)}" lon="${(0.0008 + r * Math.cos(angle)).toFixed(7)}"/>`;
  };
  const osm = `<osm>
    ${[1, 2, 3, 4, 5, 6, 7].map(node).join('')}
    <node id="1" lat="0" lon="-0.003"/><node id="3" lat="0.003" lon="0.0008"/><node id="4" lat="-0.003" lon="0.0008"/>
    <way id="20"><nd ref="101"/><nd ref="102"/><nd ref="103"/><nd ref="104"/><nd ref="105"/><nd ref="106"/><nd ref="107"/>
      <tag k="highway" v="primary"/><tag k="junction" v="circular"/><tag k="oneway" v="yes"/><tag k="name" v="Circus"/></way>
    <way id="21"><nd ref="1"/><nd ref="104"/><tag k="highway" v="primary"/><tag k="name" v="West"/></way>
    <way id="23"><nd ref="3"/><nd ref="102"/><tag k="highway" v="tertiary"/><tag k="name" v="North"/></way>
    <way id="24"><nd ref="106"/><nd ref="4"/><tag k="highway" v="tertiary"/><tag k="name" v="South"/></way>
  </osm>`;
  const polygon: [number, number][] = [
    [-0.001, -0.001],
    [0.00085, -0.001],
    [0.00085, 0.001],
    [-0.001, 0.001],
  ];
  const result = importOsm(osm, { importerVersion: 'test', polygon });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const gateways = Object.values(result.city.places).filter((p) => p.kind === 'gateway');
  const circus = gateways.filter((g) => g.provenance.osmIds!.includes(20));
  expect(circus.flatMap((g) => g.connectors.map((c) => c.direction)).sort()).toEqual(['in', 'out']);
});

test('a polygon gateway leaves on a lane the router can leave, judged by its lane-change rule', () => {
  // TASK-286 (York's Layerthorpe): Layer, two lanes one way, is cut 9 m before it narrows into
  // Link. Its right lane leads on only by the lane drop, which the router does not take, or by a
  // change to the left lane, which needs 30 m: every route from it would be `lane_infeasible`.
  const osm = `<osm>
    <node id="1" lat="0" lon="-0.003"/><node id="2" lat="0" lon="-0.0005"/>
    <node id="3" lat="0" lon="0.0005"/><node id="4" lat="0" lon="0.003"/>
    <node id="5" lat="0.0005" lon="-0.0005"/><node id="6" lat="0.0005" lon="0.0005"/>
    <node id="9" lat="0.0005" lon="0.0002"/>
    <node id="7" lat="0.003" lon="0.0002"/><node id="8" lat="0.00092" lon="0.0002"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><tag k="highway" v="primary"/><tag k="name" v="Main"/></way>
    <way id="11"><nd ref="2"/><nd ref="5"/><nd ref="9"/><nd ref="6"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="name" v="Block"/></way>
    <way id="12"><nd ref="7"/><nd ref="8"/><tag k="highway" v="secondary"/><tag k="name" v="Layer"/><tag k="oneway" v="yes"/><tag k="lanes" v="2"/></way>
    <way id="13"><nd ref="8"/><nd ref="9"/><tag k="highway" v="residential"/><tag k="name" v="Link"/><tag k="oneway" v="yes"/></way>
  </osm>`;
  const result = importOsm(osm, { importerVersion: 'test', polygon: square });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { city } = result;
  expect(city.drivingSide).toBe('right');
  const layer = Object.values(city.roads).find((r) => r.name === 'Layer')!;
  const connectors = Object.values(city.places)
    .filter((p) => p.kind === 'gateway')
    .flatMap((p) => p.connectors.map((c) => ({ ...c, place: p.id })));
  // The right lane is the driving side's choice when both could be left; here only the left can.
  expect(connectors.filter((c) => c.roadId === layer.id).map((c) => [c.direction, c.lane])).toEqual(
    [['out', 0]],
  );
  const compiled = compile(city);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const c = compiled.compiled;
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(c);
  for (const origin of connectors.filter((k) => k.direction === 'out')) {
    const from = c.connectors[c.index.connector.get(origin.id)!]!;
    const routed = connectors
      .filter((k) => k.direction === 'in' && k.place !== origin.place)
      .some(
        (k) =>
          provider.route(c, costs, {
            fromLane: from.lane,
            fromPosM: from.positionM,
            toConnector: c.index.connector.get(k.id)!,
            vehicleClass: 'car',
            desiredSpeedFactor: 1,
            noise: 0,
            seed: 1,
          }).ok,
      );
    expect(routed, `${origin.roadId}#${origin.lane}`).toBe(true);
  }
});
