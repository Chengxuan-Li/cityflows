import type { CompiledCity } from '../../network';
import type { City } from '../../schema';
import type { VehicleDetail } from '../../sim/types';
import { useAppStore } from '../store';

/** Why a vehicle is not moving, read from its state and position; the engine reports no reason. */
function waitingReason(detail: VehicleDetail, compiled: CompiledCity): string | null {
  if (detail.state === 'queued_origin') return 'Waiting to enter at the origin';
  if (detail.state === 'queued_destination') return 'Waiting for space at the destination';
  if (detail.state !== 'driving' || detail.speedMps >= 0.5) return null;
  const lane = compiled.lanes[detail.lane];
  if (!lane || lane.stopM - detail.positionM > 20) return null;
  const node = compiled.nodes[compiled.roads[lane.road]!.to]!;
  return node.signal ? 'Stopped at a signal' : 'Yielding at a junction';
}

/** TASK-129: the household car a vehicle id stands for, and the household's members. */
export function HouseholdCar({
  vehicleId,
  occupant = null,
}: {
  vehicleId: number;
  occupant?: string | null;
}) {
  const carId = useAppStore((state) => state.session?.vehicleCars[vehicleId - 1] ?? null);
  const population = useAppStore((state) => state.session?.project.population);
  if (!carId) return null;
  const household = carId.slice('car:'.length, carId.lastIndexOf(':'));
  const members = population?.filter((person) => person.householdId === household) ?? [];
  return (
    <>
      <dt>Car</dt>
      <dd>{carId}</dd>
      <dt>Household</dt>
      <dd>
        {household}
        {members
          .filter((member) => member.id !== occupant)
          .map((member) => (
            <div key={member.id}>
              <button onClick={() => useAppStore.getState().selectPerson(member.id)}>
                {member.id}
              </button>
            </div>
          ))}
      </dd>
    </>
  );
}

export function VehicleInspector({
  id,
  detail,
  city,
}: {
  id: number;
  detail: VehicleDetail | null;
  city: City;
}) {
  // Use the network acknowledged by the engine, including live patches.
  const compiled = useAppStore((state) => state.session!.loadedCompiled);
  const reason = detail && waitingReason(detail, compiled);
  const facility = detail?.parkingFacility
    ? compiled.parking[compiled.index.parking.get(detail.parkingFacility)!]
    : undefined;
  return (
    <>
      <h2>Vehicle {id}</h2>
      {detail ? (
        <dl className="details">
          <dt>Class</dt>
          <dd className="capitalize">{detail.vehicleClass}</dd>
          <dt>Purpose</dt>
          <dd className="capitalize">{detail.purpose}</dd>
          <dt>Occupant</dt>
          <dd>
            {detail.personId ? (
              <button onClick={() => useAppStore.getState().selectPerson(detail.personId!)}>
                {detail.personId}
              </button>
            ) : (
              'None'
            )}
          </dd>
          <HouseholdCar vehicleId={id} occupant={detail.personId} />
          <dt>Origin</dt>
          <dd>{city.places[detail.originPlace]!.name}</dd>
          <dt>Destination</dt>
          <dd>{city.places[detail.destinationPlace]!.name}</dd>
          <dt>State</dt>
          <dd className="capitalize">{detail.state.replaceAll('_', ' ')}</dd>
          {detail.parkingPhase && (
            <>
              <dt>Parking motion</dt>
              <dd>
                {
                  {
                    drive_in: 'Driving to stall',
                    park: 'Pulling in',
                    leave: 'Pulling out',
                    drive_out: 'Driving to exit',
                    exit: 'Waiting for a gap',
                    merge: 'Joining the street',
                  }[detail.parkingPhase]
                }
              </dd>
            </>
          )}
          <dt>Speed</dt>
          <dd>{(detail.speedMps * 3.6).toFixed(1)} km/h</dd>
          <dt>Waiting time</dt>
          <dd>{detail.waitingS.toFixed(1)} s</dd>
          {detail.parkingFacility && (
            <>
              <dt>Parking</dt>
              <dd>
                {facility?.name ??
                  (facility?.kind === 'lot'
                    ? 'Parking lot'
                    : facility?.kind === 'roadside'
                      ? 'Roadside parking'
                      : 'Garage')}
              </dd>
              <dt>Walk to destination</dt>
              <dd>{Math.round(detail.walkingDistanceM)} m</dd>
              <dt>Parking search</dt>
              <dd>{detail.parkingSearchTimeS.toFixed(1)} s</dd>
              {facility?.kind === 'roadside' && detail.parkingSpace !== null && (
                <>
                  <dt>
                    {detail.parkingPhase === null && detail.state === 'driving'
                      ? 'Claimed space'
                      : 'Parking space'}
                  </dt>
                  <dd>{detail.parkingSpace}</dd>
                </>
              )}
              {detail.stallChoice && (
                <>
                  <dt>Chosen stall</dt>
                  <dd>
                    {detail.parkingSpace} · rank {detail.stallChoice.rank}
                  </dd>
                  <dt>Drive and walk score</dt>
                  <dd>
                    {detail.stallChoice.scoreM.toFixed(1)} m (best{' '}
                    {detail.stallChoice.bestScoreM.toFixed(1)} m)
                  </dd>
                </>
              )}
            </>
          )}
          {reason && (
            <>
              <dt>Waiting because</dt>
              <dd>{reason}</dd>
            </>
          )}
          <dt>Route</dt>
          <dd>{detail.route ? `${detail.route.roads.length} roads` : 'Unavailable'}</dd>
          <dt>Route reason</dt>
          <dd className="capitalize">
            {detail.routeReason === 'edit' ? 'Edit' : detail.routeReason.replaceAll('_', ' ')}
          </dd>
          <dt>Restarts after gridlock</dt>
          <dd>{detail.respawns}</dd>
          {detail.failReason && (
            <>
              <dt>Failure</dt>
              <dd>{detail.failReason.replaceAll('_', ' ')}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="muted">Reading vehicle details…</p>
      )}
    </>
  );
}
