import type { CParking } from '../../network';
import type { ParkingAccess } from '../../schema';
import { useAppStore } from '../store';
import { NumberField } from './number-field';

export function ParkingInspector({ facility }: { facility: CParking }) {
  const occupied = useAppStore((state) => state.parkingOccupancy[facility.id]);
  const viewMode = useAppStore((state) => state.viewMode);
  const busy = useAppStore((state) => state.busy);
  const place = useAppStore((state) =>
    facility.source.placeId ? state.session?.project.city.places[facility.source.placeId] : null,
  );
  const { commit } = useAppStore.getState();
  return (
    <>
      <h2>{facility.name ?? 'Parking'}</h2>
      <dl className="details">
        <dt>Kind</dt>
        <dd className="capitalize">{facility.kind}</dd>
        {place && (
          <>
            <dt>Serves</dt>
            <dd>{place.name}</dd>
          </>
        )}
        <dt>Occupancy now</dt>
        <dd>{occupied === undefined ? '—' : `${occupied} / ${facility.capacity}`}</dd>
        {Boolean(facility.source.provenance.inferred?.length) && (
          <>
            <dt>Source</dt>
            <dd>Inferred</dd>
          </>
        )}
      </dl>
      <fieldset className="parking-fields edit-fields" disabled={viewMode === '3d' || busy}>
        <NumberField
          label="Parking capacity"
          value={facility.capacity}
          min={occupied ?? 0}
          step={1}
          onCommit={(capacity) =>
            void commit({
              kind: 'setParkingAttributes',
              parkingId: facility.id,
              capacity: capacity!,
              source: facility.source,
            })
          }
        />
        <label className="edit-field">
          Parking access
          <select
            value={facility.access}
            onChange={(event) =>
              void commit({
                kind: 'setParkingAttributes',
                parkingId: facility.id,
                access: event.currentTarget.value as ParkingAccess,
                source: facility.source,
              })
            }
          >
            <option value="public">Public</option>
            <option value="customers">Customers</option>
            <option value="private">Private</option>
          </select>
        </label>
      </fieldset>
      {viewMode === '3d' && <p className="muted">Edit parking in 2D.</p>}
    </>
  );
}
