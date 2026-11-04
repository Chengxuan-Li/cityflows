import { buildCity } from './build-city';

/** Irregular multi-lane junctions, laid out separately for inspection at marking zoom. */
export function junctions(seed = 1) {
  const { city, node, street, road } = buildCity('Junction geometry', seed);
  const layouts = [
    { x: 0, y: 0, angles: [0, 155, 205] },
    { x: 550, y: 0, angles: [15, 85, 195, 265] },
    { x: 1100, y: 0, angles: [0, 65, 145, 220, 285] },
  ];
  for (const { x, y, angles } of layouts) {
    const center = node(x, y);
    for (const degrees of angles) {
      const angle = (degrees * Math.PI) / 180;
      street(center, node(x + 180 * Math.cos(angle), y + 180 * Math.sin(angle)), 2);
    }
  }
  const westT = node(0, 550);
  const eastT = node(75, 550);
  street(westT, eastT, 2);
  street(node(-180, 550), westT, 2);
  street(westT, node(0, 730), 2);
  street(eastT, node(255, 550), 2);
  street(node(75, 370), eastT, 2);
  const merge = node(550, 550);
  road(node(370, 550), merge, { lanes: 2, roadClass: 'motorway' });
  road(merge, node(730, 550), { lanes: 2, roadClass: 'motorway' });
  const slip = road(node(370, 600), merge, {
    lanes: 2,
    roadClass: 'ramp',
    via: [{ x: 530, y: 550 }],
  });
  slip.lateralOffsetM = 7;
  return city;
}
