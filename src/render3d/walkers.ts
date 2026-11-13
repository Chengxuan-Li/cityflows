import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import { walkGreenS, type CompiledCity, type CSignal } from '../network';
import { walkSignalMarks } from '../render/layers/walkers';
import { style } from '../render/style';
import type { WalkerSnapshot } from '../render/types';
import type { cityHeights } from './heights';

/** TASK-111: a walker's height above its ground point: the walk surface's curb height, plus 5 m
 * per grade (architecture section 11) for footbridges and decks. */
const groundZ = (heights: ReturnType<typeof cityHeights>, x: number, y: number, layer: number) =>
  heights.terrain.groundAt(x, y) + layer * 5 + 0.14;

/** Walkers as small upright capsules, instanced. */
export class Walkers3D {
  mesh = this.createMesh(256);
  private readonly transform = new Object3D();
  private readonly color = new Color();
  snapshot: WalkerSnapshot | undefined;

  private createMesh(capacity: number) {
    const mesh = new InstancedMesh(
      new CapsuleGeometry(0.22, 1.1, 2, 8).translate(0, 0.77, 0),
      new MeshLambertMaterial(),
      capacity,
    );
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.count = 0;
    mesh.frustumCulled = false;
    return mesh;
  }

  setSnapshot(snapshot: WalkerSnapshot | undefined, heights: ReturnType<typeof cityHeights>) {
    this.snapshot = snapshot;
    const count = snapshot?.count ?? 0;
    if (count > this.mesh.instanceMatrix.count) {
      const previous = this.mesh;
      this.mesh = this.createMesh(2 ** Math.ceil(Math.log2(count)));
      previous.parent!.add(this.mesh);
      previous.removeFromParent();
      previous.geometry.dispose();
      previous.material.dispose();
      previous.dispose();
    }
    this.mesh.count = count;
    for (let i = 0; i < count; i++) {
      const x = snapshot!.x[i]!,
        y = snapshot!.y[i]!;
      this.transform.position.set(x, groundZ(heights, x, y, snapshot!.layer[i]!), y);
      this.transform.rotation.set(0, -snapshot!.heading[i]!, 0);
      this.transform.updateMatrix();
      this.mesh.setMatrixAt(i, this.transform.matrix);
      this.color.setHex(snapshot!.state[i] === 2 ? style.walker.waiting : style.walker.walking);
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  destroy() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}

/** Pedestrian signal heads on short posts at both kerbs of each signalised crossing. */
export function buildWalkSignals(city: CompiledCity, heights: ReturnType<typeof cityHeights>) {
  const marks = city.nodes.flatMap((node) =>
    node.signal ? walkSignalMarks(city, node).map((mark) => ({ ...mark, node: node.idx })) : [],
  );
  const group = new Group();
  const posts = new InstancedMesh(
    new BoxGeometry(0.08, 2.4, 0.08).translate(0, 1.2, 0),
    new MeshLambertMaterial({ color: 0x637773 }),
    Math.max(1, marks.length),
  );
  const heads = new InstancedMesh(
    new BoxGeometry(0.32, 0.42, 0.32).translate(0, 2.25, 0),
    new MeshBasicMaterial(),
    Math.max(1, marks.length),
  );
  posts.count = heads.count = marks.length;
  // TASK-163: signal lamps are light sources; they keep their colour after dark.
  heads.material.userData.lit = true;
  const transform = new Object3D();
  marks.forEach(({ pos, node }, i) => {
    const layer = city.walk.links.find((l) => l.crossing?.node === node)?.layer ?? 0;
    transform.position.set(pos.x, groundZ(heights, pos.x, pos.y, layer), pos.y);
    transform.updateMatrix();
    posts.setMatrixAt(i, transform.matrix);
    heads.setMatrixAt(i, transform.matrix);
  });
  posts.castShadow = true;
  group.add(posts, heads);
  const color = new Color();
  let previous = '';
  let loaded: CompiledCity | null | undefined;
  let lights: ({ signal: CSignal; link: number } | null)[] = [];
  /** Recolours the heads for `timeS` on the loaded signals; true when anything changed. */
  const update = (timeS: number, signals: CompiledCity | null) => {
    if (signals !== loaded) {
      loaded = signals;
      const links = new Map(signals?.walk.links.map((l) => [l.id, l.idx]));
      lights = marks.map(({ link, node }) => {
        const index = signals?.index.node.get(city.nodes[node]!.id);
        const signal = index === undefined ? null : signals!.nodes[index]!.signal;
        const mapped = links.get(city.walk.links[link]!.id);
        return signal && mapped !== undefined ? { signal, link: mapped } : null;
      });
    }
    const key = lights
      .map((light) => (light && walkGreenS(light.signal, light.link, timeS) > 0 ? 1 : 0))
      .join('');
    if (key === previous) return false;
    previous = key;
    marks.forEach((_, i) => {
      heads.setColorAt(i, color.setHex(key[i] === '1' ? style.signalGreen : style.signalRed));
    });
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    return true;
  };
  return { group, update, count: marks.length };
}
