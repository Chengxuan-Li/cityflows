import { cumulativeLengths, pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import type { Pick, VehicleSnapshot } from '../render/types';

const middle = (line: readonly Vec2[]): Vec2 => {
  const lengths = cumulativeLengths(line);
  return pointAtDistance(line, lengths, lengths.at(-1)! / 2);
};

/** TASK-196: the point the map would centre on for a selection: a street or track at the middle of
 *  its line, a vehicle or walker where the latest snapshot has it, anything else at its position.
 *  Null where the selection has no fixed place (a train), or its vehicle has left the snapshot. */
export function selectionAnchor(
  pick: Pick,
  city: CompiledCity,
  snapshot: VehicleSnapshot | null,
): Vec2 | null {
  switch (pick.kind) {
    case 'lane': {
      const { polyline, cumulative, lengthM } = city.lanes[pick.lane]!;
      return pointAtDistance(polyline, cumulative, lengthM / 2);
    }
    case 'node':
      return city.nodes[pick.node]!.pos;
    case 'place':
      return city.places[pick.place]!.centroid;
    case 'parking':
      return city.parking[pick.parking]!.centroid;
    case 'parked':
      return city.parkingSpaces![pick.space]!.position;
    case 'connector': {
      const { lane, positionM } = city.connectors[pick.connector]!;
      const { polyline, cumulative } = city.lanes[lane]!;
      return pointAtDistance(polyline, cumulative, positionM);
    }
    case 'track':
      return middle(city.rail!.tracks[pick.track]!.line);
    case 'platform': {
      const { shape } = city.rail!.platforms[pick.platform]!;
      if (shape.kind === 'point') return shape.pos;
      return middle(shape.kind === 'line' ? shape.line : shape.ring);
    }
    case 'vehicle': {
      const index = snapshot?.id.subarray(0, snapshot.count).indexOf(pick.id) ?? -1;
      return index < 0 ? null : { x: snapshot!.x[index]!, y: snapshot!.y[index]! };
    }
    case 'walker': {
      const walkers = snapshot?.walkers;
      const index = walkers?.id.subarray(0, walkers.count).indexOf(pick.id) ?? -1;
      return index < 0 ? null : { x: walkers!.x[index]!, y: walkers!.y[index]! };
    }
    case 'train':
      return null;
    case 'aircraft': {
      const pose = snapshot?.aircraft?.find((a) => a.id === pick.id);
      return pose ? { x: pose.x, y: pose.y } : null;
    }
  }
}
