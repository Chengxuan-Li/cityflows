import { useMemo, useState, type ReactNode } from 'react';
import {
  addsOffline,
  casters,
  category,
  climateZone,
  currentPreset,
  exposureRange,
  foliageSeason,
  intensityRange,
  lightPlace,
  parseVisual,
  qualityPresets,
  treeKits,
  type Caster,
  type FoliageColour,
  type LampMode,
  type LightingMode,
  type QualityPreset,
  type RenderScale,
  type Season,
  type ShadowRange,
  type ShadowResolution,
  type SpeciesMix,
  type TreeKit,
  type VisualSettings,
} from '../render/lighting';
import { DisclosureGroup, SegmentedControl, Sheet, Slider, Stepper, Switch } from './controls';
import { useVisual } from './lighting-store';
import { useAppStore } from './store';

// TASK-341: the Visual quality section: lighting by date, time and place, light by source,
// shadows, trees and render quality, with presets and cost hints. A per-viewer view preference.

type Cost = 'Low' | 'Medium' | 'High';
const modes: { value: LightingMode; label: string; tooltip?: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
  { value: 'clock', label: 'Clock', tooltip: 'Follow the simulation clock' },
  { value: 'fixed', label: 'Fixed', tooltip: 'A fixed date and time' },
];
const presets: { value: QualityPreset; label: string; cost: Cost }[] = [
  { value: 'low', label: 'Low', cost: 'Low' },
  { value: 'balanced', label: 'Balanced', cost: 'Low' },
  { value: 'high', label: 'High', cost: 'Medium' },
  { value: 'ultra', label: 'Ultra', cost: 'High' },
  { value: 'cinematic', label: 'Cinematic', cost: 'High' },
];
const ranges: { value: ShadowRange; label: string; cost: Cost }[] = [
  { value: 'near', label: 'Near', cost: 'Low' },
  { value: 'medium', label: 'Medium', cost: 'Medium' },
  { value: 'far', label: 'Far', cost: 'Medium' },
];
const resolutions: { value: ShadowResolution; cost: Cost }[] = [
  { value: 1024, cost: 'Low' },
  { value: 2048, cost: 'Low' },
  { value: 4096, cost: 'Medium' },
  { value: 8192, cost: 'High' },
];
const scales: { value: RenderScale; cost: Cost }[] = [
  { value: 1, cost: 'Low' },
  { value: 1.5, cost: 'Medium' },
  { value: 2, cost: 'High' },
];
const casterLabels: Record<Caster, string> = {
  buildings: 'Buildings',
  trees: 'Trees',
  vehicles: 'Vehicles',
  aircraft: 'Aircraft',
  people: 'People',
  furniture: 'Street furniture',
};
const mixLabels: Record<SpeciesMix, string> = {
  map: 'Map',
  auto: 'Auto',
  temperate: 'Temperate broadleaf',
  boreal: 'Boreal conifer',
  mediterranean: 'Mediterranean',
  tropical: 'Tropical',
  arid: 'Arid',
  street: 'Street trees',
  custom: 'Custom',
};
const kitLabels: Record<TreeKit, string> = {
  round: 'Round broadleaf',
  spreading: 'Spreading broadleaf',
  columnar: 'Columnar broadleaf',
  palm: 'Palm',
  cone: 'Cone conifer',
  cypress: 'Narrow conifer',
  umbrella: 'Umbrella pine',
};
const seasonLabels: Record<Season | 'auto', string> = {
  auto: 'Auto',
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
};
const colourLabels: Record<FoliageColour, string> = {
  natural: 'Natural',
  vivid: 'Vivid',
  muted: 'Muted',
  map: 'Map',
};
const kelvins = [2000, 2500, 3500, 4500, 5500, 6500, 8000, 10000];
const capital = (text: string) => text[0]!.toUpperCase() + text.slice(1);

/** A category 3 or 4 value's one-line note; categories 1 and 2 carry none. */
function Note({ level }: { level: number }) {
  if (level === 3)
    return <p className="quality-note experimental">Experimental: lowers the frame rate</p>;
  if (level === 4) return <p className="quality-note offline">Offline rendering: very slow</p>;
  return null;
}

/** A labelled control with its cost hint, the hint only where the cost depends on the value. */
function Field({ label, cost, children }: { label: string; cost?: Cost; children: ReactNode }) {
  return (
    <label className="edit-field quality-field">
      <span>{label}</span>
      {children}
      <small className="cost-hint">{cost}</small>
    </label>
  );
}

function Level({
  label,
  value,
  onChange,
  range = intensityRange,
  unit = '×',
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  range?: { min: number; max: number; step: number };
  unit?: string;
}) {
  return (
    <label className="edit-field">
      <span>
        {label} <output>{`${value.toFixed(2)}${unit}`}</output>
      </span>
      <Slider
        aria-label={label}
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        onDoubleClick={() => onChange(1)}
      />
    </label>
  );
}

const degrees = (value: number, positive: string, negative: string) =>
  `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`;

export function VisualQuality() {
  const { visual, setVisual } = useVisual();
  const view3d = useAppStore((state) => state.viewMode === '3d');
  const origin = useAppStore((state) => state.session?.project.city.geo?.origin);
  const hasAirside = useAppStore((state) => Boolean(state.session?.compiled.airside));
  const hasRail = useAppStore((state) => Boolean(state.session?.compiled.rail));
  const [pending, setPending] = useState<Partial<VisualSettings> | null>(null);
  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const place = lightPlace(visual, origin);
  const derivedZone = lightPlace({ ...visual, timeZone: null }, origin).timeZone;
  const preset = currentPreset(visual);
  const levels = category(visual);
  const timed = visual.mode === 'clock' || visual.mode === 'fixed';

  /** A change that turns on an offline value asks first, once a session. */
  const update = (next: Partial<VisualSettings>) => {
    if (
      !useVisual.getState().offlineConfirmed &&
      addsOffline(visual, parseVisual({ ...visual, ...next }))
    )
      setPending(next);
    else setVisual(next);
  };

  return (
    <section className="visual-quality" aria-label="Visual quality">
      {view3d && (
        <>
          <Field label="Preset" cost={presets.find((p) => p.value === preset)?.cost}>
            <select
              aria-label="Preset"
              value={preset}
              onChange={(event) =>
                update(qualityPresets[event.currentTarget.value as QualityPreset])
              }
            >
              {presets.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              <option value="custom" disabled>
                Custom
              </option>
            </select>
          </Field>
          <Note level={Math.max(levels.shadowResolution, levels.renderScale)} />
        </>
      )}
      <DisclosureGroup title="Sun, sky and time">
        <div className="lighting-controls">
          <SegmentedControl
            label="Light"
            options={modes}
            value={visual.mode}
            onChange={(mode) => update({ mode })}
          />
        </div>
        {(timed || view3d) && (
          <Field label="Date">
            <input
              type="date"
              aria-label="Date"
              value={visual.date}
              required
              onChange={(event) => {
                if (event.currentTarget.value) update({ date: event.currentTarget.value });
              }}
            />
          </Field>
        )}
        {visual.mode === 'fixed' && (
          <Field label="Time">
            <input
              type="time"
              aria-label="Time"
              value={visual.time}
              required
              onChange={(event) => {
                if (event.currentTarget.value) update({ time: event.currentTarget.value });
              }}
            />
          </Field>
        )}
        {timed && (
          <>
            <Switch
              label="Override location"
              checked={visual.location !== null}
              onChange={(event) =>
                update({
                  location: event.currentTarget.checked ? { lat: place.lat, lon: place.lon } : null,
                })
              }
            />
            {visual.location ? (
              <>
                <Stepper
                  label="Latitude"
                  min={-90}
                  max={90}
                  step={0.01}
                  value={visual.location.lat}
                  onChange={(lat) => update({ location: { ...visual.location!, lat } })}
                />
                <Stepper
                  label="Longitude"
                  min={-180}
                  max={180}
                  step={0.01}
                  value={visual.location.lon}
                  onChange={(lon) => update({ location: { ...visual.location!, lon } })}
                />
              </>
            ) : (
              <p className="muted">
                {degrees(place.lat, 'N', 'S')}, {degrees(place.lon, 'E', 'W')}
                {origin ? '' : ' (no project location)'}
              </p>
            )}
            <Field label="Time zone">
              <select
                aria-label="Time zone"
                value={visual.timeZone ?? ''}
                onChange={(event) => update({ timeZone: event.currentTarget.value || null })}
              >
                <option value="">Auto: {derivedZone}</option>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <Level
          label="Exposure"
          value={visual.exposure}
          range={exposureRange}
          onChange={(exposure) => update({ exposure })}
        />
      </DisclosureGroup>
      {view3d && (
        <>
          <DisclosureGroup title="Light by source" defaultOpen={false}>
            <Level
              label={visual.mode === 'night' ? 'Moon' : 'Sun'}
              value={visual.sunIntensity}
              onChange={(sunIntensity) => update({ sunIntensity })}
            />
            <Field label="Colour">
              <select
                aria-label="Sun colour"
                value={visual.sunKelvin ?? ''}
                onChange={(event) =>
                  update({
                    sunKelvin: event.currentTarget.value ? Number(event.currentTarget.value) : null,
                  })
                }
              >
                <option value="">Preset</option>
                {kelvins.map((k) => (
                  <option key={k} value={k}>
                    {k} K
                  </option>
                ))}
              </select>
            </Field>
            <Level
              label="Sky fill"
              value={visual.skyIntensity}
              onChange={(skyIntensity) => update({ skyIntensity })}
            />
            <Level
              label="Street lamps"
              value={visual.lampIntensity}
              onChange={(lampIntensity) => update({ lampIntensity })}
            />
            <Field label="Lamps on">
              <select
                aria-label="Street lamps on"
                value={visual.lampMode}
                onChange={(event) => update({ lampMode: event.currentTarget.value as LampMode })}
              >
                <option value="auto">At dusk</option>
                <option value="always">Always</option>
                <option value="off">Off</option>
              </select>
            </Field>
            <Level
              label="Windows lit"
              value={visual.windowShare}
              onChange={(windowShare) => update({ windowShare })}
            />
            <Level
              label="Window brightness"
              value={visual.windowBrightness}
              onChange={(windowBrightness) => update({ windowBrightness })}
            />
            <Level
              label="Vehicle lights"
              value={visual.vehicleLights}
              onChange={(vehicleLights) => update({ vehicleLights })}
            />
            {hasAirside && (
              <Level
                label="Airfield lights"
                value={visual.airfieldLights}
                onChange={(airfieldLights) => update({ airfieldLights })}
              />
            )}
            <Level
              label={hasRail ? 'Rail lights and signals' : 'Signals'}
              value={visual.railLights}
              onChange={(railLights) => update({ railLights })}
            />
          </DisclosureGroup>
          <DisclosureGroup title="Shadows" defaultOpen={false}>
            <Switch
              label="Sun shadows"
              checked={visual.shadows}
              onChange={(event) => update({ shadows: event.currentTarget.checked })}
            />
            <Field
              label="Shading range"
              cost={ranges.find((r) => r.value === visual.shadowRange)!.cost}
            >
              <select
                aria-label="Shading range"
                value={visual.shadowRange}
                disabled={!visual.shadows}
                onChange={(event) =>
                  update({ shadowRange: event.currentTarget.value as ShadowRange })
                }
              >
                {ranges.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Resolution"
              cost={resolutions.find((r) => r.value === visual.shadowResolution)!.cost}
            >
              <select
                aria-label="Shadow resolution"
                value={visual.shadowResolution}
                disabled={!visual.shadows}
                onChange={(event) =>
                  update({
                    shadowResolution: Number(event.currentTarget.value) as ShadowResolution,
                  })
                }
              >
                {resolutions.map(({ value }) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            <Note level={levels.shadowResolution} />
            <div className="lighting-controls">
              <SegmentedControl
                label="Softness"
                options={[
                  { value: 'hard', label: 'Hard' },
                  { value: 'soft', label: 'Soft' },
                ]}
                value={visual.shadowSoft ? 'soft' : 'hard'}
                disabled={!visual.shadows}
                onChange={(value) => update({ shadowSoft: value === 'soft' })}
              />
            </div>
            <fieldset className="quality-casters" disabled={!visual.shadows}>
              <legend>Shadow casters</legend>
              {casters
                .filter((c) => c !== 'aircraft' || hasAirside)
                .map((c) => (
                  <label key={c} className="check-row">
                    <input
                      type="checkbox"
                      checked={visual.casters[c]}
                      onChange={(event) =>
                        update({ casters: { ...visual.casters, [c]: event.currentTarget.checked } })
                      }
                    />
                    {casterLabels[c]}
                    {c === 'trees' && <small className="cost-hint">Medium</small>}
                  </label>
                ))}
            </fieldset>
          </DisclosureGroup>
          <DisclosureGroup title="Vegetation" defaultOpen={false}>
            <Field label="Species mix">
              <select
                aria-label="Species mix"
                value={visual.speciesMix}
                onChange={(event) =>
                  update({ speciesMix: event.currentTarget.value as SpeciesMix })
                }
              >
                {(Object.keys(mixLabels) as SpeciesMix[]).map((mix) => (
                  <option key={mix} value={mix}>
                    {mixLabels[mix]}
                  </option>
                ))}
              </select>
            </Field>
            {visual.speciesMix === 'auto' && (
              <p className="muted">{capital(climateZone(place))} climate</p>
            )}
            {visual.speciesMix === 'custom' &&
              treeKits.map(({ kit }) => (
                <Level
                  key={kit}
                  label={kitLabels[kit]}
                  value={visual.kitWeights[kit]}
                  range={{ min: 0, max: 1, step: 0.05 }}
                  unit=""
                  onChange={(weight) =>
                    update({ kitWeights: { ...visual.kitWeights, [kit]: weight } })
                  }
                />
              ))}
            <Field label="Foliage season">
              <select
                aria-label="Foliage season"
                value={visual.foliageSeason}
                onChange={(event) =>
                  update({ foliageSeason: event.currentTarget.value as Season | 'auto' })
                }
              >
                {(Object.keys(seasonLabels) as (Season | 'auto')[]).map((season) => (
                  <option key={season} value={season}>
                    {seasonLabels[season]}
                  </option>
                ))}
              </select>
            </Field>
            {visual.foliageSeason === 'auto' && (
              <p className="muted">{seasonLabels[foliageSeason(visual, origin)]}</p>
            )}
            <Field label="Foliage colour">
              <select
                aria-label="Foliage colour"
                value={visual.foliageColour}
                onChange={(event) =>
                  update({ foliageColour: event.currentTarget.value as FoliageColour })
                }
              >
                {(Object.keys(colourLabels) as FoliageColour[]).map((colour) => (
                  <option key={colour} value={colour}>
                    {colourLabels[colour]}
                  </option>
                ))}
              </select>
            </Field>
            <Level
              label="Colour variation"
              value={visual.colourVariation}
              range={{ min: 0, max: 1, step: 0.05 }}
              unit=""
              onChange={(colourVariation) => update({ colourVariation })}
            />
          </DisclosureGroup>
          <DisclosureGroup title="Render" defaultOpen={false}>
            <Field
              label="Render scale"
              cost={scales.find((s) => s.value === visual.renderScale)!.cost}
            >
              <select
                aria-label="Render scale"
                value={visual.renderScale}
                onChange={(event) =>
                  update({ renderScale: Number(event.currentTarget.value) as RenderScale })
                }
              >
                {scales.map(({ value }) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </Field>
            <Note level={levels.renderScale} />
            {hasAirside && (
              <Switch
                label="Aircraft drop lines"
                checked={visual.dropLines}
                onChange={(event) => update({ dropLines: event.currentTarget.checked })}
              />
            )}
          </DisclosureGroup>
        </>
      )}
      <Sheet title="Offline rendering" open={pending !== null} onClose={() => setPending(null)}>
        <p>
          This setting is meant for rendering videos frame by frame. The view becomes very slow
          while it is on.
        </p>
        <div className="sheet-actions">
          <button onClick={() => setPending(null)}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              useVisual.setState({ offlineConfirmed: true });
              setVisual(pending!);
              setPending(null);
            }}
          >
            Use it
          </button>
        </div>
      </Sheet>
    </section>
  );
}
