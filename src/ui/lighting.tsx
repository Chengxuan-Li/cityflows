import { exposureRange, type LightingMode } from '../render/lighting';
import { SegmentedControl, Slider } from './controls';
import { useLighting } from './lighting-store';

const modes: { value: LightingMode; label: string; tooltip?: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
  { value: 'clock', label: 'Clock', tooltip: 'Follow the simulation clock' },
];

/** TASK-163: the scene lighting, a per-viewer view preference for both 2D and 3D. */
export function LightingControls() {
  const { lighting, setLighting } = useLighting();
  return (
    <div className="lighting-controls">
      <SegmentedControl
        label="Time of day"
        options={modes}
        value={lighting.mode}
        onChange={(mode) => setLighting({ mode })}
      />
      <label className="edit-field">
        <span>
          Exposure <output>{lighting.exposure.toFixed(2)}×</output>
        </span>
        <Slider
          aria-label="Exposure"
          min={exposureRange.min}
          max={exposureRange.max}
          step={exposureRange.step}
          value={lighting.exposure}
          onChange={(event) => setLighting({ exposure: event.currentTarget.valueAsNumber })}
          onDoubleClick={() => setLighting({ exposure: 1 })}
        />
      </label>
    </div>
  );
}
