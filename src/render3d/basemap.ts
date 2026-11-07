import type { Sprite } from 'pixi.js';
import {
  Group,
  Line3,
  Mesh,
  MeshLambertMaterial,
  Plane,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import type { GeoReference } from '../geo/projection';
import { Camera, type Bounds } from '../render/camera';
import { Tiles } from '../render/layers/tiles';

/** Intersect the finite camera frustum with the ground, including its far plane
 * where low-pitch views cross the horizon. MapControls always looks at the ground. */
export function groundBounds(camera: PerspectiveCamera): Bounds {
  const corners = Array.from({ length: 8 }, (_, i) =>
    new Vector3(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1).unproject(camera),
  );
  const plane = new Plane(new Vector3(0, 1, 0), 0);
  const points: Vector3[] = [];
  for (let i = 0; i < 8; i++)
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      const point = plane.intersectLine(new Line3(corners[i]!, corners[i | bit]!), new Vector3());
      if (point) points.push(point);
    }
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.z)),
    maxY: Math.max(...points.map((p) => p.z)),
  };
}

/** The existing tile loader owns projection, URL configuration, LRU, request limits,
 * retries and fading. This adapter presents its image sprites as ground meshes. */
export class Basemap3D {
  readonly group = new Group();
  private readonly tiles: Tiles;
  private readonly proxy = new Camera();
  private readonly meshes = new Map<Sprite, Mesh<PlaneGeometry, MeshLambertMaterial>>();

  constructor(geo: GeoReference) {
    this.tiles = new Tiles(geo);
  }

  update(
    camera: PerspectiveCamera,
    width: number,
    height: number,
    deltaMs: number,
    belowGround: boolean,
  ) {
    if (!this.group.visible) return;
    this.proxy.fitToBounds(groundBounds(camera), width, height, 0);
    this.tiles.update(this.proxy, width, height, deltaMs);
    for (const [sprite, mesh] of this.meshes) {
      mesh.visible = false;
      if (sprite.destroyed) {
        this.disposeMesh(mesh);
        this.meshes.delete(sprite);
      }
    }
    for (const child of this.tiles.container.children) {
      const sprite = child as Sprite;
      let mesh = this.meshes.get(sprite);
      if (!mesh) {
        const texture = new Texture(sprite.texture.source.resource);
        texture.colorSpace = SRGBColorSpace;
        texture.needsUpdate = true;
        mesh = new Mesh(
          new PlaneGeometry(sprite.width, sprite.height),
          new MeshLambertMaterial({ map: texture, transparent: true, depthWrite: true }),
        );
        // Tiles precede the translucent fallback ground and write depth, so each
        // ground pixel blends once at 40% rather than two layers accumulating 64%.
        mesh.renderOrder = 1;
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(sprite.x + sprite.width / 2, -0.03, sprite.y + sprite.height / 2);
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.meshes.set(sprite, mesh);
      }
      mesh.visible = true;
      mesh.material.opacity = sprite.alpha * (belowGround ? 0.4 : 1);
    }
  }

  get visibleCount() {
    return [...this.meshes.values()].filter((mesh) => mesh.visible).length;
  }

  private disposeMesh(mesh: Mesh<PlaneGeometry, MeshLambertMaterial>) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    mesh.material.map!.dispose();
    mesh.material.dispose();
  }
  destroy() {
    for (const mesh of this.meshes.values()) this.disposeMesh(mesh);
    this.meshes.clear();
    this.tiles.destroy();
    this.group.removeFromParent();
  }
}
