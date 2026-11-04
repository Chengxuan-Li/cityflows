import type { DrawRoadOptions } from '../../editor/commands/topology';
import { roadSchema, type RoadClass } from '../../schema';
import { useAppStore } from '../store';

const defaults: Record<RoadClass, number> = {
  motorway: 100,
  trunk: 80,
  primary: 60,
  secondary: 50,
  tertiary: 40,
  residential: 30,
  service: 20,
  ramp: 40,
};
export function RoadOptions({
  value,
  onChange,
}: {
  value: DrawRoadOptions;
  onChange: (options: DrawRoadOptions) => void;
}) {
  const rejected = useAppStore((state) => state.rejectedEdit);
  return (
    <div className="road-options" aria-label="Road options">
      <div className="road-option-fields">
        <label>
          <input
            type="checkbox"
            checked={value.twoWay}
            onChange={(e) => onChange({ ...value, twoWay: e.target.checked })}
          />{' '}
          Two-way
        </label>
        <label>
          Lanes per direction{' '}
          <select
            value={value.lanes}
            onChange={(e) => onChange({ ...value, lanes: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          Class{' '}
          <select
            value={value.roadClass}
            onChange={(e) => {
              const roadClass = e.target.value as RoadClass;
              onChange({ ...value, roadClass, speedKph: defaults[roadClass] });
            }}
          >
            {roadSchema.shape.roadClass.options.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label>
          km/h{' '}
          <input
            aria-label="Drawing speed (km/h)"
            type="number"
            min={1}
            max={200}
            value={value.speedKph}
            onChange={(e) => {
              const speedKph = e.target.valueAsNumber;
              if (Number.isFinite(speedKph) && speedKph > 0) onChange({ ...value, speedKph });
            }}
          />
        </label>
      </div>
      <p className="muted">
        Click vertices · Enter or double-click to finish · Esc to cancel · Space-drag to pan
      </p>
      {rejected.length > 0 && (
        <p role="alert">
          {rejected
            .filter((d) => d.severity === 'error')
            .map((d) => d.message)
            .join('; ')}
        </p>
      )}
    </div>
  );
}
