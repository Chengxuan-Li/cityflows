import type { City, Command } from '../../schema';
import { addImplicitGarages } from '../../network/parking';
import { requireEntity, type CommandPatch } from './types';

export function editParking(
  city: City,
  command: Extract<Command, { kind: 'setParkingAttributes' }>,
): CommandPatch {
  const materialized = { ...city, parking: { ...city.parking } };
  addImplicitGarages(materialized);
  const facility = materialized.parking[command.parkingId] ?? command.source;
  const original = requireEntity(facility ? { [facility.id]: facility } : {}, command.parkingId);
  return {
    set: {
      parking: {
        ...Object.fromEntries(
          Object.entries(materialized.parking).filter(([id]) => !city.parking?.[id]),
        ),
        [original.id]: {
          ...original,
          ...(command.capacity !== undefined && { capacity: command.capacity }),
          ...(command.access !== undefined && { access: command.access }),
        },
      },
    },
    remove: {},
    nextId: Math.max(materialized.nextId, Number(original.id.slice(3)) + 1),
  };
}
