import { useEffect, useState, type ReactNode } from 'react';
import type { RunwayOperations } from '../../schema/airport';
import type { FlightBoard } from '../../sim/flight-operations';
import { airportRunwayConcepts, deriveRunwayConfigurations } from '../../sim/runway-configuration';
import { Stepper } from '../controls';
import { TextField } from './place';
import { useAppStore } from '../store';
import { aircraftStateLabels, flightBoardContext, useFlightBoard } from '../flight-board-data';

export function FlightBoardProvider({ children }: { children: ReactNode }) {
  const engine = useAppStore((s) => s.session?.compiled.airside && s.session.engine);
  const timeS = useAppStore((s) => (s.session?.compiled.airside ? s.run?.timeS : undefined));
  const [snapshot, setSnapshot] = useState<{ engine: typeof engine; board: FlightBoard | null }>();
  useEffect(() => {
    if (!engine) return;
    let active = true;
    void engine.flightBoard().then(
      (board) => {
        if (active) setSnapshot({ engine, board });
      },
      (error: unknown) => {
        if (active) useAppStore.getState().reportError(error);
      },
    );
    return () => {
      active = false;
    };
  }, [engine, timeS]);
  return (
    <flightBoardContext.Provider
      value={snapshot?.engine === engine ? (snapshot?.board ?? null) : null}
    >
      {children}
    </flightBoardContext.Provider>
  );
}

type Movement = FlightBoard['arrivals'][number];

const stateLabels: Record<Movement['state'], string> = {
  ...aircraftStateLabels,
  scheduled: 'Scheduled',
  'before start': 'Before start',
  'holding for stand': 'Holding for stand',
  'awaiting clearance': 'Awaiting clearance',
  'awaiting approach': 'Awaiting approach',
  arrived: 'Arrived',
  departed: 'Departed',
  diverted: 'Diverted',
  cancelled: 'Cancelled',
};

function localTime(timeS: number) {
  const minutes = Math.floor(timeS / 60) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const pageSize = 6;

function Movements({ title, rows }: { title: string; rows: Movement[] }) {
  const now = useAppStore((s) => s.run?.timeS ?? 0);
  const [page, setPage] = useState<number | null>(null);
  const upcoming = rows.findIndex(({ timeS }) => timeS >= now);
  const maxStart = Math.max(0, rows.length - pageSize);
  const start = Math.min(maxStart, page ?? (upcoming < 0 ? maxStart : Math.max(0, upcoming - 2)));
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">No scheduled flights</p>
      ) : (
        <>
          <table aria-label={title}>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Aircraft</th>
                <th scope="col">Stand</th>
                <th scope="col">State</th>
                <th scope="col">Delay</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(start, start + pageSize).map((row) => (
                <tr key={row.id}>
                  <td>{localTime(row.timeS)}</td>
                  <td title={row.registration}>{row.typeId}</td>
                  <td>{row.stand ?? '—'}</td>
                  <td>{stateLabels[row.state]}</td>
                  <td>{row.delayS ? `+${Math.ceil(row.delayS / 60)}m` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > pageSize && (
            <div className="controls">
              <button disabled={start === 0} onClick={() => setPage(Math.max(0, start - pageSize))}>
                Earlier
              </button>
              <button disabled={page === null} onClick={() => setPage(null)}>
                Now
              </button>
              <button
                disabled={start === maxStart}
                onClick={() => setPage(Math.min(maxStart, start + pageSize))}
              >
                Later
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const endsLabel = (arrivals: string[], departures: string[]) =>
  arrivals.join(' ') === departures.join(' ')
    ? arrivals.join(', ')
    : `arrivals ${arrivals.join(', ')}, departures ${departures.join(', ')}`;

/** TASK-300: the runway configuration in use, a change in progress, and the wind control. */
function Runways({ runways }: { runways: NonNullable<FlightBoard['runways']> }) {
  const engine = useAppStore((s) => s.session?.engine);
  const [wind, setWind] = useState(runways.wind);
  // A wind the run reports differently (a restart) replaces the one last entered.
  const [reported, setReported] = useState(runways.wind);
  if (reported.fromDeg !== runways.wind.fromDeg || reported.speedKt !== runways.wind.speedKt) {
    setReported(runways.wind);
    setWind(runways.wind);
  }
  const change = (next: typeof wind) => {
    setWind(next);
    void engine?.setWind(next).catch((error: unknown) => useAppStore.getState().reportError(error));
  };
  const { state, lastChange } = runways;
  const inUse = state?.arrivalEnds.length
    ? endsLabel(state.arrivalEnds, state.departureEnds)
    : 'Closed';
  return (
    <section aria-label="Runways">
      <h3>Runways</h3>
      <dl className="details">
        <dt>In use</dt>
        <dd>{state?.switching && !state.arrivalEnds.length ? 'Changing' : inUse}</dd>
        {state?.switching && (
          <>
            <dt>Changing to</dt>
            <dd>
              {state.switching.to ?? 'Closed'} since {localTime(state.switching.sinceS)}
              {state.switching.closingEnds.length > 0 &&
                `, clearing ${state.switching.closingEnds.join(', ')}`}
            </dd>
            <dt>Re-routed</dt>
            <dd>{state.switching.rerouted}</dd>
          </>
        )}
        {!state?.switching && lastChange && (
          <>
            <dt>Last change</dt>
            <dd>
              {lastChange.fromId ?? 'Closed'} to {lastChange.toId ?? 'Closed'} at{' '}
              {localTime(lastChange.startS)}, open after{' '}
              {Math.round(lastChange.openS - lastChange.startS)} s, {lastChange.rerouted} re-routed
            </dd>
          </>
        )}
      </dl>
      <Stepper
        label="Wind from (°)"
        value={wind.fromDeg}
        min={0}
        max={350}
        step={10}
        onChange={(value) => change({ ...wind, fromDeg: value })}
      />
      <Stepper
        label="Wind speed (kt)"
        value={wind.speedKt}
        min={0}
        max={40}
        onChange={(value) => change({ ...wind, speedKt: value })}
      />
    </section>
  );
}

const roleLabels = { arrivalEnds: 'Arrivals', departureEnds: 'Departures' };
const fromClock = (clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return h! * 3600 + m! * 60;
};

/** TASK-305: the airport's runway table, as the run uses it (its own, else the table for its
 * ICAO code, else configurations derived from the runway ends): configurations, the time-of-day
 * periods preferring one, and the tailwind limit. Edits are the airport's and need a restart. */
function RunwayTable() {
  const airport = useAppStore((s) => s.session?.project.city.airport);
  const disabled = useAppStore((s) => s.busy || s.viewMode === '3d');
  if (!airport || !Object.keys(airport.runways).length) return null;
  const { commit } = useAppStore.getState();
  const ends = Object.values(airport.runways).flatMap((runway) =>
    runway.ends.map((end) => ({ designator: end.designator, headingRad: end.heading })),
  );
  const designators = ends.map((end) => end.designator).sort();
  const own = airport.runwayOperations;
  const table = airportRunwayConcepts[airport.icao ?? ''];
  const configurations = (own?.configurations ??
    table?.configurations ??
    deriveRunwayConfigurations(ends)) as NonNullable<RunwayOperations['configurations']>;
  const concepts = (own?.concepts ?? table?.concepts ?? []) as NonNullable<
    RunwayOperations['concepts']
  >;
  const save = (change: RunwayOperations) =>
    void commit({ kind: 'setRunwayOperations', operations: { ...own, ...change } });
  const setConfiguration = (index: number, role: 'arrivalEnds' | 'departureEnds', end: string) => {
    const configuration = configurations[index]!;
    const list = configuration[role].includes(end)
      ? configuration[role].filter((e) => e !== end)
      : designators.filter((e) => e === end || configuration[role].includes(e));
    save({
      configurations: configurations.map((c, i) =>
        i === index ? { ...c, [role]: list } : { ...c },
      ),
    });
  };
  const setConcept = (index: number, change: Partial<(typeof concepts)[number]>) =>
    save({ concepts: concepts.map((c, i) => (i === index ? { ...c, ...change } : c)) });
  return (
    <details className="disclosure">
      <summary>Runway table</summary>
      <fieldset className="edit-fields" disabled={disabled}>
        <Stepper
          label="Tailwind limit (kt)"
          value={own?.tailwindLimitKt ?? 5}
          min={0}
          max={15}
          onChange={(tailwindLimitKt) => save({ tailwindLimitKt })}
        />
        {configurations.map((configuration, index) => (
          <div
            key={configuration.id}
            role="group"
            aria-label={`Configuration ${configuration.id}`}
            className="runway-configuration"
          >
            <strong>{configuration.id}</strong>
            {(['arrivalEnds', 'departureEnds'] as const).map((role) => (
              <div key={role} className="runway-ends" role="group" aria-label={roleLabels[role]}>
                <span>{roleLabels[role]}</span>
                {designators.map((end) => (
                  <label key={end} className="check-row">
                    <input
                      type="checkbox"
                      checked={configuration[role].includes(end)}
                      disabled={configuration[role].length === 1 && configuration[role][0] === end}
                      onChange={() => setConfiguration(index, role, end)}
                    />
                    {end}
                  </label>
                ))}
              </div>
            ))}
            <button
              disabled={configurations.length === 1}
              onClick={() =>
                save({
                  configurations: configurations.filter((_, i) => i !== index),
                  concepts: concepts.filter((c) => c.configurationId !== configuration.id),
                })
              }
            >
              Remove {configuration.id}
            </button>
          </div>
        ))}
        <button
          onClick={() => {
            let n = configurations.length + 1;
            while (configurations.some((c) => c.id === `Configuration ${n}`)) n++;
            const end = designators[0]!;
            save({
              configurations: [
                ...configurations,
                { id: `Configuration ${n}`, arrivalEnds: [end], departureEnds: [end] },
              ],
            });
          }}
        >
          Add configuration
        </button>
        {concepts.map((concept, index) => (
          <div key={index} className="edit-fields" role="group" aria-label={`Period ${index + 1}`}>
            <TextField
              label="From"
              type="time"
              value={localTime(concept.startS)}
              onCommit={(clock) => setConcept(index, { startS: fromClock(clock) })}
            />
            <TextField
              label="To"
              type="time"
              value={localTime(concept.endS)}
              onCommit={(clock) => setConcept(index, { endS: fromClock(clock) })}
            />
            <label className="edit-field">
              Use
              <select
                value={concept.configurationId ?? ''}
                onChange={(event) =>
                  setConcept(index, { configurationId: event.currentTarget.value || null })
                }
              >
                {configurations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}
                  </option>
                ))}
                <option value="">Closed</option>
              </select>
            </label>
            <button onClick={() => save({ concepts: concepts.filter((_, i) => i !== index) })}>
              Remove period
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            save({
              concepts: [
                ...concepts,
                { startS: 6 * 3600, endS: 22 * 3600, configurationId: configurations[0]!.id },
              ],
            })
          }
        >
          Add period
        </button>
        {own && (
          <button onClick={() => void commit({ kind: 'setRunwayOperations', operations: null })}>
            Reset runway table
          </button>
        )}
      </fieldset>
    </details>
  );
}

export function FlightBoardInspector() {
  const board = useFlightBoard();
  if (!board) return null;
  return (
    <section aria-label="Flight board" className="flight-board">
      <h2>Flight board</h2>
      {board.runways && <Runways runways={board.runways} />}
      {board.runways && <RunwayTable />}
      <Movements title="Departures" rows={board.departures} />
      <Movements title="Arrivals" rows={board.arrivals} />
    </section>
  );
}
