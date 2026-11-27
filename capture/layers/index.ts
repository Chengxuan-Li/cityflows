import {
  CanvasTexture,
  Group,
  Vector4,
  type DirectionalLight,
  type Material,
  type Mesh,
} from 'three';
import type { PerspectiveCamera, Scene, WebGLRenderer, Object3D } from 'three';
import type { CompiledCity } from '../../src/network';
import type { RailHeights } from '../../src/network/rail';
import type { SceneLight } from '../../src/render/lighting';
import type { CityGeometry } from '../../src/render/types';
import { walkGeometry } from '../../src/render/walk-geometry';
import type { LightPoint } from '../../src/render3d/lights';
import type { City } from '../../src/schema';
import type { Shot } from '../core/shot';
import { focusOf } from '../core/shot';
import * as airfield from './airfield';
import * as atmosphere from './atmosphere';
import * as curtainWalls from './curtain-walls';
import * as fences from './fences';
import * as trees from './foliage';
import * as parking from './parking';
import { layerNames, type LayerName, type LayerParams } from './registry';
import * as shore from './shore';
import * as surfaces from './surfaces';
import * as tracks from './tracks';
import * as traffic from './traffic';
import * as plants from './undergrowth';
import * as water from './water';
import * as windows from './windows';

// Capture: installs a shot's scene layers into the running app's 3D scene, through the dev-only
// `window.cityflows.scene3D()`. Each layer is self-contained (capture/layers/<layer>.ts, with its
// `params`); this module only orders them and hands each the results of the ones before it (the
// water index, the fence verges, the ground cover). The location's own dressing (`Site`, from
// capture/locations/<name>/site.ts) joins after the shore is cut.

type Vec2 = { x: number; y: number };
type Box = [number, number, number, number];

/** The 3D scene's internals the layers reach into (render3d/scene.ts). */
export interface SceneInternals extends surfaces.SceneSurfaces {
  scene: Scene;
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  light: SceneLight;
  sun: DirectionalLight;
  sky: atmosphere.Stage['sky'];
  rail?: { group: Group; paintCache: { mesh: Object3D }; heights: RailHeights };
  city?: CompiledCity;
  source?: CityGeometry;
  street?: { lampLights: { pool: LightPoint }[] };
  trains?: tracks.TrainView;
  trainTimeS: number;
  parkedCars?: Parameters<typeof parking.fillParking>[0];
  vehicles?: Parameters<typeof traffic.routeCars>[0] & {
    modelGeometries?: import('three').BufferGeometry[];
  };
  parkedSnapshot: Parameters<typeof parking.fillParking>[2];
  vegetation?: { natural: Group; street: Group; update: (distance: number) => void };
  invalidate(): void;
}

export interface SiteContext {
  scene: SceneInternals;
  city: City;
  shot: Shot;
}
/** A location's own dressing and the hooks it gives the generic layers. */
export interface Site {
  /** Ground the location paves: the trees layer takes trees off it. */
  paved?(ctx: SiteContext): ((p: Vec2) => boolean) | undefined;
  /** Planting runs, lamp pools, and ground the plants layer keeps clear or plants unseen. */
  plants?(ctx: SiteContext): {
    runs?: plants.PlantingRun[];
    lamps?: LightPoint[];
    blocked?(p: Vec2): boolean;
    hidden?(p: Vec2): boolean;
  };
  /** A paved frontage the surfaces layer lays slabs on. */
  frontage?(ctx: SiteContext): { x: number; y: number; bearing: number } | undefined;
  /** The location's own props, installed after the shore is cut; returns the undo. */
  install?(ctx: SiteContext): () => void;
}

export const layerDefaults: { [L in LayerName]: LayerParams<L> } = {
  windows: windows.params,
  trees: trees.params,
  water: water.params,
  tracks: tracks.params,
  fences: fences.params,
  plants: plants.params,
  airfield: airfield.params,
  surfaces: surfaces.params,
  shore: shore.params,
  curtainWalls: curtainWalls.params,
  parking: parking.params,
  traffic: traffic.params,
  atmosphere: atmosphere.params,
};

/** A layer's parameters: the shot's over the layer's defaults; undefined when it is off. */
export function layerParams<L extends LayerName>(shot: Shot, name: L): LayerParams<L> | undefined {
  const given = shot.layers[name];
  if (!given || given.on === false) return undefined;
  return { ...layerDefaults[name], ...given } as LayerParams<L>;
}
export const layersOn = (shot: Shot) => layerNames.filter((n) => layerParams(shot, n));

export interface InstalledLayers {
  /** Video time, for waves and clouds. */
  setTime(t: number): void;
  /** Exposure past the app's, as the atmosphere layer's final gain. */
  setGain(gain: number): void;
  dispose(): void;
}

/** A box `half` metres either side of `focus`, where a layer gives none. */
const around = (focus: Vec2, half: number, box: Box | null): Box =>
  box ?? [focus.x - half, focus.y - half, focus.x + half, focus.y + half];

export function installLayers(
  scene3d: unknown,
  city: City,
  shot: Shot,
  site: Site | undefined,
): InstalledLayers {
  const stage = scene3d as SceneInternals;
  const ctx: SiteContext = { scene: stage, city, shot };
  const on = <L extends LayerName>(name: L) => layerParams(shot, name);
  const focus = focusOf(shot);
  const undo: (() => void)[] = [];
  const features = city.context?.features ?? [];

  if (on('windows')) undo.push(windows.detailWindows(stage.scene));
  const tree = on('trees');
  if (tree) undo.push(trees.detailTrees(stage.vegetation, site?.paved?.(ctx), tree.widen));
  const shoreParams = on('shore');
  const waterParams = on('water');
  const mirror = waterParams
    ? water.detailWater(stage, city, shoreParams?.level ?? 0, waterParams.resolution)
    : undefined;
  if (mirror) undo.push(mirror.dispose);
  const track = on('tracks');
  if (track) {
    const removeTrack = tracks.trackDetail(
      stage.rail?.group,
      stage.city?.rail,
      stage.geometry?.heights,
      stage.rail?.heights,
      () => 1 - stage.light.artificial,
      stage.trains,
      { ...track, area: around(focus, 800, track.area) },
    );
    stage.trainTimeS = NaN;
    undo.push(() => {
      removeTrack();
      stage.trainTimeS = NaN;
    });
  }

  // What later layers share: the water below the land, road clearance, the rail fence verges.
  const areas = features
    .filter((f) => f.kind === 'area' && f.class === 'water' && f.rings.length)
    .map((f) => (f as { rings: Vec2[][] }).rings);
  const wet = shore.waterIndex(areas);
  const roads = fences.segmentClearance(
    Object.values(city.roads).map((r) => ({
      line: r.centerline,
      pad: r.lanes.reduce((sum, l) => sum + l.widthM, 0) / 2,
    })),
  );
  const fenceParams = on('fences');
  const plantParams = on('plants');
  const railFences =
    fenceParams?.rail || plantParams
      ? fences.railFences(stage.city?.rail, stage.rail?.heights, roads, wet.inside)
      : undefined;

  const compiled = stage.city;
  const runway = Object.values(city.airport?.runways ?? {})[0];
  let cover: { map: CanvasTexture; bounds: Vector4 } | undefined;
  let plantGroup: Group | undefined;
  if (plantParams) {
    const local = site?.plants?.(ctx) ?? {};
    const area = around(focus, 600, plantParams.area);
    const groundTracks = (compiled?.rail?.tracks ?? []).filter(
      (t) => t.kind !== 'tram' && stage.rail?.heights.grades[t.idx] === 'ground',
    );
    const fenced = new Set(
      groundTracks
        .filter(
          (t) => !plantParams.fenceLines.length || plantParams.fenceLines.includes(t.name ?? ''),
        )
        .map((t) => t.idx),
    );
    const platforms = (compiled?.rail?.platforms ?? []).flatMap((p) =>
      p.shape.kind === 'polygon' ? [p.shape.ring] : [],
    );
    const walks = compiled
      ? walkGeometry(compiled, stage.source)
          .filter((w) => w.layer === 0)
          .flatMap((w) => w.polygons)
      : [];
    const facilities = Object.values(city.parking ?? {}).flatMap((p) =>
      p.shape?.kind === 'polygon' ? [p.shape.ring] : [],
    );
    const [x0, y0, x1, y1] = area;
    const spaces = (compiled?.parkingSpaces ?? [])
      .filter(({ position: p }) => p.x > x0 - 3 && p.x < x1 + 3 && p.y > y0 - 4 && p.y < y1 + 4)
      .map(({ position: p, heading, lengthM, widthM }) => {
        const a = lengthM / 2 + 0.24,
          b = widthM / 2 + 0.24,
          c = Math.cos(heading),
          s = Math.sin(heading);
        return [
          [-a, -b],
          [a, -b],
          [a, b],
          [-a, b],
        ].map(([u, v]) => ({ x: p.x + c * u! - s * v!, y: p.y + s * u! + c * v! }));
      });
    const terrain = stage.geometry?.heights.terrain;
    const low = plants.undergrowth({
      area,
      plots: features.filter(
        (f): f is typeof f & { kind: 'area'; rings: Vec2[][] } =>
          f.kind === 'area' && !!f.rings.length,
      ),
      noPlantPolygons: [
        ...platforms,
        ...facilities,
        ...spaces,
        ...walks,
        ...(compiled?.roads ?? []).filter((r) => r.grade === 0).map((r) => r.surface),
        ...(compiled?.nodes ?? []).filter((n) => n.grade === 0).map((n) => n.outline),
        ...(compiled?.strips ?? []).map((s) => s.polygon),
      ],
      fences: (railFences?.verges ?? []).filter((r) => fenced.has(r.track)),
      tracks: groundTracks.map((t) => ({ line: t.line, pad: 0 })),
      runs: local.runs ?? [],
      lamps: [...(stage.street?.lampLights ?? []).map((l) => l.pool), ...(local.lamps ?? [])],
      blocked: (p) => wet.inside(p) || !!local.blocked?.(p),
      hidden: local.hidden,
      heightAt: (x, z) => terrain?.groundAt(x, z) ?? 0,
      artificial: () => stage.light.artificial,
    });
    undo.push(low.dispose);
    cover = low;
    plantGroup = low.group;
  }

  // Identify the app's asphalt and airfield batches before cutting their geometry to the shore.
  const apron =
    on('airfield') && city.airport && runway
      ? airfield.apronDressing(city.airport, runway, wet.edges)
      : undefined;
  if (apron) undo.push(apron.dispose);
  const surfaceParams = on('surfaces');
  if (surfaceParams) {
    // Without the plants layer the ground has no cover: one black texel, far away.
    const blank = cover
      ? undefined
      : {
          map: new CanvasTexture(document.createElement('canvas')),
          bounds: new Vector4(1e7, 1e7, 1, 1),
        };
    if (blank) undo.push(() => blank.map.dispose());
    undo.push(
      surfaces.surfaceTexture(stage, runway, cover ?? blank!, apron, site?.frontage?.(ctx), {
        ...surfaceParams,
        centre: surfaceParams.centre ?? [focus.x, focus.y],
      }),
    );
  }
  if (shoreParams) {
    undo.push(shore.cutGround(stage.ground, wet, areas));
    const surroundings = stage.surroundings;
    if (surroundings) undo.push(shore.cutFlat(surroundings, wet, undefined, false));
    const flats: Mesh[] = [];
    stage.content.traverse((o) => {
      const mesh = o as Mesh;
      const material = mesh.material as Material & { vertexColors?: boolean };
      if (!mesh.isMesh || mesh === surroundings || mesh === stage.ground) return;
      if (Array.isArray(material) || !material?.vertexColors || mesh.name.startsWith('capture'))
        return;
      const geometry = mesh.geometry;
      if (geometry.index || geometry.getAttribute('position').count > 900_000) return;
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      if (box.max.y - box.min.y < 0.3 && Math.abs(box.min.y) < 0.2) flats.push(mesh);
    });
    for (const mesh of flats) undo.push(shore.cutFlat(mesh, wet));
    undo.push(shore.quayWalls(wet, stage.content, shoreParams.level));
  }
  if (plantGroup) stage.content.add(plantGroup);
  if (site?.install) undo.push(site.install(ctx));

  const props = new Group();
  props.name = 'capture-props';
  if (fenceParams?.rail && railFences) props.add(railFences.group);
  if (fenceParams?.airport)
    props.add(fences.airportFence(city.airport?.boundary, roads, wet.inside));
  const curtain = on('curtainWalls');
  if (curtain)
    props.add(
      curtainWalls.glazedTowers(features, () => stage.light.artificial, curtain.towerHeight),
    );
  stage.content.add(props);
  undo.push(() => props.removeFromParent());

  const fill = on('parking');
  if (fill)
    undo.push(
      parking.fillParking(
        stage.parkedCars,
        stage.city?.parkingSpaces?.length ?? 0,
        stage.parkedSnapshot,
        fill.occupancy,
      ),
    );
  const through = on('traffic');
  if (through?.routes.length)
    undo.push(
      traffic.routeCars(
        stage.vehicles,
        stage.city as unknown as Parameters<typeof traffic.routeCars>[1],
        through.routes,
        through.perRoute,
      ),
    );
  const air = on('atmosphere');
  const atmosphereStage = stage as unknown as atmosphere.Stage;
  let sky: ReturnType<typeof atmosphere.skyAndHaze> | undefined;
  let occlusion: ReturnType<typeof atmosphere.ambientOcclusion> | undefined;
  if (air?.shadows) undo.push(atmosphere.softShadows(atmosphereStage, air.shadowMap));
  if (air?.sky) {
    sky = atmosphere.skyAndHaze(atmosphereStage);
    undo.push(sky.dispose);
  }
  if (air?.occlusion) {
    occlusion = atmosphere.ambientOcclusion(atmosphereStage);
    undo.push(occlusion.dispose);
  }
  stage.invalidate();
  return {
    setTime: (t) => {
      mirror?.setTime(t);
      sky?.setTime(t);
      stage.invalidate();
    },
    setGain: (gain) => {
      occlusion?.setGain(gain);
      stage.invalidate();
    },
    dispose: () => {
      undo.reverse().forEach((u) => u());
      stage.invalidate();
    },
  };
}

/** The exposure the app takes and the final gain past it: the atmosphere layer's occlusion pass
 * carries exposure past its `gainAbove`; without that pass the app takes it all. */
export function exposureSplit(shot: Shot) {
  const air = layerParams(shot, 'atmosphere');
  const limit = air?.occlusion ? air.gainAbove : 3;
  const app = Math.min(limit, shot.light.exposure);
  return { app, gain: shot.light.exposure / app };
}
