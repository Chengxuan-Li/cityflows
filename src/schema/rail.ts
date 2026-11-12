import type { Vec2 } from '../geo/vec2';
import type { Provenance } from './city';

export const railKinds = ['rail', 'light_rail', 'subway', 'tram', 'narrow_gauge'] as const;
export type RailKind = (typeof railKinds)[number];
/** TASK-135: how a tram track is laid. `embedded` runs in the road surface; the others are an
 * own bed of grass, paving or ballast. */
export const trackForms = ['embedded', 'grass', 'paved', 'ballast'] as const;
export type TrackForm = (typeof trackForms)[number];
export interface RailNode {
  id: string;
  pos: Vec2;
  kind: 'plain' | 'switch' | 'buffer_stop' | 'stop' | 'level_crossing';
  layer: number;
  osmId?: number;
  signal?: boolean;
  /** TASK-136: mapped crossing tags; absent in older projects. Pedestrian crossings have no road equipment. */
  crossing?: {
    kind: 'rail' | 'tram' | 'pedestrian';
    barrier?: string;
    lights?: string;
    bell?: string;
    /** Raw highway ways sharing this OSM node, including excluded driveways and footpaths. */
    roadOsmIds?: number[];
  };
}
export interface RailTrack {
  id: string;
  from: string;
  to: string;
  line: Vec2[];
  kind: RailKind;
  layer: number;
  bridge?: boolean;
  tunnel?: boolean;
  /** TASK-132: at grade under a roof (`tunnel=building_passage`, `covered=yes`), not below ground. */
  covered?: boolean;
  service?: string;
  usage?: string;
  preferredDirection?: 'forward' | 'backward' | 'both';
  name?: string;
  maxSpeedMps?: number;
  osmId?: number;
  /** Trams only; absent on other kinds and on trams of older projects (drawn as embedded). */
  form?: TrackForm;
  /** `inferred: ['form']` when no tag decided the form (TASK-135). */
  provenance?: Provenance;
  /** TASK-134: an overhead contact line, from `electrified`; absent when untagged (drawn wired). */
  contactLine?: boolean;
}
export interface RailPlatform {
  id: string;
  shape:
    | { kind: 'polygon'; ring: Vec2[] }
    | { kind: 'line'; line: Vec2[] }
    | { kind: 'point'; pos: Vec2 };
  layer: number;
  name: string;
  ref?: string;
  mode: 'rail' | 'tram' | 'bus';
  tracks: string[];
  station: string | null;
  osmId?: number;
}
/**
 * TASK-137: a tram stop is one platform island and the tram track sections it serves. A stop of a
 * mapped platform keeps that platform's shape (an `rp:` platform, a polygon or a line); a stop
 * with only stop positions gets an island generated beside its track (`ring`, closed, clear of
 * every carriageway lane), or `null` when no room was left.
 */
export interface TramStop {
  id: string;
  name: string;
  /** Lines calling here: `route_ref`, else route relations, else the stop's description. */
  lines: string[];
  layer: number;
  /** The served tram track sections. */
  tracks: string[];
  /** Where trams halt: the stop positions on the served tracks. */
  halts: { track: string; pos: Vec2 }[];
  platform: { kind: 'mapped'; platform: string } | { kind: 'generated'; ring: Vec2[] } | null;
  /** From the platform's or the stop's tags `shelter`, `bench`, `covered`, `tactile_paving`. */
  shelter?: boolean;
  bench?: boolean;
  covered?: boolean;
  tactilePaving?: boolean;
  /** The OSM nodes, ways and relations it was built from. */
  osmIds: number[];
  provenance?: Provenance;
}

/** TASK-134: a mapped `power=catenary_mast` node. */
export interface CatenaryMast {
  pos: Vec2;
  osmId: number;
}
export interface RailNetwork {
  nodes: Record<string, RailNode>;
  tracks: Record<string, RailTrack>;
  platforms: Record<string, RailPlatform>;
  /** TASK-137; absent on cities without tram stops and on older projects. */
  tramStops?: Record<string, TramStop>;
  masts?: CatenaryMast[];
}
