import { generateSignalProgram } from '../../importers/signal-program';
import type { CNode, CompiledCity, Turn } from '../../network';
import { movementId, nodeSchema, type Control, type Node, type SignalProgram } from '../../schema';
import { useAppStore } from '../store';
import { SignalInspector } from './signal';

type RoadPair = SignalProgram['phases'][number]['groups'][number];
const arrow: Record<Turn, string> = {
  through: '↑',
  left: '↰',
  right: '↱',
  uturn: '↶',
  merge: '↑',
  diverge: '↑',
};

function samePair(a: RoadPair, b: RoadPair) {
  return a.from === b.from && a.to === b.to;
}

export function NodeInspector({
  node,
  source,
  compiled,
}: {
  node: CNode;
  source: Node;
  compiled: CompiledCity;
}) {
  const { commit } = useAppStore.getState();
  const nodeId = node.id;
  const incoming = compiled.roads.filter(({ to }) => to === node.idx);
  const outgoing = compiled.roads.filter(({ from }) => from === node.idx);
  const byPair = new Map<string, number[]>();
  for (const index of node.movements) {
    const { fromLane, toLane } = compiled.movements[index]!;
    const key = `${compiled.lanes[fromLane]!.road}>${compiled.lanes[toLane]!.road}`;
    const movements = byPair.get(key);
    if (movements) movements.push(index);
    else byPair.set(key, [index]);
  }
  const roadPairs = incoming.flatMap((from) =>
    outgoing.map((to) => ({
      from,
      to,
      roads: { from: from.id, to: to.id },
      movements: byPair.get(`${from.idx}>${to.idx}`) ?? [],
    })),
  );
  const signal = source.signal;

  return (
    <>
      <h2>
        {signal ? 'Signal' : 'Junction'} {nodeId}
      </h2>
      <div className="edit-fields">
        <label className="edit-field">
          Control
          <select
            value={source.control}
            onChange={(event) => {
              const control = event.currentTarget.value as Control;
              void commit({
                kind: 'setControl',
                nodeId,
                control,
                ...(control === 'signal' && {
                  signal: generateSignalProgram(
                    useAppStore.getState().session!.project.city,
                    source,
                    incoming.length,
                    compiled,
                    [],
                  ),
                }),
              });
            }}
          >
            {nodeSchema.shape.control.options.map((control) => (
              <option key={control} value={control} className="capitalize">
                {control}
              </option>
            ))}
          </select>
        </label>
      </div>
      {signal && <SignalInspector node={node} source={source} compiled={compiled} />}
      <details className="disclosure">
        <summary>Turns</summary>
        <p className="muted">Incoming → outgoing · lane 1 is leftmost</p>
        {roadPairs.length === 0 && <p className="muted">No road pairs at this node.</p>}
        <ul className="item-list turn-list">
          {roadPairs.map(({ from, to, roads, movements }) => (
            <li key={`${from.id}>${to.id}`}>
              <strong>
                {from.id} → {to.id}
              </strong>
              <div className="controls">
                {from.lanes.flatMap((fromIndex) =>
                  to.lanes.map((toIndex) => {
                    const a = compiled.lanes[fromIndex]!;
                    const b = compiled.lanes[toIndex]!;
                    if (!a.allowed.some((vehicle) => b.allowed.includes(vehicle))) return null;
                    const id = movementId(a.id, b.id);
                    const movementIndex = compiled.index.movement.get(id);
                    const allowed = movementIndex !== undefined;
                    const turn = movements.length
                      ? compiled.movements[movements[0]!]!.turn
                      : undefined;
                    const rule = { ...roads, fromLane: a.lane, toLane: b.lane };
                    const overridden = source.turnRules.some(
                      (entry) =>
                        samePair(entry, rule) &&
                        entry.fromLane === a.lane &&
                        entry.toLane === b.lane,
                    );
                    const label = `${from.id} lane ${a.lane + 1} → ${to.id} lane ${b.lane + 1}`;
                    return (
                      <div className="turn-toggle" key={id}>
                        <button
                          type="button"
                          aria-label={label}
                          aria-pressed={allowed}
                          title={`${allowed ? 'Ban' : 'Allow'} ${label}`}
                          onClick={() =>
                            void commit({
                              kind: 'setTurnRule',
                              nodeId,
                              rule: {
                                ...rule,
                                allowed: !allowed,
                                provenance: { source: 'authored' },
                              },
                            })
                          }
                        >
                          {a.lane + 1} {turn ? arrow[turn] : '→'} {b.lane + 1}
                        </button>
                        {overridden && (
                          <button
                            type="button"
                            aria-label={`Reset ${label}`}
                            title="Clear turn override"
                            onClick={() => void commit({ kind: 'clearTurnRule', nodeId, rule })}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  }),
                )}
              </div>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
