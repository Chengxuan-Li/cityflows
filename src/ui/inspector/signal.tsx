import { useMemo, useRef, useState } from 'react';
import { pointAtDistance } from '../../geo/polyline';
import { generateGroupSignalProgram, generateSignalProgram } from '../../network/signal-program';
import { compile, type CNode, type CompiledCity } from '../../network';
import { crossingArms } from '../../network/crossings';
import type { City, JunctionGroup, Node, SignalProgram } from '../../schema';
import { useAppStore } from '../store';
import { NumberField } from './number-field';
import { PopoverButton } from '../controls';

/** TASK-131: with `group`, the editor edits the junction group's program (its road pairs are
 * the group's entry-to-exit chains; applying it sets every member's derived program). */
type Props = { node: CNode; source: Node; compiled: CompiledCity; group?: JunctionGroup };
type Group = SignalProgram['phases'][number]['groups'][number];
type Walk = NonNullable<SignalProgram['phases'][number]['walk']>[number];
const sameGroup = (a: Group, b: Group) => a.from === b.from && a.to === b.to;
/** TASK-170: a program with `key` set, or left out when off. */
function withFlag(program: SignalProgram, key: 'demandSplit' | 'actuated', on: boolean) {
  const next = { ...program, [key]: true };
  if (!on) delete next[key];
  return next;
}
const seconds = (s: number) => Math.round(s * 10) / 10;
const compass = [
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
  'north',
  'north-east',
];

/** TASK-111: the node's signal crossings, one per arm, named by a road end of the arm. */
function signalCrossings(compiled: CompiledCity, node: CNode, city: City) {
  const arms = crossingArms(compiled, node);
  const byArm = new Map<number, number[]>();
  for (const link of compiled.walk.links)
    if (link.crossing?.control === 'signal' && link.crossing.node === node.idx)
      byArm.set(link.crossing.arm, [...(byArm.get(link.crossing.arm) ?? []), link.idx]);
  return [...byArm].map(([arm, links]) => {
    const end = arms[arm]![0]!;
    const angle = Math.atan2(end.direction.y, end.direction.x);
    const name = city.roads[end.road.id]?.name ?? end.road.id;
    return {
      arm,
      links,
      walk: { roadId: end.road.id, end: end.atEnd ? 'end' : 'start' } as Walk,
      label: `${name} (${compass[(Math.round(angle / (Math.PI / 4)) + 8) % 8]})`,
    };
  });
}

export function SignalInspector(props: Props) {
  const city = useAppStore((state) => state.session!.project.city);
  return (
    <details className="disclosure">
      <summary>Signal phases</summary>
      <SignalDraft key={city.version} {...props} city={city} />
    </details>
  );
}

function SignalDraft({ node, source, compiled, city, group }: Props & { city: City }) {
  const program = group ? group.signal! : source.signal!;
  const [draft, setDraft] = useState(program);
  const [active, setActive] = useState(0);
  const busy = useAppStore((state) => state.busy);
  // TASK-170: the loaded run's demand split of this program, shown while the draft splits by
  // demand and has the same phases; editing a green overrides it with fixed greens.
  const timing = useAppStore((state) => state.session?.signalTiming[group?.id ?? node.id]);
  const split = draft.demandSplit && timing?.length === draft.phases.length ? timing : undefined;
  const greenOf = (index: number) => split?.[index] ?? draft.phases[index]!.durationS;
  const drag = useRef<{ x: number; duration: number; secondsPerPixel: number } | null>(null);
  const trial = useMemo(
    () =>
      compile(
        group
          ? {
              ...city,
              junctionGroups: { ...city.junctionGroups, [group.id]: { ...group, signal: draft } },
            }
          : { ...city, nodes: { ...city.nodes, [node.id]: { ...source, signal: draft } } },
      ),
    [city, node.id, source, group, draft],
  );
  const members = new Set<string>(group ? [group.id, ...group.nodes] : [node.id]);
  const diagnostics = trial.diagnostics.filter(
    (d) =>
      d.severity === 'error' ||
      (d.code === 'signal_unserved_movement' && d.refs.some((r) => members.has(r))),
  );
  const conflicts = new Set(
    diagnostics.filter((d) => d.code === 'signal_conflict').flatMap((d) => d.refs),
  );
  const crossings = group ? [] : signalCrossings(compiled, node, city);
  const trialSignal = trial.ok ? trial.compiled.nodes[node.idx]?.signal : undefined;
  /** Walk green per phase and crossing in the draft, derived or explicit (from the trial compile). */
  const walkGreen = (phase: number, crossing: (typeof crossings)[number]) => {
    const links = trialSignal?.phases[phase]?.walk;
    if (!links || !trial.ok) return false;
    const ids = new Set(links.map((i) => trial.compiled.walk.links[i]!.id));
    return crossing.links.some((i) => ids.has(compiled.walk.links[i]!.id));
  };
  function toggleWalk(index: number, crossing: (typeof crossings)[number]) {
    const walk = crossings
      .filter((c) => (c === crossing ? !walkGreen(index, c) : walkGreen(index, c)))
      .map((c) => c.walk);
    changePhase(index, { walk });
  }
  const groups = new Map<string, { roads: Group; movements: number[] }>();
  const compiledGroup = group && compiled.groups?.[compiled.index.group!.get(group.id)!];
  for (const chain of compiledGroup?.chains ?? []) {
    const from = compiled.roads[chain.from]!.id;
    const to = compiled.roads[chain.to]!.id;
    const key = `${from}>${to}`;
    if (!groups.has(key)) groups.set(key, { roads: { from, to }, movements: [] });
    groups.get(key)!.movements.push(...chain.movements);
  }
  for (const index of group ? [] : node.movements) {
    const movement = compiled.movements[index]!;
    const from = compiled.roads[compiled.lanes[movement.fromLane]!.road]!.id;
    const to = compiled.roads[compiled.lanes[movement.toLane]!.road]!.id;
    const key = `${from}>${to}`;
    if (!groups.has(key)) groups.set(key, { roads: { from, to }, movements: [] });
    groups.get(key)!.movements.push(index);
  }
  const cycle = seconds(
    draft.phases.reduce((s, _, i) => s + greenOf(i) + draft.amberS + draft.allRedS, 0),
  );
  const changePhase = (index: number, patch: Partial<SignalProgram['phases'][number]>) =>
    setDraft((current) => ({
      ...current,
      phases: current.phases.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));
  /** A green set by hand: every phase keeps the green shown and the split turns fixed. */
  const changeGreen = (index: number, durationS: number) =>
    setDraft((current) => ({
      ...withFlag(current, 'demandSplit', false),
      phases: current.phases.map((p, i) => ({
        ...p,
        durationS: i === index ? durationS : greenOf(i),
      })),
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
      <p className="muted">
        Cycle {cycle} s
        {draft.demandSplit &&
          (split ? ', split by demand' : ', split by demand when the run loads')}
      </p>
      <label className="phase-pair">
        <input
          type="checkbox"
          checked={draft.demandSplit ?? false}
          onChange={(event) =>
            setDraft(withFlag(draft, 'demandSplit', event.currentTarget.checked))
          }
        />
        Split green by demand
      </label>
      <label className="phase-pair">
        <input
          type="checkbox"
          checked={draft.actuated ?? false}
          onChange={(event) => setDraft(withFlag(draft, 'actuated', event.currentTarget.checked))}
        />
        Actuated: end a green early when no one waits
      </label>
      <label className="phase-pair">
        <input
          type="checkbox"
          checked={draft.turnOnRed ?? false}
          onChange={(event) => setDraft({ ...draft, turnOnRed: event.currentTarget.checked })}
        />
        {city.drivingSide === 'right' ? 'Right' : 'Left'} turn on red
      </label>
      <div className="signal-timeline" aria-label="Signal timeline">
        {draft.phases.map((_, index) => (
          <div
            className="signal-segment"
            key={index}
            style={{ flexGrow: greenOf(index) + draft.amberS + draft.allRedS }}
          >
            <button
              type="button"
              aria-label={`Select phase ${index + 1}`}
              aria-pressed={active === index}
              style={{ flexGrow: greenOf(index) }}
              onClick={() => setActive(index)}
            >
              {index + 1}
              <small>{seconds(greenOf(index))}s</small>
            </button>
            <button
              type="button"
              className="signal-duration"
              role="slider"
              aria-label={`Phase ${index + 1} duration`}
              aria-valuemin={0.1}
              aria-valuenow={greenOf(index)}
              aria-valuetext={`${seconds(greenOf(index))} seconds`}
              onPointerDown={(event) => {
                const width = event.currentTarget
                  .closest('.signal-timeline')!
                  .getBoundingClientRect().width;
                drag.current = {
                  x: event.clientX,
                  duration: greenOf(index),
                  secondsPerPixel: cycle / width,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                setActive(index);
              }}
              onPointerMove={(event) => {
                if (!drag.current) return;
                const durationS = Math.max(
                  0.1,
                  Math.round(
                    drag.current.duration +
                      (event.clientX - drag.current.x) * drag.current.secondsPerPixel,
                  ),
                );
                if (durationS !== greenOf(index)) changeGreen(index, durationS);
              }}
              onLostPointerCapture={() => {
                drag.current = null;
              }}
              onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                changeGreen(
                  index,
                  Math.max(0.1, greenOf(index) + (event.key === 'ArrowRight' ? 1 : -1)),
                );
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
        {crossings.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setDraft({
                ...draft,
                phases: [
                  ...draft.phases,
                  { durationS: 10, groups: [], walk: crossings.map((c) => c.walk) },
                ],
              });
              setActive(draft.phases.length);
            }}
          >
            Add pedestrian phase
          </button>
        )}
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
      {!group && (
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
              const end = incoming
                ? Math.max(0, distance - extent)
                : Math.min(lane.lengthM, extent);
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
          {crossings.map((crossing) => {
            const checked = walkGreen(active, crossing);
            return (
              <g
                key={crossing.arm}
                role="checkbox"
                tabIndex={0}
                aria-label={`${phaseName} crossing ${crossing.label}`}
                aria-checked={checked}
                className={`signal-crossing ${checked ? 'served' : ''}`}
                onClick={() => toggleWalk(active, crossing)}
                onKeyDown={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault();
                    toggleWalk(active, crossing);
                  }
                }}
              >
                <title>Crossing {crossing.label}</title>
                {crossing.links.map((i) => (
                  <path
                    key={i}
                    d={path(compiled.walk.links[i]!.line)}
                    fill="none"
                    strokeWidth={1.2}
                  />
                ))}
              </g>
            );
          })}
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
      )}
      <p className="muted">
        {phaseName} · select arrows to switch road pairs
        {crossings.length > 0 ? ' and crossings to switch walk green' : ''}
      </p>
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
          disabled={!trial.ok || busy || draft === program}
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
          disabled={draft === program}
          onClick={() => {
            setDraft(program);
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
              value={seconds(greenOf(index))}
              min={0.1}
              onCommit={(durationS) => changeGreen(index, durationS!)}
            />
            <PopoverButton label={`Phase ${index + 1} road pairs`} onOpen={() => setActive(index)}>
              {crossings.length > 0 && (
                <p className="muted">
                  Walk green {phase.walk ? 'set by hand' : 'where no traffic leaves the arm'}
                  {phase.walk && (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            phases: current.phases.map((p, i) =>
                              i === index ? { durationS: p.durationS, groups: p.groups } : p,
                            ),
                          }));
                        }}
                      >
                        Derive
                      </button>
                    </>
                  )}
                </p>
              )}
              {crossings.map((crossing) => (
                <label className="phase-pair" key={crossing.arm}>
                  <input
                    type="checkbox"
                    aria-label={`Phase ${index + 1} crossing ${crossing.label}`}
                    checked={walkGreen(index, crossing)}
                    onChange={() => {
                      setActive(index);
                      toggleWalk(index, crossing);
                    }}
                  />
                  Walk: {crossing.label}
                </label>
              ))}
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
            </PopoverButton>
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
            group
              ? generateGroupSignalProgram(group.id, compiled, [])
              : generateSignalProgram(
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
