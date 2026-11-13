import type { City } from '../../schema';
import type { WalkerDetail } from '../../sim/types';
import { useAppStore } from '../store';

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
  // TASK-174: a rider on a platform, walking onto it, waiting, boarding or getting off.
  if (detail?.platform)
    return (
      <>
        <h2>Transit rider</h2>
        <dl className="details">
          <dt>Stop</dt>
          <dd>{detail.platform.stop}</dd>
          <dt>State</dt>
          <dd>{detail.platform.waiting ? 'Waiting for a vehicle' : 'Walking on the platform'}</dd>
          {detail.platform.waiting && (
            <>
              <dt>Waiting here</dt>
              <dd>{Math.round(detail.currentWaitS)} s</dd>
            </>
          )}
          <dt>Trip</dt>
          <dd>
            {city.places[detail.fromPlace]?.name ?? detail.fromPlace} →{' '}
            {city.places[detail.toPlace]?.name ?? detail.toPlace}
          </dd>
        </dl>
        {detail.personId && (
          <button
            className="nav-row"
            onClick={() => useAppStore.getState().selectPerson(detail.personId!)}
          >
            Person {detail.personId}
          </button>
        )}
      </>
    );
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
