import { ParticleContainer, Polygon, type Graphics } from 'pixi.js';
import { expect, it, vi } from 'vitest';
import { buildCity } from '../../fixtures/build-city';
import { compile } from '../../network';
import { cityGrades } from '../grades';
import type { PresentationSnapshot } from '../vehicle-pose';
import { defaultVisual, sceneLight } from '../lighting';
import { NightLayer, tinted } from './night';
import { deckCover } from './shadows';
import { createVehicleLayer, Vehicles } from './vehicles';

function stubCanvas() {
  const context = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  class Canvas {
    width = 0;
    height = 0;
    getContext() {
      return context;
    }
  }
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.stubGlobal('document', { createElement: () => new Canvas() });
}

// TASK-186: the map is tinted by its container, which must equal a multiply pass over it.
it('tints the map by the ambient light and leaves Day untouched', () => {
  expect(tinted(0xffffff, 0x4080c0)).toBe(0x4080c0);
  expect(tinted(0x123456, 0xffffff)).toBe(0x123456);
  expect(tinted(0xff8000, 0x80ff40)).toBe(0x808000);
  stubCanvas();
  try {
    const night = new NightLayer();
    const light = (mode: 'day' | 'evening') => sceneLight({ ...defaultVisual, mode }, 0);
    night.setLight(light('evening'), { streetLights: true, signals: true, rail: true });
    expect(night.mapTint).not.toBe(0xffffff);
    night.setLight(light('day'), { streetLights: true, signals: true, rail: true });
    expect(night.mapTint).toBe(0xffffff);
    night.destroy();
  } finally {
    vi.unstubAllGlobals();
  }
});

// TASK-186: only a grade under a deck needs a container (and a mask) of its own.
it('gives the grades with no deck above them one light container', () => {
  stubCanvas();
  try {
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const night = new NightLayer();
    night.setVehicleGrades([[ring], [], [ring], [], []]);
    const lights = night.vehicleLights;
    expect(lights[0]!.mask).toBeDefined();
    expect(lights[2]!.mask).toBeDefined();
    expect(lights[0]).not.toBe(lights[2]);
    expect(lights[1]!.mask).toBeUndefined();
    expect(lights[3]).toBe(lights[1]);
    expect(lights[4]).toBe(lights[1]);
    expect(
      night.vehicles.children.filter((child) => child instanceof ParticleContainer),
    ).toHaveLength(3);
    night.destroy();
  } finally {
    vi.unstubAllGlobals();
  }
});

// TASK-184: a vehicle's lights are drawn under the decks above it, as the vehicle is.
it('hides the lights of a vehicle under a deck and keeps those of a vehicle on it', () => {
  stubCanvas();
  try {
    // A street along y = 0 and a layer-2 bridge over it at x = 150.
    const b = buildCity('Deck lights', 184);
    b.street(b.node(0, 0), b.node(300, 0));
    const [a, c, d, e] = [
      b.node(150, 150),
      b.node(150, 60, 2),
      b.node(150, -60, 2),
      b.node(150, -150),
    ];
    for (const part of [b.road(a!, c!), b.road(c!, d!), b.road(d!, e!)]) part.layer = 2;
    const result = compile(b.city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
    const net = result.compiled;
    const { roadGrades, nodeGrades } = cityGrades(net);
    const grades = [0, 2];
    const covers = grades.map((grade) => deckCover(net, roadGrades, nodeGrades, grade));
    const under = (rings: readonly (readonly { x: number; y: number }[])[], x: number, y: number) =>
      rings.some((ring) => new Polygon(ring as { x: number; y: number }[]).contains(x, y));
    expect(under(covers[0]!, 150, 0)).toBe(true);
    expect(under(covers[0]!, 50, 0)).toBe(false);
    expect(covers[1]).toEqual([]);

    const night = new NightLayer();
    night.setVehicleGrades(covers);
    const [ground, deck] = night.vehicleLights as [ParticleContainer, ParticleContainer];
    const mask = ground.mask as Graphics;
    expect(mask.containsPoint({ x: 150, y: 0 })).toBe(true);
    expect(mask.containsPoint({ x: 50, y: 0 })).toBe(false);
    expect(deck.mask).toBeUndefined();

    const layers = grades.map(() => createVehicleLayer());
    const vehicles = new Vehicles();
    vehicles.setGeometry(net);
    vehicles.setLayers(
      layers,
      net.lanes.map((lane) => layers[lane.grade === 2 ? 1 : 0]!),
      net.movements.map(() => layers[0]!),
    );
    vehicles.setLights({
      containers: night.vehicleLights,
      vehicle: night.textures.vehicle,
      glow: night.textures.glow,
    });
    const laneOf = (grade: number) => net.lanes.findIndex((lane) => lane.grade === grade);
    // One vehicle on the street beneath the deck, one on the deck above it, one on the street
    // clear of the deck.
    const snapshot: PresentationSnapshot = {
      timeS: 0,
      count: 3,
      id: new Uint32Array([1, 2, 3]),
      vclass: new Uint8Array(3),
      x: new Float32Array([150, 150, 50]),
      y: new Float32Array(3),
      heading: new Float32Array(3),
      speed: new Float32Array(3),
      lateralM: new Float32Array(3),
      lane: new Int32Array([laneOf(0), laneOf(2), laneOf(0)]),
      state: new Uint8Array(3).fill(1),
      fade: new Float32Array(3).fill(1),
    };
    vehicles.update(snapshot);
    expect([ground.visible, deck.visible]).toEqual([true, true]);
    expect(ground.particleChildren.map((particle) => particle.x)).toEqual([150, 50]);
    expect(deck.particleChildren.map((particle) => particle.x)).toEqual([150]);
    // The first of the street's two lights is under the mask, the other is not.
    expect(ground.particleChildren.map((p) => mask.containsPoint({ x: p.x, y: p.y }))).toEqual([
      true,
      false,
    ]);
    // A container with no lights is not drawn: its mask would still cost a pass.
    vehicles.update({
      ...snapshot,
      count: 1,
      id: new Uint32Array([2]),
      lane: new Int32Array([laneOf(2)]),
    });
    expect([ground.visible, deck.visible]).toEqual([false, true]);
    vehicles.setLights(null);
    expect(ground.particleChildren).toHaveLength(0);
    vehicles.destroy();
    night.destroy();
  } finally {
    vi.unstubAllGlobals();
  }
});
