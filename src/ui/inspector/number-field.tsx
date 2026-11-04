export function NumberField({
  label,
  value,
  onCommit,
  min = 0,
  max,
  step = 'any',
  nullable = false,
}: {
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  nullable?: boolean;
}) {
  const text = value === null ? '' : String(value);
  return (
    <label className="edit-field">
      {label}
      <input
        key={text}
        type="number"
        min={min}
        max={max}
        step={step}
        required={!nullable}
        placeholder={nullable ? 'Unlimited' : undefined}
        defaultValue={text}
        onBlur={({ currentTarget: input }) => {
          const next = input.value === '' ? null : input.valueAsNumber;
          const valid = input.validity.valid;
          input.value = text;
          if (valid && next !== value) onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.currentTarget.reportValidity()) {
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
            event.currentTarget.value = text;
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
