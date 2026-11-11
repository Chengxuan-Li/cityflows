import type { CParking } from '../../network';
import { vehicleClasses, type ParkingAccess } from '../../schema';
import { useAppStore } from '../store';
import { NumberField } from './number-field';
import { remapParkedCars } from '../drawn-snapshot';
import { HouseholdCar } from './vehicle';

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
        {facility.kind === 'lot' && (
          <>
            <dt>Generated spaces</dt>
            <dd>{facility.capacity}</dd>
          </>
        )}
        {Boolean(facility.source.provenance.inferred?.length) && (
          <>
            <dt>Source</dt>
            <dd>Inferred</dd>
          </>
        )}
      </dl>
      <fieldset className="parking-fields edit-fields" disabled={viewMode === '3d' || busy}>
        {facility.kind !== 'lot' && (
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
        )}
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

export function ParkedSpaceInspector({ space }: { space: number }) {
  const session = useAppStore((state) => state.session!);
  const compiled = session.compiled;
  const stock = useAppStore((state) => state.parkedCars);
  const parkedCars = remapParkedCars(stock, session.loadedCompiled, compiled);
  const slot = compiled.parkingSpaces?.[space];
  const facility = slot && compiled.parking[slot.parking];
  const occupied = parkedCars && Boolean(parkedCars.occupied[space >> 3]! & (1 << (space & 7)));
  return (
    <>
      <h2>{occupied ? `Parked vehicle ${parkedCars!.id[space]}` : 'Parking space'}</h2>
      {facility && (
        <dl className="details">
          {occupied && (
            <>
              <dt>Class</dt>
              <dd className="capitalize">{vehicleClasses[parkedCars!.vclass[space]!]}</dd>
              <HouseholdCar vehicleId={parkedCars!.id[space]!} />
            </>
          )}
          <dt>Parking</dt>
          <dd>
            {facility.name ?? (facility.kind === 'roadside' ? 'Roadside parking' : 'Parking lot')}
          </dd>
          <dt>Kind</dt>
          <dd className="capitalize">{facility.kind}</dd>
          <dt>Access</dt>
          <dd className="capitalize">{facility.access}</dd>
          <dt>State</dt>
          <dd>{occupied ? 'Parked' : 'Empty'}</dd>
        </dl>
      )}
    </>
  );
}
