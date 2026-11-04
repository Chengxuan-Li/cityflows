import type { City } from '../../schema';
import type { VehicleDetail } from '../../sim/types';

export function VehicleInspector({
  id,
  detail,
  city,
}: {
  id: number;
  detail: VehicleDetail | null;
  city: City;
}) {
  return (
    <>
      <h2>Vehicle {id}</h2>
      {detail ? (
        <dl className="details">
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
          <dt>Route</dt>
          <dd>{detail.route ? `${detail.route.roads.length} roads` : 'Unavailable'}</dd>
          <dt>Route reason</dt>
          <dd className="capitalize">{detail.routeReason.replaceAll('_', ' ')}</dd>
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
