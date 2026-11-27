// Capture: the scene layers a shot can turn on, in the order they install. Names and types only,
// so the shot file can be checked without loading three; the defaults live in each layer's module
// (`params`) and capture/layers/index.ts installs them.

export const layerNames = [
  'windows',
  'trees',
  'water',
  'tracks',
  'fences',
  'plants',
  'airfield',
  'surfaces',
  'shore',
  'curtainWalls',
  'parking',
  'traffic',
  'atmosphere',
] as const;
export type LayerName = (typeof layerNames)[number];

interface LayerParamMap {
  windows: typeof import('./windows').params;
  trees: typeof import('./foliage').params;
  water: typeof import('./water').params;
  tracks: typeof import('./tracks').params;
  fences: typeof import('./fences').params;
  plants: typeof import('./undergrowth').params;
  airfield: typeof import('./airfield').params;
  surfaces: typeof import('./surfaces').params;
  shore: typeof import('./shore').params;
  curtainWalls: typeof import('./curtain-walls').params;
  parking: typeof import('./parking').params;
  traffic: typeof import('./traffic').params;
  atmosphere: typeof import('./atmosphere').params;
}
export type LayerParams<L extends LayerName> = LayerParamMap[L] & { on?: boolean };

export const layerLabels: Record<LayerName, string> = {
  windows: 'Sharp windows',
  trees: 'Detailed trees',
  water: 'Water reflections',
  tracks: 'Track detail',
  fences: 'Fences',
  plants: 'Low plants',
  airfield: 'Airfield',
  surfaces: 'Surfaces',
  shore: 'Shore and quays',
  curtainWalls: 'Curtain walls',
  parking: 'Full car parks',
  traffic: 'Through traffic',
  atmosphere: 'Atmosphere',
};
