import type { RoadClass } from '../../schema';
import type { OsmWay } from './parse';

const classes = {
  motorway: 'motorway',
  trunk: 'trunk',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  unclassified: 'residential',
  residential: 'residential',
  living_street: 'residential',
  service: 'service',
} satisfies Record<string, RoadClass>;

export const isJetBridge = (way: OsmWay) => way.tag.aeroway === 'jet_bridge';

export function drivableClass(way: OsmWay): RoadClass | undefined {
  if (isJetBridge(way)) return undefined;
  const { tag } = way;
  const highway = tag.highway;
  if (
    !highway ||
    (highway === 'service' && ['parking_aisle', 'driveway'].includes(tag.service ?? ''))
  ) {
    return undefined;
  }
  const base = highway.replace(/_link$/, '');
  if (!Object.hasOwn(classes, base)) return undefined;
  return base === highway ? classes[base as keyof typeof classes] : 'ramp';
}
