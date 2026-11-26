import { standKinds, type StandKind } from '../../schema/airport';
import { SegmentedControl } from '../controls';
import { standKindLabels, type AirsideOptions } from './airside';

const help: Record<AirsideOptions['mode'], string> = {
  stand: 'Click by a taxiway to add a stand · Its lead-in joins the nearest taxiway',
  taxiway: 'Click points, starting and ending on the airside · Enter finishes · Esc cancels',
  taxilane: 'Click points, starting and ending on the airside · Enter finishes · Esc cancels',
  hold: 'Click a taxiway to add a holding position',
};

export function AirsideToolOptions({
  value,
  onChange,
}: {
  value: AirsideOptions;
  onChange: (options: AirsideOptions) => void;
}) {
  return (
    <div className="tool-options edit-fields" aria-label="Airside options">
      <SegmentedControl
        label="Add"
        options={[
          { value: 'stand', label: 'Stand' },
          { value: 'taxiway', label: 'Taxiway' },
          { value: 'taxilane', label: 'Taxilane' },
          { value: 'hold', label: 'Hold' },
        ]}
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
      />
      {value.mode === 'stand' && (
        <label className="edit-field">
          Kind
          <select
            value={value.standKind}
            onChange={(e) => onChange({ ...value, standKind: e.target.value as StandKind })}
          >
            {standKinds.map((kind) => (
              <option key={kind} value={kind}>
                {standKindLabels[kind]}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="muted tool-help">{help[value.mode]}</p>
    </div>
  );
}
