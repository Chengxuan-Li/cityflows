import type { PaintKind } from './place-paint';

export function PlaceOptions({
  value,
  onChange,
  hint,
}: {
  value: PaintKind;
  onChange: (kind: PaintKind) => void;
  hint: string;
}) {
  return (
    <div className="road-options" aria-label="Place options">
      <label>
        Kind{' '}
        <select value={value} onChange={(e) => onChange(e.target.value as PaintKind)}>
          {(['residential', 'work', 'retail', 'school'] as const).map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">Drag to paint · Paint over the same kind to extend · Esc to cancel</p>
      {hint && <p role="status">{hint}</p>}
    </div>
  );
}
