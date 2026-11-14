import { useState } from 'react';
import { DEFAULT_MODE_CHOICE, type ModeChoiceConfig } from '../../schema';
import { Slider, Switch } from '../controls';
import { useAppStore } from '../store';

type Numeric = Exclude<keyof ModeChoiceConfig, 'enabled'>;

const sliders: {
  name: Numeric;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { name: 'walkPreferenceMin', label: 'Walk preference', unit: 'min', min: 0, max: 30, step: 1 },
  { name: 'valueOfTimePerH', label: 'Value of time', unit: '€/h', min: 2, max: 40, step: 1 },
  { name: 'carCostPerKm', label: 'Car cost', unit: '€/km', min: 0, max: 1, step: 0.05 },
  {
    name: 'sensitivityPerMin',
    label: 'Cost sensitivity',
    unit: '/min',
    min: 0.05,
    max: 1,
    step: 0.05,
  },
];

function ModeSlider({
  label,
  unit,
  min,
  max,
  step,
  value,
  disabled,
  onCommit,
}: (typeof sliders)[number] & {
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [edit, setEdit] = useState({ source: value, value });
  const draft = edit.source === value ? edit.value : value;
  const save = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="edit-field">
      <span>
        {label}{' '}
        <output>
          {draft} {unit}
        </output>
      </span>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={draft}
        onChange={(event) => setEdit({ source: value, value: event.currentTarget.valueAsNumber })}
        onPointerUp={save}
        onKeyUp={save}
        onBlur={save}
      />
    </label>
  );
}

/** TASK-113: the mode choice's parameters, a scenario input applied at the next restart. */
export function ModeChoiceControls() {
  const demand = useAppStore((state) => state.session!.project.scenarios[0]!.demand);
  const busy = useAppStore((state) => state.busy);
  const { setModeChoice } = useAppStore.getState();
  const config = { ...DEFAULT_MODE_CHOICE, ...demand.modeChoice };
  return (
    <fieldset className="edit-fields mode-choice" aria-label="Mode choice">
      <Switch
        label="Choose walk or car per trip"
        checked={config.enabled}
        disabled={busy}
        onChange={(event) => void setModeChoice({ enabled: event.currentTarget.checked })}
      />
      {sliders.map((slider) => (
        <ModeSlider
          {...slider}
          key={slider.name}
          value={config[slider.name]}
          disabled={busy || !config.enabled}
          onCommit={(value) => void setModeChoice({ [slider.name]: value })}
        />
      ))}
      <p className="muted">
        {config.enabled
          ? 'Short trips walk, long ones drive or ride transit; persons without a free household car walk or ride transit.'
          : 'Everyone with a free household car drives.'}{' '}
        Restart to apply.
      </p>
    </fieldset>
  );
}
