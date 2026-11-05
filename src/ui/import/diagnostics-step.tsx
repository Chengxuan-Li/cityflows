import type { ImportResult } from '../../importers/types';
import { groupDiagnostics } from '../diagnostics';

export function DiagnosticsStep({ result }: { result: ImportResult }) {
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
  const { issues, notes } = groupDiagnostics(result.diagnostics);
  return (
    <section aria-label="Import diagnostics">
      <p role="status">
        {result.ok ? `${Object.keys(result.city.roads).length} roads` : 'Import failed'} ·{' '}
        {errors.length} errors · {warnings.length} warnings
      </p>
      {result.ok && <p>{result.city.geo?.source.attribution}</p>}
      <ul className="import-diagnostics">
        {issues.map((d, i) => (
          <li key={i}>
            <strong>{d.severity}</strong> — {d.message}
          </li>
        ))}
      </ul>
      {notes.length > 0 && (
        <section aria-label="Notes">
          <h3>Notes</h3>
          <ul className="import-diagnostics">
            {notes.map((d, i) => (
              <li key={i}>{d.message}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
