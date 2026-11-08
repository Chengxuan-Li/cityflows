import { Container, ImageSource, Sprite, Texture } from 'pixi.js';
import { lonLatToLocal, type GeoReference } from '../../geo/projection';
import type { Camera } from '../camera';

export const tileSettings = {
  urlTemplate: import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
} as const;

const tilePixels = 256;
const maxZoom = 19;
const cacheSize = 128;
const maxPending = 8;
const fadeMs = 180;
const failureCooldownMs = 15_000;
const mercatorLimit = (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI;

interface Tile {
  pending: boolean;
  sprite?: Sprite;
}

export class Tiles {
  readonly container = new Container();
  private readonly corner;
  private readonly worldSize: number;
  private readonly cache = new Map<string, Tile>();
  private view = '';
  private dirty = true;
  private pending = 0;
  private retryAt = 0;

  constructor(geo: GeoReference) {
    // In the local affine, the Mercator world's northwest corner is the tile grid origin.
    this.corner = lonLatToLocal(geo, { lon: -180, lat: mercatorLimit });
    this.worldSize = lonLatToLocal(geo, { lon: 180, lat: geo.origin.lat }).x - this.corner.x;
  }

  clearView(): void {
    this.container.removeChildren();
    this.dirty = true;
  }

  destroy(): void {
    this.clearView();
    for (const { sprite } of this.cache.values()) {
      sprite?.destroy({ texture: true, textureSource: true });
    }
    this.cache.clear();
    this.container.destroy();
  }

  get needsUpdate(): boolean {
    return (
      this.dirty ||
      this.container.children.some((sprite) => sprite.alpha < 1) ||
      (this.retryAt > 0 && performance.now() >= this.retryAt)
    );
  }

  update(camera: Camera, width: number, height: number, deltaMs: number): boolean {
    let changed = false;
    const z = Math.min(
      maxZoom,
      Math.max(0, Math.round(Math.log2((this.worldSize * camera.zoom) / tilePixels))),
    );
    const count = 2 ** z;
    const size = this.worldSize / count;
    const min = camera.screenToWorld({ x: 0, y: 0 });
    const max = camera.screenToWorld({ x: width, y: height });
    const left = Math.max(0, Math.floor((min.x - this.corner.x) / size));
    const top = Math.max(0, Math.floor((min.y - this.corner.y) / size));
    const right = Math.min(count, Math.ceil((max.x - this.corner.x) / size));
    const bottom = Math.min(count, Math.ceil((max.y - this.corner.y) / size));
    const view = `${z}/${left}/${top}/${right}/${bottom}`;
    if (this.retryAt && performance.now() >= this.retryAt) {
      this.retryAt = 0;
      this.dirty = true;
    }

    if (this.dirty || view !== this.view) {
      const previous = this.container.children.slice();
      this.view = view;
      this.dirty = false;
      this.reconcile(z, size, left, top, right, bottom);
      changed =
        previous.length !== this.container.children.length ||
        previous.some((sprite, i) => sprite !== this.container.children[i]);
    }
    for (const sprite of this.container.children) {
      if (sprite.alpha < 1) {
        changed = true;
        sprite.alpha = Math.min(1, sprite.alpha + deltaMs / fadeMs);
      }
    }
    return changed;
  }

  private reconcile(
    z: number,
    size: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): void {
    const visible = new Set<string>();
    const sprites = new Set<Sprite>();
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const key = `${z}/${x}/${y}`;
        visible.add(key);
        const tile = this.cache.get(key);
        if (tile) {
          this.cache.delete(key);
          this.cache.set(key, tile);
          if (tile.sprite) {
            sprites.add(tile.sprite);
            if (!tile.sprite.parent) this.container.addChild(tile.sprite);
          }
        } else if (this.pending < maxPending && !this.retryAt) {
          this.load(key, z, x, y, size);
        }
      }
    }
    for (let i = this.container.children.length - 1; i >= 0; i--) {
      if (!sprites.has(this.container.children[i] as Sprite)) this.container.removeChildAt(i);
    }
    for (const [key, tile] of this.cache) {
      if (this.cache.size <= cacheSize) break;
      if (visible.has(key) || tile.pending) continue;
      tile.sprite?.destroy({ texture: true, textureSource: true });
      this.cache.delete(key);
    }
  }

  private load(key: string, z: number, x: number, y: number, size: number): void {
    const tile: Tile = { pending: true };
    this.cache.set(key, tile);
    this.pending++;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const finish = () => {
      image.onload = image.onerror = null;
      tile.pending = false;
      this.pending--;
      this.dirty = true;
    };
    image.onload = () => {
      finish();
      if (!this.cache.has(key)) return;
      const texture = new Texture({ source: new ImageSource({ resource: image }) });
      const sprite = new Sprite(texture);
      sprite.position.set(this.corner.x + x * size, this.corner.y + y * size);
      sprite.setSize(size, size);
      sprite.alpha = 0;
      tile.sprite = sprite;
    };
    image.onerror = () => {
      finish();
      // Keep the failed key in the LRU and slow down new requests if the server is unavailable.
      this.retryAt = performance.now() + failureCooldownMs;
    };
    image.src = tileSettings.urlTemplate
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
  }
}
