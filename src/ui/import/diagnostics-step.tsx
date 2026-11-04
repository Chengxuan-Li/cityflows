import type { ImportResult } from '../../importers/types';

export function DiagnosticsStep({ result }: { result: ImportResult }) {
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
  return (
    <section aria-label="Import diagnostics">
      <p role="status">
        {result.ok ? `${Object.keys(result.city.roads).length} roads` : 'Import failed'} ·{' '}
        {errors.length} errors · {warnings.length} warnings
      </p>
      {result.ok && <p>{result.city.geo?.source.attribution}</p>}
      <ul className="import-diagnostics">
        {result.diagnostics.map((d, i) => (
          <li key={i}>
            <strong>{d.severity}</strong> — {d.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
