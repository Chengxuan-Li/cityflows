import type { CompiledCity } from '../network';
import type { Pick } from '../render/types';

export function selectionAfterEdit(
  selection: Pick | null,
  before: CompiledCity,
  after: CompiledCity,
): Pick | null {
  switch (selection?.kind) {
    case 'parking': {
      const parking = after.index.parking.get(before.parking[selection.parking]!.id);
      return parking === undefined ? null : { kind: 'parking', parking };
    }
    case 'lane': {
      const previous = before.roads[selection.road]!;
      const laneNumber = before.lanes[selection.lane]!.lane;
      const index = after.index.road.get(previous.id);
      const road =
        index !== undefined
          ? after.roads[index]
          : after.roads.find(
              (road) =>
                previous.streetGroupId !== null && road.streetGroupId === previous.streetGroupId,
            );
      if (!road) return null;
      return {
        kind: 'lane',
        road: road.idx,
        lane: road.lanes[Math.min(laneNumber, road.lanes.length - 1)]!,
      };
    }
    case 'node': {
      const node = after.index.node.get(before.nodes[selection.node]!.id);
      return node === undefined ? null : { kind: 'node', node };
    }
    case 'place': {
      const place = after.index.place.get(before.places[selection.place]!.id);
      return place === undefined ? null : { kind: 'place', place };
    }
    case 'connector': {
      const previous = before.connectors[selection.connector]!;
      const connector = after.index.connector.get(previous.id);
      if (connector !== undefined) return { kind: 'connector', connector };
      if (previous.parking !== undefined)
        return selectionAfterEdit({ kind: 'parking', parking: previous.parking }, before, after);
      return selectionAfterEdit({ kind: 'place', place: previous.place }, before, after);
    }
    default:
      return selection;
  }
}
