import { useMemo, useRef, useState } from 'react';
import { pointAtDistance } from '../../geo/polyline';
import { generateSignalProgram } from '../../importers/signal-program';
import { compile, type CNode, type CompiledCity } from '../../network';
import type { City, Node, SignalProgram } from '../../schema';
import { useAppStore } from '../store';
import { NumberField } from './number-field';

type Props = { node: CNode; source: Node; compiled: CompiledCity };
type Group = SignalProgram['phases'][number]['groups'][number];
const sameGroup = (a: Group, b: Group) => a.from === b.from && a.to === b.to;

export function SignalInspector(props: Props) {
  const city = useAppStore((state) => state.session!.project.city);
  return (
    <details className="disclosure">
      <summary>Signal phases</summary>
      <SignalDraft key={city.version} {...props} city={city} />
    </details>
  );
}

function SignalDraft({ node, source, compiled, city }: Props & { city: City }) {
  const [draft, setDraft] = useState(source.signal!);
  const [active, setActive] = useState(0);
  const busy = useAppStore((state) => state.busy);
  const drag = useRef<{ x: number; duration: number; secondsPerPixel: number } | null>(null);
  const trial = useMemo(
    () => compile({ ...city, nodes: { ...city.nodes, [node.id]: { ...source, signal: draft } } }),
    [city, node.id, source, draft],
  );
  const diagnostics = trial.diagnostics.filter(
    (d) =>
      d.severity === 'error' || (d.code === 'signal_unserved_movement' && d.refs.includes(node.id)),
  );
  const conflicts = new Set(
    diagnostics.filter((d) => d.code === 'signal_conflict').flatMap((d) => d.refs),
  );
  const groups = new Map<string, { roads: Group; movements: number[] }>();
  for (const index of node.movements) {
    const movement = compiled.movements[index]!;
    const from = compiled.roads[compiled.lanes[movement.fromLane]!.road]!.id;
    const to = compiled.roads[compiled.lanes[movement.toLane]!.road]!.id;
    const key = `${from}>${to}`;
    if (!groups.has(key)) groups.set(key, { roads: { from, to }, movements: [] });
    groups.get(key)!.movements.push(index);
  }
  const cycle = draft.phases.reduce((s, p) => s + p.durationS + draft.amberS + draft.allRedS, 0);
  const changePhase = (index: number, patch: Partial<SignalProgram['phases'][number]>) =>
    setDraft((current) => ({
      ...current,
      phases: current.phases.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));
  function toggle(index: number, roads: Group) {
    const phase = draft.phases[index]!;
    changePhase(index, {
      groups: phase.groups.some((g) => sameGroup(g, roads))
        ? phase.groups.filter((g) => !sameGroup(g, roads))
        : [...phase.groups, roads],
    });
  }
  const extent = node.radiusM * 2.5;
  const path = (points: { x: number; y: number }[]) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${p.x - node.pos.x},${p.y - node.pos.y}`).join(' ');
  const phaseName = `Phase ${active + 1}`;
  return (
    <div className="signal-editor">
      <p className="muted">Cycle {cycle} s</p>
      <label className="phase-pair">
        <input
          type="checkbox"
          checked={draft.turnOnRed ?? false}
          onChange={(event) => setDraft({ ...draft, turnOnRed: event.currentTarget.checked })}
        />
        {city.drivingSide === 'right' ? 'Right' : 'Left'} turn on red
      </label>
      <div className="signal-timeline" aria-label="Signal timeline">
        {draft.phases.map((phase, index) => (
          <div
            className="signal-segment"
            key={index}
            style={{ flexGrow: phase.durationS + draft.amberS + draft.allRedS }}
          >
            <button
              type="button"
              aria-label={`Select phase ${index + 1}`}
              aria-pressed={active === index}
              style={{ flexGrow: phase.durationS }}
              onClick={() => setActive(index)}
            >
              {index + 1}
              <small>{phase.durationS}s</small>
            </button>
            <button
              type="button"
              className="signal-duration"
              role="slider"
              aria-label={`Phase ${index + 1} duration`}
              aria-valuemin={0.1}
              aria-valuenow={phase.durationS}
              aria-valuetext={`${phase.durationS} seconds`}
              onPointerDown={(event) => {
                const width = event.currentTarget
                  .closest('.signal-timeline')!
                  .getBoundingClientRect().width;
                drag.current = {
                  x: event.clientX,
                  duration: phase.durationS,
                  secondsPerPixel: cycle / width,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                setActive(index);
              }}
              onPointerMove={(event) => {
                if (!drag.current) return;
                changePhase(index, {
                  durationS: Math.max(
                    0.1,
                    Math.round(
                      drag.current.duration +
                        (event.clientX - drag.current.x) * drag.current.secondsPerPixel,
                    ),
                  ),
                });
              }}
              onLostPointerCapture={() => {
                drag.current = null;
              }}
              onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                changePhase(index, {
                  durationS: Math.max(0.1, phase.durationS + (event.key === 'ArrowRight' ? 1 : -1)),
                });
              }}
            />
            <span
              className="signal-amber"
              style={{ flexGrow: draft.amberS }}
              title={`Amber ${draft.amberS} s`}
            />
            <span
              className="signal-red"
              style={{ flexGrow: draft.allRedS }}
              title={`All red ${draft.allRedS} s`}
            />
          </div>
        ))}
      </div>
      <div className="controls">
        <button
          type="button"
          onClick={() => {
            setDraft({ ...draft, phases: [...draft.phases, { durationS: 15, groups: [] }] });
            setActive(draft.phases.length);
          }}
        >
          Add phase
        </button>
        <button
          type="button"
          disabled={draft.phases.length === 1}
          onClick={() => {
            setDraft({ ...draft, phases: draft.phases.filter((_, i) => i !== active) });
            setActive(Math.max(0, active - 1));
          }}
        >
          Remove phase
        </button>
      </div>
      <svg
        className="signal-schematic"
        viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`}
        aria-label={`${phaseName} movement schematic`}
      >
        <defs>
          <marker
            id="signal-arrow"
            viewBox="0 0 6 6"
            refX="5"
            refY="3"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="context-stroke" />
          </marker>
        </defs>
        {compiled.lanes
          .filter((lane) => {
            const road = compiled.roads[lane.road]!;
            return road.from === node.idx || road.to === node.idx;
          })
          .map((lane) => {
            const incoming = compiled.roads[lane.road]!.to === node.idx;
            const distance = incoming ? lane.lengthM : 0;
            const end = incoming ? Math.max(0, distance - extent) : Math.min(lane.lengthM, extent);
            return (
              <path
                key={lane.id}
                d={path([
                  pointAtDistance(lane.polyline, lane.cumulative, distance),
                  pointAtDistance(lane.polyline, lane.cumulative, end),
                ])}
                stroke="#dcded2"
                strokeWidth={lane.widthM}
                strokeLinecap="round"
              />
            );
          })}
        <circle r={node.radiusM} fill="#e8e8dc" />
        {[...groups.values()].map(({ roads, movements }) => {
          const checked = draft.phases[active]!.groups.some((g) => sameGroup(g, roads));
          const conflict = movements.some((i) => conflicts.has(compiled.movements[i]!.id));
          return (
            <g
              key={`${roads.from}>${roads.to}`}
              role="checkbox"
              tabIndex={0}
              aria-label={`${phaseName} arrow ${roads.from} → ${roads.to}`}
              aria-checked={checked}
              className={`signal-movement ${checked ? 'served' : ''} ${conflict ? 'conflict' : ''}`}
              onClick={() => toggle(active, roads)}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  toggle(active, roads);
                }
              }}
            >
              <title>
                {roads.from} → {roads.to}
              </title>
              {movements.map((i) => (
                <path
                  key={i}
                  d={path(compiled.movements[i]!.polyline)}
                  fill="none"
                  strokeWidth={0.45}
                  markerEnd="url(#signal-arrow)"
                />
              ))}
            </g>
          );
        })}
      </svg>
      <p className="muted">{phaseName} · select arrows to switch road pairs</p>
      <div className="signal-validation" aria-live="polite">
        {!trial.ok && (
          <div role="alert">
            {diagnostics
              .filter((d) => d.severity === 'error')
              .map((d) => (
                <p key={d.message}>{d.message}</p>
              ))}
          </div>
        )}
        {diagnostics.some((d) => d.severity === 'warning') && (
          <details>
            <summary>
              Unserved movements ({diagnostics.filter((d) => d.severity === 'warning').length})
            </summary>
            {diagnostics
              .filter((d) => d.severity === 'warning')
              .map((d) => (
                <p key={d.message}>{d.message}</p>
              ))}
          </details>
        )}
      </div>
      <div className="controls">
        <button
          type="button"
          disabled={!trial.ok || busy || draft === source.signal}
          onClick={() =>
            void useAppStore
              .getState()
              .commit({ kind: 'setSignal', nodeId: node.id, signal: draft })
          }
        >
          Apply signal program
        </button>
        <button
          type="button"
          disabled={draft === source.signal}
          onClick={() => {
            setDraft(source.signal!);
            setActive(0);
          }}
        >
          Discard changes
        </button>
      </div>
      <ul className="item-list phase-list">
        {draft.phases.map((phase, index) => (
          <li key={index}>
            <NumberField
              label={`Phase ${index + 1} green (s)`}
              value={phase.durationS}
              min={0.1}
              onCommit={(durationS) => changePhase(index, { durationS: durationS! })}
            />
            <details
              onToggle={(event) => {
                if (event.currentTarget.open) setActive(index);
              }}
            >
              <summary>Phase {index + 1} road pairs</summary>
              {[...groups.values()].map(({ roads }) => (
                <label className="phase-pair" key={`${roads.from}>${roads.to}`}>
                  <input
                    type="checkbox"
                    aria-label={`Phase ${index + 1} movement ${roads.from} → ${roads.to}`}
                    checked={phase.groups.some((g) => sameGroup(g, roads))}
                    onChange={() => {
                      setActive(index);
                      toggle(index, roads);
                    }}
                  />
                  {roads.from} → {roads.to}
                </label>
              ))}
            </details>
          </li>
        ))}
      </ul>
      <div className="edit-fields">
        <NumberField
          label="Amber (s)"
          value={draft.amberS}
          onCommit={(amberS) => setDraft({ ...draft, amberS: amberS! })}
        />
        <NumberField
          label="All red (s)"
          value={draft.allRedS}
          onCommit={(allRedS) => setDraft({ ...draft, allRedS: allRedS! })}
        />
        <NumberField
          label="Offset (s)"
          value={draft.offsetS}
          min={-Number.MAX_VALUE}
          onCommit={(offsetS) => setDraft({ ...draft, offsetS: offsetS! })}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          setDraft(
            generateSignalProgram(
              city,
              source,
              compiled.roads.filter((r) => r.to === node.idx).length,
              compiled,
              [],
            ),
          );
          setActive(0);
        }}
      >
        Generate default program
      </button>
    </div>
  );
}
