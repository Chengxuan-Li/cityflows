import { circularFillet } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import { buildCity } from './build-city';

/** A two-way secondary street, one lane each way, around a hairpin of 20 m centreline radius
 * (the owner's B35 bend). The bend is drawn the way the OSM importer smooths a mapped curve:
 * vertices about 5 m apart, the chords a few centimetres unequal as mapped, each vertex rounded
 * by a `circularFillet` sampled in one-degree steps, so neighbouring fillets leave centimetre
 * segments between them and both lane polylines step back by millimetres there. */
export function hairpin(seed = 1) {
  const { city, node, road } = buildCity('Hairpin', seed);
  const radius = 20;
  const mapped: Vec2[] = [{ x: -100, y: 0 }];
  for (let i = 0, angle = 0; angle <= Math.PI + 1e-9; i++) {
    mapped.push({ x: radius * Math.sin(angle), y: radius - radius * Math.cos(angle) });
    angle += ((i % 2 ? 15.1 : 14.9) * Math.PI) / 180;
  }
  mapped.push({ x: -100, y: 2 * radius });
  const centerline: Vec2[] = [];
  for (let i = 1; i < mapped.length - 1; i++) {
    // The importer's target radius for a secondary road, and its minimum: the lanes' reach.
    const arc = circularFillet(mapped[i - 1]!, mapped[i]!, mapped[i + 1]!, 80, 4);
    centerline.push(...(arc ? arc.points : [mapped[i]!]));
  }
  const west = node(-100, 0);
  const back = node(-100, 2 * radius);
  const options = { roadClass: 'secondary' as const, streetGroupId: 'street:hairpin' };
  road(west, back, { ...options, via: centerline });
  road(back, west, { ...options, via: [...centerline].reverse() });
  return city;
}
