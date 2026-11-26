import {
  debugIn2D,
  overlayLabels,
  shadingLabels,
  type DebugOverlay,
  type DebugShading,
} from '../render/debug-settings';
import { DisclosureGroup } from './controls';
import { developerToolsEnabled, useVisual } from './lighting-store';
import { useAppStore } from './store';

const groups: { name: string; overlays: DebugOverlay[] }[] = [
  {
    name: 'Networks',
    overlays: ['roadGraph', 'lanes', 'railGraph', 'airsideGraph', 'walkNetwork', 'places'],
  },
  { name: 'Geometry', overlays: ['wireframe', 'detailRanges'] },
  { name: 'Sim state', overlays: ['vehicles', 'signals', 'aircraft', 'gridlock', 'stats'] },
];

export function DebugSection() {
  const enabled = useVisual(developerToolsEnabled);
  const settings = useVisual((s) => s.visual.debug);
  const setVisual = useVisual((s) => s.setVisual);
  const three = useAppStore((s) => s.viewMode === '3d');
  if (!enabled) return null;
  const current = three ? settings : debugIn2D(settings);
  return (
    <DisclosureGroup title="Debug">
      <div className="debug-display">
        <label className="check-row">
          <input
            type="checkbox"
            checked={current.rendered}
            onChange={(e) =>
              setVisual({ debug: { ...settings, rendered: e.currentTarget.checked } })
            }
          />
          Rendered view
        </label>
        <label className="edit-field">
          Shading
          <select
            value={current.shading}
            disabled={!current.rendered}
            onChange={(e) =>
              setVisual({ debug: { ...settings, shading: e.target.value as DebugShading } })
            }
          >
            {Object.entries(shadingLabels)
              .filter(([key]) => three || key === 'normal' || key === 'heights')
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
        </label>
      </div>
      {groups
        .filter((g) => three || g.name !== 'Geometry')
        .map((group) => (
          <fieldset className="quality-casters" key={group.name}>
            <legend>{group.name}</legend>
            {group.overlays.map((key) => (
              <label key={key} className="check-row">
                <input
                  type="checkbox"
                  checked={current.overlays[key]}
                  onChange={(e) =>
                    setVisual({
                      debug: {
                        ...settings,
                        overlays: { ...settings.overlays, [key]: e.currentTarget.checked },
                      },
                    })
                  }
                />
                {overlayLabels[key]}
              </label>
            ))}
          </fieldset>
        ))}
    </DisclosureGroup>
  );
}
