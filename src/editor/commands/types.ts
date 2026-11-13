import type { Diagnostic } from '../../network';
import type { City, Connector, ParkingFacility, Patch, Place } from '../../schema';

export interface CommandPatch extends Patch {
  warnings?: Diagnostic[];
}

export function requireEntity<T>(entities: Record<string, T>, id: string): T {
  const entity = entities[id];
  if (!entity) throw new Error(`Unknown entity: ${id}`);
  return entity;
}

/** Apply the same road edit to place entries and garage entries. */
export function mapConnectors(
  city: City,
  patch: CommandPatch,
  update: (connector: Connector, ownerId: string) => Connector | null,
): void {
  for (const collection of ['places', 'parking'] as const) {
    const owners: (Place | ParkingFacility)[] = Object.values(city[collection] ?? {});
    for (const owner of owners) {
      const connectors = owner.connectors.flatMap((connector) => {
        const next = update(connector, owner.id);
        return next ? [next] : [];
      });
      if (
        connectors.length !== owner.connectors.length ||
        connectors.some((connector, i) => connector !== owner.connectors[i])
      )
        Object.assign((patch.set[collection] ??= {}), {
          [owner.id]: {
            ...owner,
            ...patch.set[collection]?.[owner.id],
            connectors,
            ...('mappedPortals' in owner && {
              mappedPortals: (owner as ParkingFacility).mappedPortals?.filter((p) =>
                connectors.some((c) => c.id === p.connectorId),
              ),
            }),
          },
        });
    }
  }
}
