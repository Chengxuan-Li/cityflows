import type { BufferGeometry } from 'three';
import { headingAtDistance, pointAtDistance } from '../../src/geo/polyline';
import { carColours } from './parking';

// Capture layer: through traffic on roads the simulated trips leave empty (a street below the
// horizon that would otherwise stand still). Each route is a chain of road ids, driven on its
// first lanes; `perRoute` cars loop each one.

export const params = { routes: [] as string[][], perRoute: 4 };

type Vec2 = { x: number; y: number };
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

interface VehicleFrame {
  timeS: number;
  count: number;
  id: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  speed: Float32Array;
  lateralM: Float32Array;
  lane: Int32Array;
  state: Uint8Array;
  vclass: Uint8Array;
  fade: Float32Array;
  poseLane?: Int32Array;
  motionLane?: Int32Array;
  vehicleHues?: Uint32Array;
}
interface VehicleLayer {
  modelGeometries?: readonly BufferGeometry[];
  setSnapshot(snapshot: VehicleFrame): void;
  poses: { snapshot: VehicleFrame | null };
}
interface DrivenLane {
  polyline: Vec2[];
  cumulative: Float64Array;
  lengthM: number;
}
interface RoadNetwork {
  roads: { id: string; lanes: number[] }[];
  lanes: DrivenLane[];
}
/** Adds `perRoute` cars to every snapshot the vehicle layer draws, driving each route (a chain of
 * roads' first lanes) on a loop at 36 to 46 km/h, spaced unevenly, in real colours. They are
 * posed outright (the app's posed-vehicle path), so they take the app's car models and lights,
 * shrinking away within a few metres of the route's ends. */
export function routeCars(
  vehicles: VehicleLayer | undefined,
  city: RoadNetwork | undefined,
  routes: readonly (readonly string[])[],
  perRoute: number,
) {
  if (!vehicles || !city) return () => {};
  const byId = new Map(city.roads.map((r) => [r.id, r]));
  const chains = routes
    .map((ids) => {
      const lanes = ids.map((id) => byId.get(id)?.lanes[0]).filter((l) => l !== undefined);
      if (lanes.length !== ids.length) return null;
      let total = 0;
      const starts = lanes.map((l) => {
        const at = total;
        total += city.lanes[l]!.lengthM;
        return at;
      });
      return { lanes, starts, total };
    })
    .filter((c) => c !== null);
  const cars = chains.flatMap((chain, r) =>
    Array.from({ length: perRoute }, (_, k) => ({
      chain,
      offset: ((k + hash(r * 31 + k) * 0.55) / perRoute) * chain.total,
      speed: 10 + hash(r * 7 + k * 3 + 1) * 2.8,
      colour: carColours[Math.floor(hash(r * 13 + k * 5 + 2) * carColours.length)]!,
    })),
  );
  if (!cars.length) return () => {};
  const original = vehicles.setSnapshot.bind(vehicles);
  const augment = (s: VehicleFrame): VehicleFrame => {
    const n = s.count,
      m = n + cars.length;
    const grow = <T extends Float32Array | Int32Array | Uint32Array | Uint8Array>(
      a: T | undefined,
      empty: number,
    ): T => {
      const TypedArray = (a?.constructor ?? Int32Array) as new (length: number) => T;
      const out = new TypedArray(m);
      out.fill(empty);
      if (a) out.set(a.subarray(0, n) as never);
      return out;
    };
    let lastId = s.vehicleHues?.length ?? 0;
    for (let i = 0; i < n; i++) lastId = Math.max(lastId, s.id[i]!);
    const out: VehicleFrame = {
      ...s,
      count: m,
      id: grow(s.id, 0),
      x: grow(s.x, 0),
      y: grow(s.y, 0),
      heading: grow(s.heading, 0),
      speed: grow(s.speed, 0),
      lateralM: grow(s.lateralM, 0),
      lane: grow(s.lane, 0),
      state: grow(s.state, 1),
      vclass: grow(s.vclass, 0),
      fade: grow(s.fade, 1),
      poseLane: grow(s.poseLane, -1),
      ...(s.motionLane ? { motionLane: grow(s.motionLane, 0) } : {}),
    };
    if (s.vehicleHues) {
      const hues = new Uint32Array(lastId + cars.length);
      hues.set(s.vehicleHues);
      out.vehicleHues = hues;
    }
    cars.forEach((car, k) => {
      const { chain } = car;
      const along =
        (((car.offset + car.speed * s.timeS) % chain.total) + chain.total) % chain.total;
      let j = chain.starts.length - 1;
      while (j > 0 && chain.starts[j]! > along) j--;
      const laneIndex = chain.lanes[j]!,
        lane = city.lanes[laneIndex]!;
      const u = Math.min(lane.lengthM, along - chain.starts[j]!);
      const p = pointAtDistance(lane.polyline, lane.cumulative, u);
      const i = n + k;
      out.id[i] = lastId + 1 + k;
      out.x[i] = p.x;
      out.y[i] = p.y;
      out.heading[i] = headingAtDistance(lane.polyline, lane.cumulative, u);
      out.speed[i] = car.speed;
      out.lane[i] = laneIndex;
      out.poseLane![i] = laneIndex;
      if (out.motionLane) out.motionLane[i] = laneIndex;
      out.fade[i] = Math.min(1, along / 6, (chain.total - along) / 6);
      if (out.vehicleHues) out.vehicleHues[lastId + k] = car.colour;
    });
    return out;
  };
  let source = vehicles.poses.snapshot;
  vehicles.setSnapshot = (snapshot) => {
    source = snapshot;
    original(augment(snapshot));
  };
  if (source) vehicles.setSnapshot(source);
  return () => {
    vehicles.setSnapshot = original;
    if (source) original(source);
  };
}
