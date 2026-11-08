import type { City } from '../../schema';
import type { WalkerDetail } from '../../sim/types';

const states: Record<WalkerDetail['state'], string> = {
  pending: 'Not yet out',
  walking: 'Walking',
  waiting: 'Waiting to cross',
  crossing: 'Crossing',
  done: 'Arrived',
  dropped: 'No walking route',
};

/** TASK-111: a test pedestrian: where it walks, what it is doing and how long it has waited. */
export function WalkerInspector({
  id,
  detail,
  city,
}: {
  id: number;
  detail: WalkerDetail | null;
  city: City;
}) {
  return (
    <>
      <h2>Pedestrian {id}</h2>
      {detail ? (
        <dl className="details">
          <dt>From</dt>
          <dd>{city.places[detail.fromPlace]?.name ?? detail.fromPlace}</dd>
          <dt>To</dt>
          <dd>{city.places[detail.toPlace]?.name ?? detail.toPlace}</dd>
          <dt>State</dt>
          <dd>
            {states[detail.state]}
            {detail.crossing && ` at a ${detail.crossing === 'signal' ? 'signal' : 'zebra'}`}
          </dd>
          {detail.state === 'waiting' && (
            <>
              <dt>Waiting here</dt>
              <dd>{detail.currentWaitS.toFixed(1)} s</dd>
            </>
          )}
          <dt>Waiting time</dt>
          <dd>{detail.waitingS.toFixed(1)} s</dd>
          <dt>Crossings taken</dt>
          <dd>{detail.crossings}</dd>
          <dt>Route</dt>
          <dd>{detail.route ? `${Math.round(detail.route.lengthM)} m` : 'Unavailable'}</dd>
          {detail.arrivedS !== null && (
            <>
              <dt>Walk time</dt>
              <dd>{Math.round(detail.arrivedS - detail.spawnedS)} s</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="muted">Reading pedestrian details…</p>
      )}
    </>
  );
}
