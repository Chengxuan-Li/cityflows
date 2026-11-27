import { only3D, overlayGroups, shadings, type DebugOverlay } from '../render/debug-settings';
import { useDebug } from './lighting-store';
import { useAppStore } from './store';

/** TASK-380: the developer debug views, shown in the sidebar while developer tools are on. */
export function DebugSection() {
  const { debug, setDebug, setOverlay } = useDebug();
  const view3d = useAppStore((state) => state.viewMode === '3d');
  const hasRail = useAppStore((state) => Boolean(state.session?.compiled.rail));
  const hasAirside = useAppStore((state) => Boolean(state.session?.compiled.airside));
  const applies = (key: DebugOverlay) =>
    (view3d || !only3D.has(key)) &&
    (key !== 'railGraph' || hasRail) &&
    ((key !== 'airsideGraph' && key !== 'aircraft') || hasAirside);
  const shadingOptions = shadings.filter(([key]) => view3d || !only3D.has(key));
  return (
    <section className="debug-views" aria-label="Debug views">
      <div className="debug-rendered">
        <label className="check-row">
          <input
            type="checkbox"
            checked={debug.rendered}
            onChange={(event) => setDebug({ rendered: event.currentTarget.checked })}
          />
          Rendered view
        </label>
        <select
          aria-label="Shading"
          value={shadingOptions.some(([key]) => key === debug.shading) ? debug.shading : 'normal'}
          disabled={!debug.rendered}
          onChange={(event) =>
            setDebug({ shading: event.currentTarget.value as typeof debug.shading })
          }
        >
          {shadingOptions.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {debug.rendered && debug.shading === 'heights' && (
        <p className="muted">Low blue to high red · bridges cased, tunnels dashed</p>
      )}
      {debug.rendered && debug.shading === 'overdraw' && view3d && (
        <p className="muted">Blue: drawn once · red: 16 times or more</p>
      )}
      {overlayGroups.map(({ heading, overlays }) => {
        const shown = overlays.filter(([key]) => applies(key));
        if (!shown.length) return null;
        return (
          <fieldset key={heading} className="debug-group">
            <legend>{heading}</legend>
            {shown.map(([key, label]) => (
              <label key={key} className="check-row">
                <input
                  type="checkbox"
                  checked={debug.overlays[key]}
                  onChange={(event) => setOverlay(key, event.currentTarget.checked)}
                />
                {label}
              </label>
            ))}
          </fieldset>
        );
      })}
    </section>
  );
}
