import { Fragment, useEffect, useState } from 'react';
import { vehicleClasses } from '../../schema/city';
import type { FailReason, Metrics } from '../../sim/types';
import { useAppStore } from '../store';

const failReasons: Record<FailReason, string> = {
  no_parking: 'No parking available',
  no_route: 'No route between the places',
  unsupported_mode: 'Not travelling by car',
  destination_unreachable: 'Destination unreachable from the road',
  stranded: 'Stranded on the way',
  no_origin_connector: 'Origin has no exit',
  no_destination_connector: 'Destination has no entrance',
  gridlocked: 'Stuck in gridlock too often',
};

function clock(timeS: number) {
  return `${String(Math.floor(timeS / 3600)).padStart(2, '0')}:${String(Math.floor(timeS / 60) % 60).padStart(2, '0')}`;
}

export function DemandPanel() {
  const session = useAppStore((state) => state.session)!;
  const run = useAppStore((state) => state.run)!;
  const busy = useAppStore((state) => state.busy);
  const { toggleDemand, regenerateDemand, reportError } = useAppStore.getState();
  const { project, demandSummary: summary, engine } = session;
  const city = project.city;
  const seed = project.scenarios[0]!.demand.seed;
  const [failed, setFailed] = useState<{
    engine: typeof engine;
    at: number;
    failedByReason: Metrics['failedByReason'];
    completedByClass: Metrics['completedByClass'];
    respawns: number;
  } | null>(null);
  const pausedTime = run.status === 'playing' ? null : run.timeS;
  // Trip counts arrive with every tick; the failure breakdown is read on open, after each
  // pause or step, and once a second while playing.
  useEffect(() => {
    let active = true;
    const read = () =>
      void engine
        .metrics()
        .then(({ timeS, failedByReason, completedByClass, respawns }) => {
          if (active) setFailed({ engine, at: timeS, failedByReason, completedByClass, respawns });
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
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggleDemand();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [toggleDemand]);

  const persons = project.population.length;
  const withCar = project.population.filter((person) => person.hasCar).length;
  const max = Math.max(1, ...summary.byHour);
  const places = Object.values(city.places).sort((a, b) => a.name.localeCompare(b.name));
  const reasons = (Object.keys(failReasons) as FailReason[]).filter(
    (reason) => failed?.engine === engine && failed.failedByReason[reason] > 0,
  );
  return (
    <section id="demand" className="chart-sheet demand-sheet" aria-label="Demand">
      <div className="chart-heading">
        <span>
          {persons.toLocaleString()} persons, {withCar.toLocaleString()} with a car ·{' '}
          {summary.totalTrips.toLocaleString()} trips over the day
        </span>
        <button aria-label="Close demand" onClick={toggleDemand}>
          ×
        </button>
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
        </div>
      </div>
      <p className="muted">Synthetic traffic, not observed traffic.</p>
    </section>
  );
}
