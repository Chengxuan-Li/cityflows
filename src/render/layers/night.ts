import { Container, Graphics, Particle, ParticleContainer, Rectangle, Texture } from 'pixi.js';
import { lampColors, linearToHex, type SceneLight } from '../lighting';

/** TASK-163: the 2D evening. A multiply tint darkens the whole map; above it, additive glows
 * (lamps, platforms, vehicle lights) and copies of the signal heads stay bright. */

/** Vehicle-light sprite in body units: the rear at x = 0, the front bumper at `front`, the beam
 * on to the right edge; the height spans `across` body widths. */
export const vehicleLightSprite = { length: 2.3, front: 1, across: 1.5 };

export function nightTextures() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  // A radial glow, 64 px.
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  // Vehicle lights, 230 x 72 px at y 80: tail-lamps at the rear corners, head-lamps at the
  // bumper and a beam widening ahead.
  const { length, front, across } = vehicleLightSprite;
  const w = 230,
    h = 72,
    top = 80,
    bumper = (w * front) / length,
    half = h / across / 2,
    mid = top + h / 2;
  const beam = ctx.createLinearGradient(bumper, 0, w, 0);
  beam.addColorStop(0, 'rgba(255,214,150,0.5)');
  beam.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(bumper, mid - half * 0.75);
  ctx.lineTo(w, top + 2);
  ctx.lineTo(w, top + h - 2);
  ctx.lineTo(bumper, mid + half * 0.75);
  ctx.closePath();
  ctx.fill();
  const lamp = (x: number, y: number, r: number, rgb: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  };
  for (const side of [-1, 1]) {
    lamp(bumper - 2, mid + side * half * 0.62, 9, '255,240,215');
    lamp(4, mid + side * half * 0.66, 8, '255,40,30');
  }
  const atlas = Texture.from(canvas);
  const frame = (x: number, y: number, width: number, height: number) =>
    new Texture({ source: atlas.source, frame: new Rectangle(x, y, width, height) });
  return { atlas, glow: frame(0, 0, 64, 64), vehicle: frame(0, top, w, h) };
}

export class NightLayer {
  readonly container = new Container();
  private readonly tint = new Graphics();
  private readonly lift = new Graphics();
  readonly textures = nightTextures();
  /** Street-lamp and platform pools. */
  private readonly lamps = new ParticleContainer({ texture: this.textures.glow });
  private readonly platforms = new ParticleContainer({ texture: this.textures.glow });
  readonly vehicles = new ParticleContainer({
    texture: this.textures.vehicle,
    dynamicProperties: { position: true, rotation: true, vertex: true, uvs: true },
  });
  /** Bright copies of the signal heads, recoloured with the originals. */
  readonly signals = new Container();
  private on = false;

  constructor() {
    // Far beyond any city: the tint covers the whole view at every zoom.
    for (const g of [this.tint, this.lift]) g.rect(-1e6, -1e6, 2e6, 2e6).fill(0xffffff);
    this.tint.blendMode = 'multiply';
    this.lift.blendMode = 'add';
    for (const c of [this.lamps, this.platforms, this.vehicles]) c.blendMode = 'add';
    this.container.addChild(
      this.tint,
      this.lift,
      this.platforms,
      this.lamps,
      this.signals,
      this.vehicles,
    );
    this.container.visible = false;
  }

  setPoints(
    lamps: readonly { x: number; y: number; radiusM: number }[],
    platforms: readonly { x: number; y: number; radiusM: number }[],
  ) {
    for (const [container, points, tint] of [
      [this.lamps, lamps, lampColors.street],
      [this.platforms, platforms, lampColors.platform],
    ] as const) {
      container.particleChildren = points.map(
        ({ x, y, radiusM }) =>
          new Particle({
            texture: this.textures.glow,
            x,
            y,
            anchorX: 0.5,
            anchorY: 0.5,
            scaleX: (2 * radiusM) / 64,
            scaleY: (2 * radiusM) / 64,
            tint,
          }),
      );
      container.update();
    }
  }

  /** True when the night layer draws: the vehicles then add their lights to `vehicles`. */
  setLight(light: SceneLight, layers: { streetLights: boolean; signals: boolean; rail: boolean }) {
    const [r, g, b] = light.ambient;
    const dark = Math.min(r, g, b) < 0.999;
    const bright = Math.max(r, g, b) > 1.001;
    this.on = dark || bright || light.artificial > 0;
    this.container.visible = this.on;
    this.tint.visible = dark;
    this.tint.tint = linearToHex([Math.min(1, r), Math.min(1, g), Math.min(1, b)]);
    // Exposure above 1: an additive lift approximates the brighter light a multiply cannot give.
    this.lift.visible = bright;
    const over = (c: number) => Math.max(0, c - 1) * 0.25;
    this.lift.tint = linearToHex([over(r), over(g), over(b)]);
    const glow = light.artificial;
    this.lamps.visible = glow > 0 && layers.streetLights;
    this.platforms.visible = glow > 0 && layers.rail;
    this.lamps.alpha = 0.55 * glow;
    this.platforms.alpha = 0.3 * glow;
    this.signals.visible = glow > 0 && layers.signals;
    this.vehicles.visible = glow > 0;
    this.vehicles.alpha = 0.7 * glow;
    return glow > 0;
  }

  destroy() {
    this.textures.atlas.destroy(true);
  }
}
