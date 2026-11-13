import { useEffect, useState } from 'react';
import type { EngineClient } from '../../host/client';
import type { Diagnostic } from '../../network';
import { groupDiagnostics } from '../diagnostics';

export function Diagnostics({
  diagnostics,
  engine,
  timeS,
}: {
  diagnostics: Diagnostic[];
  engine: EngineClient;
  timeS: number;
}) {
  const [hash, setHash] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { issues, notes } = groupDiagnostics(diagnostics);

  useEffect(() => {
    let active = true;
    void engine.hash().then(
      (value) => {
        if (active) {
          setHash(value);
          setError(null);
        }
      },
      (reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [engine, timeS]);

  return (
    <section id="diagnostics" className="panel" aria-label="Validation">
      <dl className="details">
        <dt>State hash</dt>
        <dd>
          <code>{error ?? hash ?? '…'}</code>
        </dd>
      </dl>
      <h3>Issues</h3>
      {issues.length ? (
        <ul className="item-list">
          {issues.map(({ severity, message }, index) => (
            <li key={index}>
              <strong className="capitalize">{severity}</strong>
              <span>{message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No network issues found.</p>
      )}
      {notes.length > 0 && (
        <section aria-label="Notes">
          <h3>Notes</h3>
          <ul className="item-list">
            {notes.map(({ message }, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
