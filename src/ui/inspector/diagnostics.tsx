import { useEffect, useState } from 'react';
import type { EngineClient } from '../../host/client';
import type { Diagnostic } from '../../network';

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
    <>
      <h2>Diagnostics</h2>
      <dl className="details">
        <dt>State hash</dt>
        <dd>
          <code>{error ?? hash ?? '…'}</code>
        </dd>
      </dl>
      <h3>Network validation</h3>
      {diagnostics.length ? (
        <ul className="item-list">
          {diagnostics.map(({ severity, message }, index) => (
            <li key={index}>
              <strong className="capitalize">{severity}</strong>
              <span>{message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No network issues found.</p>
      )}
    </>
  );
}
