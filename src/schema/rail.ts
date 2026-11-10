import type { Vec2 } from '../geo/vec2';

export const railKinds = ['rail', 'light_rail', 'subway', 'tram', 'narrow_gauge'] as const;
export type RailKind = (typeof railKinds)[number];
export interface RailNode {
  id: string;
  pos: Vec2;
  kind: 'plain' | 'switch' | 'buffer_stop' | 'stop' | 'level_crossing';
  layer: number;
  osmId?: number;
  signal?: boolean;
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
  service?: string;
  usage?: string;
  preferredDirection?: 'forward' | 'backward' | 'both';
  name?: string;
  maxSpeedMps?: number;
  osmId?: number;
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
export interface RailNetwork {
  nodes: Record<string, RailNode>;
  tracks: Record<string, RailTrack>;
  platforms: Record<string, RailPlatform>;
}
