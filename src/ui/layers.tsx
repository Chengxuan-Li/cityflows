import { useEffect } from 'react';
import type { LayerVisibility } from '../render/types';
import { useAppStore } from './store';

const labels: [keyof LayerVisibility, string][] = [
  ['basemap', 'Basemap'],
  ['context', 'Surroundings'],
  ['roadClasses', 'Road classes'],
  ['shadows', 'Shadows'],
  ['difference', 'Comparison road usage'],
  ['heat', 'Road speeds'],
  ['queues', 'Queues'],
  ['places', 'Places'],
  ['connectors', 'Entrances and exits'],
  ['signals', 'Signals'],
  ['routes', 'Selected vehicle route'],
  ['disconnected', 'Disconnected roads'],
];

export function Layers() {
  const layers = useAppStore((state) => state.layers);
  const hasGeo = useAppStore((state) => Boolean(state.session?.project.city.geo));
  const hasContext = useAppStore((state) => Boolean(state.session?.project.city.context));
  const { toggleLayer, toggleLayers } = useAppStore.getState();
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggleLayers();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [toggleLayers]);
  return (
    <section id="layers" className="layers-sheet" aria-label="Map layers">
      {labels
        .filter(([key]) => (key !== 'basemap' || hasGeo) && (key !== 'context' || hasContext))
        .map(([key, label]) => (
          <label key={key}>
            <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} />
            {label}
          </label>
        ))}
      {layers.heat && (
        <p className="heat-key">
          <span /> Darker roads are slower
        </p>
      )}
      {layers.difference && (
        <p className="difference-key">
          <span className="usage-up">More vehicles</span> ·{' '}
          <span className="usage-down">Fewer vehicles</span>
        </p>
      )}
      {layers.queues && (
        <p className="muted">Larger dots mean more stopped cars near a lane end.</p>
      )}
    </section>
  );
}
