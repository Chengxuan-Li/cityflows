import { Fragment, useEffect, useState } from 'react';
import type { Place } from '../../schema';
import { vehicleClasses } from '../../schema/city';
import type { FailReason, Metrics } from '../../sim/types';
import { useAppStore, type TestWalkers } from '../store';
import { ModeChoiceControls } from './mode-choice';

const failReasons: Record<FailReason, string> = {
  no_parking: 'No parking available',
  no_route: 'No route between the places',
  no_walk_route: 'No walking route between the places',
  unsupported_mode: 'Unsupported travel mode',
  destination_unreachable: 'Destination unreachable from the road',
  stranded: 'Stranded on the way',
  no_origin_connector: 'Origin has no exit',
  no_destination_connector: 'Destination has no entrance',
  gridlocked: 'Stuck in gridlock too often',
};

/** TASK-111: walkers between two places at a seeded rate, to try the pedestrian rules. */
function TestPedestrians({
  places,
  walkers,
  busy,
}: {
  places: Place[];
  walkers: TestWalkers;
  busy: boolean;
}) {
  const { setTestWalkers } = useAppStore.getState();
  const [from, setFrom] = useState(places[0]?.id ?? '');
  const [to, setTo] = useState(places[1]?.id ?? places[0]?.id ?? '');
  const name = (id: string) => places.find((place) => place.id === id)?.name ?? id;
  return (
    <div className="test-pedestrians">
      <table aria-label="Test pedestrians">
        <thead>
          <tr>
            <th scope="col">Test pedestrians from</th>
            <th scope="col">To</th>
            <th scope="col">Per hour</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {walkers.map((walker, index) => (
            <tr key={index}>
              <td>{name(walker.fromPlaceId)}</td>
              <td>{name(walker.toPlaceId)}</td>
              <td>
                <input
                  key={walker.perHour}
                  type="number"
                  min={0}
                  step={1}
                  aria-label={`Pedestrians per hour from ${name(walker.fromPlaceId)} to ${name(walker.toPlaceId)}`}
                  defaultValue={walker.perHour}
                  disabled={busy}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                  onBlur={(event) => {
                    const perHour = Number(event.currentTarget.value);
                    if (!(perHour >= 0) || perHour === walker.perHour) return;
                    void setTestWalkers(
                      walkers.map((w, i) => (i === index ? { ...w, perHour } : w)),
                    );
                  }}
                />
              </td>
              <td>
                <button
                  aria-label={`Remove pedestrians from ${name(walker.fromPlaceId)} to ${name(walker.toPlaceId)}`}
                  disabled={busy}
                  onClick={() => void setTestWalkers(walkers.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="edit-fields"
        onSubmit={(event) => {
          event.preventDefault();
          const perHour = Number(new FormData(event.currentTarget).get('perHour'));
          if (!from || !to || from === to || !(perHour > 0)) return;
          void setTestWalkers([...walkers, { fromPlaceId: from, toPlaceId: to, perHour }]);
        }}
      >
        <label className="edit-field">
          From
          <select value={from} onChange={(event) => setFrom(event.currentTarget.value)}>
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
        </label>
        <label className="edit-field">
          To
          <select value={to} onChange={(event) => setTo(event.currentTarget.value)}>
            {places.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </select>
        </label>
        <label className="edit-field">
          Per hour
          <input name="perHour" type="number" min={1} step={1} defaultValue={100} required />
        </label>
        <button disabled={busy || from === to}>Add pedestrians</button>
      </form>
    </div>
  );
}

function clock(timeS: number) {
  return `${String(Math.floor(timeS / 3600)).padStart(2, '0')}:${String(Math.floor(timeS / 60) % 60).padStart(2, '0')}`;
}

export function DemandPanel() {
  const session = useAppStore((state) => state.session)!;
  const run = useAppStore((state) => state.run)!;
  const busy = useAppStore((state) => state.busy);
  const { regenerateDemand, reportError } = useAppStore.getState();
  const { project, demandSummary: summary, engine } = session;
  const city = project.city;
  const seed = project.scenarios[0]!.demand.seed;
  const [failed, setFailed] = useState<{
    engine: typeof engine;
    at: number;
    failedByReason: Metrics['failedByReason'];
    completedByClass: Metrics['completedByClass'];
    respawns: number;
    persons: Metrics['persons'];
    walkers: Metrics['walkers'];
  } | null>(null);
  const pausedTime = run.status === 'playing' ? null : run.timeS;
  // Trip counts arrive with every tick; the failure breakdown is read on open, after each
  // pause or step, and once a second while playing.
  useEffect(() => {
    let active = true;
    const read = () =>
      void engine
        .metrics()
        .then(({ timeS, failedByReason, completedByClass, respawns, persons, walkers }) => {
          if (active)
            setFailed({
              engine,
              at: timeS,
              failedByReason,
              completedByClass,
              respawns,
              persons,
              walkers,
            });
        })
        .catch((error: unknown) => {
          if (active) reportError(error);
        });
    read();
    const timer = pausedTime === null ? setInterval(read, 1000) : undefined;
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [engine, pausedTime, reportError]);

  const persons = project.population.length;
  const cars = project.population.filter((person) => person.hasCar).length;
  const households = new Set(project.population.map((person) => person.householdId)).size;
  const max = Math.max(1, ...summary.byHour);
  const places = Object.values(city.places).sort((a, b) => a.name.localeCompare(b.name));
  const reasons = (Object.keys(failReasons) as FailReason[]).filter(
    (reason) => failed?.engine === engine && failed.failedByReason[reason] > 0,
  );
  const journeys = failed?.engine === engine ? failed.persons : undefined;
  const walkers = failed?.engine === engine ? failed.walkers : undefined;
  return (
    <section id="demand" className="panel demand-panel" aria-label="Demand">
      <div className="chart-heading">
        <span>
          {persons.toLocaleString()} persons, {cars.toLocaleString()} with a car ·{' '}
          {summary.totalTrips.toLocaleString()} trips over the day · {households.toLocaleString()}{' '}
          households
        </span>
      </div>
      <div className="demand-columns">
        <figure>
          <figcaption>Trips starting in each hour</figcaption>
          <svg viewBox="0 0 300 124" role="img" aria-label="Trips by hour">
            <path d="M36 24V100H286" fill="none" stroke="#dcded2" />
            <text x="30" y="28" textAnchor="end">
              {max}
            </text>
            <text x="30" y="100" textAnchor="end">
              0
            </text>
            {summary.byHour.map((trips, hour) => (
              <rect
                key={hour}
                data-hour={hour}
                data-trips={trips}
                x={37 + hour * 10.4}
                y={100 - (76 * trips) / max}
                width={8.4}
                height={(76 * trips) / max}
                fill="#4d8e94"
              >
                <title>{`${String(hour).padStart(2, '0')}:00 · ${trips.toLocaleString()} trips`}</title>
              </rect>
            ))}
            {[0, 6, 12, 18, 24].map((hour) => (
              <text key={hour} x={37 + hour * 10.4} y="118" textAnchor="middle">
                {String(hour % 24).padStart(2, '0')}
              </text>
            ))}
          </svg>
          <table aria-label="Trips by class">
            <thead>
              <tr>
                <th scope="col">Class</th>
                <th scope="col">Trips</th>
                <th scope="col">Completed</th>
              </tr>
            </thead>
            <tbody>
              {vehicleClasses.map((vehicleClass) => (
                <tr key={vehicleClass}>
                  <th scope="row">{vehicleClass[0]!.toUpperCase() + vehicleClass.slice(1)}</th>
                  <td>{summary.byClass[vehicleClass].toLocaleString()}</td>
                  <td>
                    {failed?.engine === engine
                      ? failed.completedByClass[vehicleClass].toLocaleString()
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="details" aria-label="Last run">
            <dt>Last run</dt>
            <dd>
              through {clock(run.timeS)}
              {run.stale ? ', before the latest edits' : ''}
            </dd>
            <dt>Waiting to leave their origin</dt>
            <dd>{run.counts.queuedOrigin.toLocaleString()}</dd>
            <dt>Trips that failed</dt>
            <dd>{run.counts.failed.toLocaleString()}</dd>
            {reasons.map((reason) => (
              <Fragment key={reason}>
                <dt>{failReasons[reason]}</dt>
                <dd>{failed!.failedByReason[reason].toLocaleString()}</dd>
              </Fragment>
            ))}
            {failed?.engine === engine && (
              <>
                <dt>Restarted after standing in a gridlock</dt>
                <dd>{failed.respawns.toLocaleString()}</dd>
              </>
            )}
          </dl>
          {journeys && (
            <dl className="details" aria-label="Person journeys">
              <dt>Person trips started, arrived, failed</dt>
              <dd>
                {journeys.started.toLocaleString()}, {journeys.completed.toLocaleString()},{' '}
                {journeys.failed.toLocaleString()}
              </dd>
              <dt>Walk trips arrived, failed</dt>
              <dd>
                {journeys.walkTripsCompleted.toLocaleString()},{' '}
                {journeys.walkTripsFailed.toLocaleString()}
              </dd>
              <dt>Mean walk to car</dt>
              <dd>
                {journeys.access.meanTimeS.toFixed(1)} s ·{' '}
                {Math.round(journeys.access.meanDistanceM)} m
              </dd>
              <dt>Mean walk from car</dt>
              <dd>
                {journeys.egress.meanTimeS.toFixed(1)} s ·{' '}
                {Math.round(journeys.egress.meanDistanceM)} m
              </dd>
              <dt>Walks across a network gap</dt>
              <dd>{journeys.walkFallbacks.toLocaleString()}</dd>
              {journeys.fallbacks.map((fallback) => (
                <Fragment
                  key={`${fallback.leg}:${fallback.placeId}:${fallback.facilityId}:${fallback.reason}`}
                >
                  <dt>
                    {fallback.leg === 'access' ? 'To car' : 'From car'} at{' '}
                    {city.places[fallback.placeId]?.name ?? fallback.placeId}
                    {fallback.facilityId ? ` · ${fallback.facilityId}` : ''} ·{' '}
                    {fallback.reason.replaceAll('_', ' ')}
                  </dt>
                  <dd>{fallback.count.toLocaleString()}</dd>
                </Fragment>
              ))}
            </dl>
          )}
          {walkers && (
            <dl className="details" aria-label="Pedestrian crossings">
              <dt>Crossings at zebras, at signals</dt>
              <dd>
                {walkers.crossings.zebra.toLocaleString()},{' '}
                {walkers.crossings.signal.toLocaleString()}
              </dd>
              <dt>Vehicles stopped at zebras, at signals</dt>
              <dd>
                {walkers.vehicleStops.zebra.toLocaleString()},{' '}
                {walkers.vehicleStops.signal.toLocaleString()}
              </dd>
              <dt>Vehicle delay at crossings</dt>
              <dd>
                {Math.round(
                  walkers.vehicleDelayS.zebra + walkers.vehicleDelayS.signal,
                ).toLocaleString()}{' '}
                s
              </dd>
            </dl>
          )}
        </figure>
        <div>
          <table aria-label="Trips by place">
            <thead>
              <tr>
                <th scope="col">Place</th>
                <th scope="col">Trips starting</th>
                <th scope="col">Trips ending</th>
              </tr>
            </thead>
            <tbody>
              {places.map((place) => {
                const trips = summary.byPlace[place.id];
                return (
                  <tr key={place.id}>
                    <th scope="row">{place.name}</th>
                    <td>{(trips?.departures ?? 0).toLocaleString()}</td>
                    <td>{(trips?.arrivals ?? 0).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <form
            className="edit-fields"
            onSubmit={(event) => {
              event.preventDefault();
              const input = new FormData(event.currentTarget).get('seed');
              void regenerateDemand(Number(input));
            }}
          >
            <label className="edit-field">
              Demand seed
              <input
                key={seed}
                name="seed"
                type="number"
                min={Number.MIN_SAFE_INTEGER}
                max={Number.MAX_SAFE_INTEGER}
                step={1}
                required
                defaultValue={seed}
                disabled={busy}
              />
            </label>
            <button disabled={busy}>Regenerate demand</button>
          </form>
          <p className="muted">
            Regenerating draws new homes, workplaces and departure times from the seed; restart to
            run them.
          </p>
          <ModeChoiceControls />
          <TestPedestrians
            places={places}
            walkers={project.scenarios[0]!.walkers ?? []}
            busy={busy}
          />
        </div>
      </div>
      <p className="muted">Synthetic traffic, not observed traffic.</p>
    </section>
  );
}
