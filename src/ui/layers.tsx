import { cityMarkingTheme } from '../schema/marking-theme';
import type { MarkingThemeId } from '../schema/city';
import { useMemo } from 'react';
import { placeTrees } from '../render/vegetation';
import { treeContext } from '../render/street';
import type { LayerVisibility } from '../render/types';
import { useAppStore } from './store';
import { LightingControls } from './lighting';
import { AppearanceControls } from './appearance';

const labels: [keyof LayerVisibility, string][] = [
  ['basemap', 'Basemap'],
  ['terrain', 'Terrain'],
  ['context', 'Surroundings'],
  ['labels', 'Labels'],
  ['rail', 'Rail'],
  ['overheadLines', 'Overhead lines'],
  ['buildingDetails', 'Building details'],
  ['parkingStalls', 'Parking stalls'],
  ['parkedCars', 'Parked cars'],
  ['sidewalks', 'Sidewalks'],
  ['footways', 'Footways'],
  ['pedestrians', 'Pedestrians'],
  ['trees', 'Trees'],
  ['streetTrees', 'Street trees'],
  ['streetLights', 'Street lights'],
  ['signs', 'Signs'],
  ['curbs', 'Curbs'],
  ['markings', 'Lane markings'],
  ['roadClasses', 'Road classes'],
  ['vehicleClasses', 'Colour vehicles by class'],
  ['shadows', 'Shadows'],
  ['difference', 'Comparison road usage'],
  ['heat', 'Road speeds'],
  ['queues', 'Queues'],
  ['parkingOccupancy', 'Parking occupancy'],
  ['places', 'Places'],
  ['connectors', 'Entrances and exits'],
  ['signals', 'Signals'],
  ['routes', 'Selected vehicle route'],
  ['disconnected', 'Disconnected roads'],
];

export function Layers() {
  const layers = useAppStore((state) => state.layers);
  const view3d = useAppStore((state) => state.viewMode === '3d');
  const hasGeo = useAppStore((state) => Boolean(state.session?.project.city.geo));
  const hasContext = useAppStore((state) => Boolean(state.session?.project.city.context));
  const showBuildingDetails = useAppStore(
    (state) =>
      state.viewMode === '3d' &&
      state.buildings &&
      state.layers.context &&
      state.session?.project.city.context?.features.some((f) => f.class === 'building'),
  );
  const session = useAppStore((state) => state.session);
  const treeCounts = useMemo(
    () =>
      session ? placeTrees(session.compiled, treeContext(session.project.city)).counts : undefined,
    [session],
  );
  const hasTrees =
    treeCounts &&
    treeCounts.osm + treeCounts.row + treeCounts.wood + treeCounts.scrub + treeCounts.park > 0;
  const hasStreetTrees = Boolean(treeCounts?.street);
  const hasTerrain = useAppStore((state) => Boolean(state.session?.project.city.terrain));
  const hasWalkers = useAppStore((state) =>
    Boolean(
      state.session?.project.population.length ||
      state.session?.project.scenarios[0]!.walkers?.length ||
      Object.values(state.session?.project.city.places ?? {}).some(({ events }) =>
        events.some(({ arrivals, departures }) => arrivals > 0 || departures > 0),
      ),
    ),
  );
  const { toggleLayer } = useAppStore.getState();
  return (
    <section id="layers" className="panel layers-panel" aria-label="Map layers">
      {session && (
        <label>
          Marking style
          <select
            aria-label="Marking style"
            value={cityMarkingTheme(session.project.city)}
            onChange={(event) =>
              void useAppStore
                .getState()
                .commit({ kind: 'setMarkingTheme', theme: event.target.value as MarkingThemeId })
            }
          >
            <option value="de">Germany</option>
            <option value="us">United States</option>
            <option value="uk">United Kingdom</option>
          </select>
        </label>
      )}
      <LightingControls />
      <AppearanceControls />
      {labels
        .filter(
          ([key]) =>
            (key !== 'basemap' || hasGeo) &&
            (key !== 'context' || hasContext) &&
            (key !== 'rail' || Boolean(session?.project.city.rail)) &&
            (key !== 'overheadLines' || Boolean(session?.project.city.rail)) &&
            (key !== 'buildingDetails' || showBuildingDetails) &&
            (key !== 'trees' || hasTrees) &&
            (key !== 'streetTrees' || hasStreetTrees) &&
            (key !== 'terrain' || hasTerrain) &&
            (key !== 'pedestrians' || hasWalkers) &&
            (key !== 'curbs' || view3d),
        )
        .map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={layers[key]}
              disabled={key === 'overheadLines' && !layers.rail}
              onChange={() => toggleLayer(key)}
            />
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
      {layers.parkingOccupancy && (
        <p className="muted">Green has room · amber is busy · red is full</p>
      )}
    </section>
  );
}
