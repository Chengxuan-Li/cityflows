import type { CNode } from '../../network';
import type { Node } from '../../schema';

export function NodeInspector({ node, source }: { node: CNode; source: Node }) {
  const { signal } = node;
  return (
    <>
      <h2>Node</h2>
      <p className="entity-name">{node.id}</p>
      <dl className="details">
        <dt>Control</dt>
        <dd className="capitalize">{node.control}</dd>
        <dt>Movements</dt>
        <dd>{node.movements.length}</dd>
        {signal && (
          <>
            <dt>Cycle</dt>
            <dd>{signal.cycleS} s</dd>
            <dt>Offset</dt>
            <dd>{signal.offsetS} s</dd>
            <dt>Amber</dt>
            <dd>{signal.amberS} s</dd>
            <dt>All red</dt>
            <dd>{signal.allRedS} s</dd>
          </>
        )}
      </dl>
      {signal && (
        <>
          <h3>Signal phases</h3>
          <ol>
            {signal.phases.map(({ durationS, movements }, index) => (
              <li key={index}>
                {durationS} s green · {movements.length} movements
              </li>
            ))}
          </ol>
        </>
      )}
      {source.turnRules.length > 0 && (
        <>
          <h3>Turn rules</h3>
          <ul>
            {source.turnRules.map(({ from, to, fromLane, toLane, allowed }, index) => (
              <li key={index}>
                {from}
                {fromLane === undefined ? '' : ` lane ${fromLane + 1}`} → {to}
                {toLane === undefined ? '' : ` lane ${toLane + 1}`} ·{' '}
                {allowed ? 'Allowed' : 'Banned'}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
