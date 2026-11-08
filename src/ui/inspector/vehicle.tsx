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
  return (
    <>
      <h2>Vehicle {id}</h2>
      {detail ? (
        <dl className="details">
          <dt>Class</dt>
          <dd className="capitalize">{detail.vehicleClass}</dd>
          <dt>Purpose</dt>
          <dd className="capitalize">{detail.purpose}</dd>
          <dt>Origin</dt>
          <dd>{city.places[detail.originPlace]!.name}</dd>
          <dt>Destination</dt>
          <dd>{city.places[detail.destinationPlace]!.name}</dd>
          <dt>State</dt>
          <dd className="capitalize">{detail.state.replaceAll('_', ' ')}</dd>
          <dt>Speed</dt>
          <dd>{(detail.speedMps * 3.6).toFixed(1)} km/h</dd>
          <dt>Waiting time</dt>
          <dd>{detail.waitingS.toFixed(1)} s</dd>
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
