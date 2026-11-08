import { allocateId, type City, type Command, type Connector, type Patch } from '../../schema';
import { requireEntity } from './types';

type PlaceCommand = Extract<
  Command,
  { kind: 'addPlace' | 'updatePlace' | 'setConnectors' | 'deletePlace' }
>;

function reserveConnectorIds(nextId: number, connectors: Connector[]): number {
  for (const { id } of connectors) {
    const number = Number(id.slice(2));
    if (Number.isSafeInteger(number + 1)) nextId = Math.max(nextId, number + 1);
  }
  return nextId;
}

export function editPlace(city: City, command: PlaceCommand): Patch {
  if (command.kind === 'addPlace') {
    const counter = { nextId: reserveConnectorIds(city.nextId, command.place.connectors) };
    const id = allocateId(counter, 'p');
    return {
      set: { places: { [id]: { ...command.place, id } } },
      remove: {},
      nextId: counter.nextId,
    };
  }
  const place = requireEntity(city.places, command.placeId);
  switch (command.kind) {
    case 'updatePlace':
      return { set: { places: { [place.id]: { ...place, ...command.patch } } }, remove: {} };
    case 'setConnectors': {
      const nextId = reserveConnectorIds(city.nextId, command.connectors);
      return {
        set: { places: { [place.id]: { ...place, connectors: command.connectors } } },
        remove: {},
        ...(nextId === city.nextId ? {} : { nextId }),
      };
    }
    case 'deletePlace': {
      const patch: Patch = { set: {}, remove: { places: [place.id] } };
      for (const facility of Object.values(city.parking ?? {})) {
        if (facility.placeId !== place.id) continue;
        (patch.remove.parking ??= []).push(facility.id);
      }
      return patch;
    }
  }
}
