import { exposureRange, type LightingMode } from '../render/lighting';
import { useLighting } from './lighting-store';

const modes: [LightingMode, string][] = [
  ['day', 'Day'],
  ['evening', 'Evening'],
  ['night', 'Night'],
  ['clock', 'Follow clock'],
];

export function LightingControls() {
  const { lighting, setLighting } = useLighting();
  return (
    <>
      <label>
        Light
        <select
          aria-label="Time of day"
          value={lighting.mode}
          onChange={(event) => setLighting({ mode: event.target.value as LightingMode })}
        >
          {modes.map(([mode, label]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Exposure
        <input
          type="range"
          aria-label="Exposure"
          min={exposureRange.min}
          max={exposureRange.max}
          step={exposureRange.step}
          value={lighting.exposure}
          onChange={(event) => setLighting({ exposure: Number(event.target.value) })}
          onDoubleClick={() => setLighting({ exposure: 1 })}
        />
      </label>
    </>
  );
}
