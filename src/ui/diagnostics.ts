import type { Diagnostic } from '../network';

export function groupDiagnostics(diagnostics: readonly Diagnostic[]) {
  return {
    issues: [
      ...diagnostics.filter((d) => d.severity === 'error'),
      ...diagnostics.filter((d) => d.severity === 'warning'),
    ],
    notes: diagnostics.filter((d) => d.severity === 'info'),
  };
}
