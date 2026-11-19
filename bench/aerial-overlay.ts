import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { booleanOpD, ClipType, FillRule } from 'clipper2-ts';
import {
  cumulativeLengths,
  headingAtDistance,
  nearestOnPolyline,
  offsetPolyline,
  pointAtDistance,
  segmentIntersection,
  polylineLength,
  trimPolyline,
} from '../src/geo/polyline';
import type { Vec2 } from '../src/geo/vec2';
import { compile } from '../src/network';
import {
  crossingStripes,
  gorePavement,
  nodeMarkingGeometry,
  roadMarkingGeometry,
  transitionGeometry,
  transitionMarkings,
  type MarkingShape,
} from '../src/render/marking-geometry';
import { paintedCity } from '../src/render/road-paint';
import { markingThemes } from '../src/render/style';
import { cityMarkingTheme } from '../src/schema/marking-theme';
import { openFreiburg } from './freiburg';

// TASK-216: the compiled Freiburg project drawn over LGL Baden-Württemberg's DOP20 orthophotos
// around the Hauptbahnhof, for a check of the road shapes against the ground.
//   node --experimental-strip-types --import ./bench/register.ts bench/aerial-overlay.ts <command>
//   fetch <data-dir>              the imagery tiles of BOX
//   register <data-dir>           the registration on tram rails (RAIL_STRETCHES)
//   render <data-dir> <out-dir>   the findings' close-ups (VIEWS, or --only <id,id>), --sweep (the
//                                 box in overview tiles) or --view <spec>... (ad hoc, parseView)
//   shots3d <out-dir>             VIEWS in the app's 3D view (dev server on port 5416)
// `fetch` reads the service's capabilities, stops unless its access constraints are the open
// licence below, and saves the box as JPEG tiles with `tiles.json`. The tiles are third-party
// data and stay outside the repository.

const SERVICE = 'https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C';
const LAYER = 'IMAGES_DOP_20_RGB';
const LICENCE = 'dl-de/by-2-0';
/** The source note the licence asks for: holder and year of retrieval (the service's example). */
export const ATTRIBUTION =
  'Orthophoto: LGL-BW (2026) Datenlizenz Deutschland - Namensnennung - Version 2.0, www.lgl-bw.de';
/** The box in the Freiburg project's local frame (m, x east, y south): Bismarckallee from the
 * Stühlinger bridge to Friedrichstraße, the ZOB, the Hauptbahnhof's junctions and Friedrichstraße
 * to the Rotteckring. */
export const BOX = { x0: -630, y0: -690, x1: 230, y1: -90 };
/** Ground metres per pixel requested: DOP20's own resolution. */
const GROUND_M = 0.2;
const TILE_PX = 1000;

const EARTH_RADIUS_M = 6378137;
const DEG = Math.PI / 180;
/** The project's origin (`city.geo.origin`); `render` checks it against the project. */
const ORIGIN = { lon: 7.8459, lat: 47.9952 };

interface Tile {
  file: string;
  /** Local frame, m. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
  url: string;
}

/** The local frame is Web Mercator scaled by cos(lat0) about the origin (`src/geo/projection`),
 * so an EPSG:3857 image maps onto it by a scale and a shift, with no resampling of our own. */
function mercatorBox(x0: number, y0: number, x1: number, y1: number) {
  const scale = Math.cos(ORIGIN.lat * DEG);
  const mx = EARTH_RADIUS_M * ORIGIN.lon * DEG;
  const my = EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (ORIGIN.lat * DEG) / 2));
  return [mx + x0 / scale, my - y1 / scale, mx + x1 / scale, my - y0 / scale];
}

async function fetchTiles(dir: string) {
  mkdirSync(dir, { recursive: true });
  const capsUrl = `${SERVICE}?REQUEST=GetCapabilities&SERVICE=WMS`;
  const caps = await (await fetch(capsUrl)).text();
  writeFileSync(join(dir, 'capabilities.xml'), caps);
  const constraints = /<AccessConstraints>([^<]*)<\/AccessConstraints>/.exec(caps)?.[1] ?? '';
  const fees = /<Fees>([^<]*)<\/Fees>/.exec(caps)?.[1] ?? '';
  if (!constraints.includes(LICENCE) || !caps.includes(`<Name>${LAYER}</Name>`))
    throw new Error(`The service no longer states ${LICENCE} for ${LAYER}: ${constraints}`);
  const widthPx = Math.round((BOX.x1 - BOX.x0) / GROUND_M);
  const heightPx = Math.round((BOX.y1 - BOX.y0) / GROUND_M);
  const cols = Math.ceil(widthPx / TILE_PX);
  const rows = Math.ceil(heightPx / TILE_PX);
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const px0 = Math.round((col * widthPx) / cols);
      const px1 = Math.round(((col + 1) * widthPx) / cols);
      const py0 = Math.round((row * heightPx) / rows);
      const py1 = Math.round(((row + 1) * heightPx) / rows);
      const [x0, y0, x1, y1] = [px0, py0, px1, py1].map((v, i) =>
        i % 2 ? BOX.y0 + v * GROUND_M : BOX.x0 + v * GROUND_M,
      ) as [number, number, number, number];
      const bbox = mercatorBox(x0, y0, x1, y1).map((v) => v.toFixed(3));
      const url =
        `${SERVICE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${LAYER}&STYLES=` +
        `&CRS=EPSG:3857&BBOX=${bbox.join(',')}&WIDTH=${px1 - px0}&HEIGHT=${py1 - py0}` +
        `&FORMAT=image/jpeg`;
      const response = await fetch(url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // Untrusted bytes: only a JPEG is kept.
      if (
        !response.ok ||
        response.headers.get('content-type') !== 'image/jpeg' ||
        bytes[0] !== 0xff ||
        bytes[1] !== 0xd8
      )
        throw new Error(`${url}: ${response.status} ${response.headers.get('content-type')}`);
      const file = `dop20-r${row}-c${col}.jpg`;
      writeFileSync(join(dir, file), bytes);
      tiles.push({ file, x0, y0, x1, y1, width: px1 - px0, height: py1 - py0, url });
      console.info(
        `${file}: ${px1 - px0} x ${py1 - py0} px, ${(bytes.length / 1e3).toFixed(0)} kB`,
      );
    }
  const record = {
    service: SERVICE,
    layer: LAYER,
    crs: 'EPSG:3857',
    groundM: GROUND_M,
    origin: ORIGIN,
    box: BOX,
    fees,
    accessConstraints: constraints,
    attribution: ATTRIBUTION,
    fetched: new Date().toISOString(),
    tiles,
  };
  writeFileSync(join(dir, 'tiles.json'), JSON.stringify(record, null, 2));
}

type Ring = Vec2[];
type Line = { points: Vec2[]; cls: string };

const inBox = (p: Vec2, margin = 30) =>
  p.x > BOX.x0 - margin && p.x < BOX.x1 + margin && p.y > BOX.y0 - margin && p.y < BOX.y1 + margin;

/** The overlay's shapes in the local frame: the drawn carriageway's edge (the union of road
 * surfaces, junction polygons, tapers and gore pavement, per grade), parking strips, the paint,
 * the OSM centrelines and the tram rails, coloured by form (TASK-220). */
async function overlayGeometry() {
  const project = await openFreiburg();
  const city = project.city;
  if (city.geo?.origin.lon !== ORIGIN.lon || city.geo.origin.lat !== ORIGIN.lat)
    throw new Error('The Freiburg project moved its origin: refetch the tiles');
  const result = compile(city);
  if (!result.ok) throw new Error('Freiburg must compile');
  const compiled = paintedCity(result.compiled);
  const theme = markingThemes[cityMarkingTheme(city)];
  const roads = compiled.roads.filter((road) => road.surface.some((p) => inBox(p)));
  const nodes = compiled.nodes.filter((node) => inBox(node.pos));
  const surfaces = new Map<number, Ring[]>();
  const addSurface = (grade: number, ring: Ring) => {
    if (ring.length >= 3) surfaces.set(grade, [...(surfaces.get(grade) ?? []), ring]);
  };
  const lines: Line[] = [];
  const polygons: Line[] = [];
  const paint = (shapes: readonly MarkingShape[]) => {
    for (const shape of shapes) {
      const cls = `m-${shape.role}`;
      if (shape.kind === 'polygon') polygons.push({ points: shape.points, cls });
      else lines.push({ points: shape.points, cls });
    }
  };
  for (const road of roads) {
    addSurface(road.grade, road.surface);
    const geometry = roadMarkingGeometry(compiled, road, city, theme);
    for (const ring of [...geometry.pavement, ...gorePavement(compiled, road)])
      addSurface(road.grade, ring);
    if (road.lanes.some((i) => compiled.lanes[i]!.taperStartM || compiled.lanes[i]!.taperEndM))
      for (const lane of transitionGeometry(compiled, road).lanes)
        addSurface(road.grade, [...lane.left, ...[...lane.right].reverse()]);
    paint(geometry.below);
    paint(geometry.above);
    paint(transitionMarkings(compiled, road, theme));
    for (const atEnd of [false, true])
      for (const stripe of crossingStripes(compiled, road, atEnd, city))
        polygons.push({ points: stripe, cls: 'crossing' });
  }
  for (const node of nodes) {
    addSurface(node.grade, node.outline);
    paint(nodeMarkingGeometry(compiled, node, theme));
  }
  const kerbs: Line[] = [];
  for (const [grade, rings] of surfaces)
    for (const ring of booleanOpD(ClipType.Union, rings, null, FillRule.NonZero, 3))
      kerbs.push({ points: ring.map(({ x, y }) => ({ x, y })), cls: grade ? 'kerb-off' : 'kerb' });
  const strips = (compiled.strips ?? [])
    .filter((strip) => strip.polygon.some((p) => inBox(p)))
    .map((strip) => ({ points: strip.polygon, cls: 'strip' }));
  const centrelines = Object.values(city.roads)
    .filter((road) => road.centerline.some((p) => inBox(p)))
    .map((road) => ({ points: road.centerline, cls: 'osm' }));
  const rails = Object.values(city.rail?.tracks ?? {})
    .filter((track) => track.kind === 'tram' && track.line.some((p) => inBox(p)))
    .flatMap((track) =>
      [-TRAM_RAIL_M, TRAM_RAIL_M].map((offset) => ({
        points: offsetPolyline(track.line, offset),
        // TASK-220: coloured by the track's form.
        cls: `${track.layer ? 'rail-off' : 'rail'} form-${track.form ?? 'embedded'}`,
      })),
    );
  const labels = [
    ...roads.map((road) => {
      const ref = city.roads[road.id]!.centerline;
      return { at: ref[Math.floor(ref.length / 2)]!, text: road.id, cls: 'l-road' };
    }),
    ...nodes.map((node) => ({ at: node.pos, text: node.id, cls: 'l-node' })),
  ];
  return { city, compiled, kerbs, strips, centrelines, rails, lines, polygons, labels };
}

/** Rail centres of standard gauge (as `render/rail-geometry.ts` draws them). */
const TRAM_RAIL_M = (1.435 + 0.07) / 2;

/** A view of the overlay: centre (m), size (m) and scale (px per m). `grid` draws a metre grid,
 * `bare` the imagery alone, `marks` named points (registration). */
export interface View {
  id: string;
  centre: [number, number];
  size: [number, number];
  zoom: number;
  grid?: boolean;
  bare?: boolean;
  labels?: boolean;
  /** Shadows lifted (gamma 0.5) so kerbs in shade show. */
  lift?: boolean;
  /** No caption or scale bar: working crops, never published (the caption carries the
   * attribution). */
  plain?: boolean;
  marks?: { at: Vec2; text: string }[];
  /** Cross-sections with metre ticks: [road id, station on its OSM centreline (m), half length
   * (m)]; the drawn kerbs' and lines' offsets along each are printed. */
  sections?: [string, number, number][];
}

/** A cross-section square to a road's OSM centreline, positive to the right of travel, with the
 * offsets where it crosses the drawn kerbs and lane, edge and centre lines. */
function section(
  geometry: Awaited<ReturnType<typeof overlayGeometry>>,
  [roadId, atM, halfM]: [string, number, number],
) {
  const line = geometry.city.roads[roadId as never]!.centerline;
  const lengths = cumulativeLengths(line);
  const centre = pointAtDistance(line, lengths, atM);
  const h = headingAtDistance(line, lengths, atM);
  const normal = { x: -Math.sin(h), y: Math.cos(h) };
  const a = { x: centre.x - normal.x * halfM, y: centre.y - normal.y * halfM };
  const b = { x: centre.x + normal.x * halfM, y: centre.y + normal.y * halfM };
  const crossings = (items: Line[], closed: boolean) =>
    items
      .flatMap((item) => {
        const points = closed ? [...item.points, item.points[0]!] : item.points;
        return points.slice(1).flatMap((q, i) => {
          const hit = segmentIntersection(a, b, points[i]!, q);
          return hit
            ? [
                Math.round(((hit.x - centre.x) * normal.x + (hit.y - centre.y) * normal.y) * 100) /
                  100,
              ]
            : [];
        });
      })
      .sort((x, y) => x - y);
  return {
    road: roadId,
    atM,
    a,
    b,
    centre,
    normal,
    kerbs: crossings(geometry.kerbs, true),
    lines: crossings(
      geometry.lines.filter((l) => /m-(lane|edge|centre|channel)/.test(l.cls)),
      false,
    ),
  };
}

const path = (points: readonly Vec2[], closed: boolean) =>
  points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('') +
  (closed ? 'Z' : '');

function overlayPage(
  tiles: Tile[],
  dataDir: string,
  geometry: Awaited<ReturnType<typeof overlayGeometry>>,
) {
  const group = (cls: string, items: Line[], closed: boolean) =>
    `<g class="${cls}">${items.map((l) => `<path class="${l.cls}" d="${path(l.points, closed)}"/>`).join('')}</g>`;
  const images = tiles
    .map(
      (t) =>
        `<image href="${pathToFileURL(join(dataDir, t.file)).href}" x="${t.x0}" y="${t.y0}" width="${t.x1 - t.x0}" height="${t.y1 - t.y0}" preserveAspectRatio="none"/>`,
    )
    .join('');
  const labels = geometry.labels
    .map(
      (l) =>
        `<text class="${l.cls}" x="${l.at.x.toFixed(2)}" y="${l.at.y.toFixed(2)}">${l.text}</text>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#222;font-family:Arial,sans-serif}
svg{display:block}
path{fill:none;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.kerb{stroke:#00e5ff;stroke-width:2}
.kerb-off{stroke:#00e5ff;stroke-width:1.5;stroke-dasharray:6 4}
.strip{stroke:#7dff6a;stroke-width:1.2;stroke-dasharray:4 3}
.osm{stroke:#ffffff;stroke-width:1;stroke-dasharray:2 3;opacity:.85}
.rail{stroke:#ff8a00;stroke-width:1.2}
.rail-off{stroke:#ff8a00;stroke-width:1;stroke-dasharray:5 4}
.form-ballast{stroke:#ff3b3b}.form-grass{stroke:#7dff6a}.form-paved{stroke:#d6c8ff}
#legend{position:fixed;left:6px;top:4px;padding:2px 6px;background:rgba(0,0,0,.65);font-size:12px}
.m-lane,.m-edge,.m-centre,.m-channel,.m-bus{stroke:#ffe600;stroke-width:1.4}
.m-hatch{stroke:#ffb000;stroke-width:1}
.m-arrow{stroke:#ffe600;stroke-width:1.2}
.m-stop{stroke:#ff2a2a;stroke-width:2.5}
.crossing{stroke:#ff3df5;stroke-width:1.2}
.grid path{stroke:#ffffff;opacity:.35;stroke-width:.6}
.grid path.major{opacity:.7;stroke-width:1}
text{paint-order:stroke;stroke:#000;fill:#fff}
.l-road{fill:#ffe600}.l-node{fill:#00e5ff}
.mark{stroke:#ff2a2a;stroke-width:1.5}
.cut{stroke:#ffffff;stroke-width:1.5}
.bare .ov{display:none}.nolabels .labels{display:none}
#caption{position:fixed;left:0;bottom:0;padding:2px 6px;background:rgba(0,0,0,.65);color:#fff;font-size:12px}
#scale{position:fixed;right:8px;bottom:22px;color:#fff;font-size:12px;text-align:right}
#scale div{height:4px;background:#fff;border:1px solid #000;margin-top:2px}
</style></head><body><svg id="map" xmlns="http://www.w3.org/2000/svg">
<defs><filter id="lift"><feComponentTransfer><feFuncR type="gamma" exponent="0.5"/><feFuncG type="gamma" exponent="0.5"/><feFuncB type="gamma" exponent="0.5"/></feComponentTransfer></filter></defs>
<g id="imagery">${images}</g>
<g class="ov">
${group('strips', geometry.strips, true)}
${group('osm', geometry.centrelines, false)}
${group('rails', geometry.rails, false)}
${group('kerbs', geometry.kerbs, true)}
${group('paint', geometry.lines, false)}
${group('paint', geometry.polygons, true)}
</g>
<g class="labels ov">${labels}</g>
<g id="grid" class="grid"></g><g id="marks"></g>
</svg><div id="scale"></div><div id="caption"></div>
<div id="legend" class="ov"><span style="color:#ff8a00">embedded</span> <span style="color:#7dff6a">grass</span> <span style="color:#d6c8ff">paved</span> <span style="color:#ff3b3b">ballast</span></div>
<script>
window.show = (v, attribution, cuts) => {
  const [w, h] = [v.size[0] * v.zoom, v.size[1] * v.zoom];
  const x0 = v.centre[0] - v.size[0] / 2, y0 = v.centre[1] - v.size[1] / 2;
  const svg = document.getElementById('map');
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('viewBox', [x0, y0, v.size[0], v.size[1]].join(' '));
  svg.classList.toggle('bare', !!v.bare);
  document.getElementById('imagery').setAttribute('filter', v.lift ? 'url(#lift)' : '');
  svg.classList.toggle('nolabels', !v.labels);
  const font = 11 / v.zoom;
  for (const t of svg.querySelectorAll('text')) { t.setAttribute('font-size', font); t.setAttribute('stroke-width', font / 4); }
  let grid = '';
  if (v.grid)
    for (let k = Math.ceil(x0); k <= x0 + v.size[0]; k++)
      grid += '<path class="' + (k % 5 ? '' : 'major') + '" d="M' + k + ' ' + y0 + 'V' + (y0 + v.size[1]) + '"/>';
  if (v.grid)
    for (let k = Math.ceil(y0); k <= y0 + v.size[1]; k++)
      grid += '<path class="' + (k % 5 ? '' : 'major') + '" d="M' + x0 + ' ' + k + 'H' + (x0 + v.size[0]) + '"/>';
  document.getElementById('grid').innerHTML = grid;
  const r = 6 / v.zoom;
  document.getElementById('marks').innerHTML = (v.marks || []).map((m) =>
    '<path class="mark" d="M' + (m.at.x - r) + ' ' + m.at.y + 'H' + (m.at.x + r) + 'M' + m.at.x + ' ' + (m.at.y - r) + 'V' + (m.at.y + r) + '"/>' +
    '<text x="' + (m.at.x + r) + '" y="' + (m.at.y - r) + '" font-size="' + font + '" stroke-width="' + font / 4 + '">' + m.text + '</text>').join('');
  let ticks = '';
  for (const c of cuts || []) {
    const half = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) / 2, t = { x: c.normal.y, y: -c.normal.x };
    ticks += '<path class="cut" d="M' + c.a.x + ' ' + c.a.y + 'L' + c.b.x + ' ' + c.b.y + '"/>';
    for (let d = -Math.floor(half); d <= half; d++) {
      const p = { x: c.centre.x + c.normal.x * d, y: c.centre.y + c.normal.y * d }, len = (d % 5 ? 3 : 7) / v.zoom;
      ticks += '<path class="cut" d="M' + (p.x - t.x * len) + ' ' + (p.y - t.y * len) + 'L' + (p.x + t.x * len) + ' ' + (p.y + t.y * len) + '"/>';
      if (!(d % 5)) ticks += '<text x="' + (p.x + t.x * 9 / v.zoom) + '" y="' + (p.y + t.y * 9 / v.zoom) + '" font-size="' + font + '" stroke-width="' + font / 4 + '">' + d + '</text>';
    }
  }
  document.getElementById('marks').innerHTML += ticks;
  const bar = [1, 2, 5, 10, 20, 50, 100].find((m) => m * v.zoom >= 60);
  document.getElementById('scale').innerHTML = bar + ' m<div style="width:' + bar * v.zoom + 'px;margin-left:auto"></div>';
  for (const id of ['caption', 'scale']) document.getElementById(id).style.display = v.plain ? 'none' : '';
  document.getElementById('caption').textContent = v.id + ' | ' + attribution + ' | roads, paint: OpenStreetMap contributors, ODbL';
  return [w, h];
};
// The imagery's grey level (0 to 255) across a polyline: for each offset (m, right of travel),
// the mean over stations every 0.2 m along it, sampled bilinearly from the tiles.
window.profile = async (line, offsets) => {
  if (!window.pixels) {
    const box = ${JSON.stringify(BOX)}, k = ${1 / GROUND_M};
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((box.x1 - box.x0) * k); canvas.height = Math.round((box.y1 - box.y0) * k);
    const g = canvas.getContext('2d');
    for (const el of document.querySelectorAll('#imagery image')) {
      const img = new Image(); img.src = el.getAttribute('href'); await img.decode();
      g.drawImage(img, (el.getAttribute('x') - box.x0) * k, (el.getAttribute('y') - box.y0) * k);
    }
    const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
    window.pixels = { data, w: canvas.width, h: canvas.height, box, k };
  }
  const { data, w, h, box, k } = window.pixels;
  const grey = (x, y) => {
    const u = (x - box.x0) * k - 0.5, v = (y - box.y0) * k - 0.5;
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    if (i < 0 || j < 0 || i + 1 >= w || j + 1 >= h) return NaN;
    const at = (a, b) => { const o = (b * w + a) * 4; return (data[o] + data[o + 1] + data[o + 2]) / 3; };
    return (1 - fv) * ((1 - fu) * at(i, j) + fu * at(i + 1, j)) + fv * ((1 - fu) * at(i, j + 1) + fu * at(i + 1, j + 1));
  };
  const sums = offsets.map(() => [0, 0]);
  for (let s = 1; s < line.length; s++) {
    const a = line[s - 1], b = line[s], len = Math.hypot(b.x - a.x, b.y - a.y);
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, n = { x: -t.y, y: t.x };
    for (let d = 0; d < len; d += 0.2)
      offsets.forEach((o, i) => {
        const value = grey(a.x + t.x * d + n.x * o, a.y + t.y * d + n.y * o);
        if (!Number.isNaN(value)) { sums[i][0] += value; sums[i][1]++; }
      });
  }
  return sums.map(([sum, count]) => (count ? sum / count : null));
};
</script></body></html>`;
}

/** The findings' close-ups (docs/findings/2026-11-19-aerial-check): the overlay, and the same
 * camera in the app's 3D view (`camera3d`: zoom, pitch, bearing) without the imagery. Marks are
 * read off the imagery (ground features) or are OSM nodes. */
export const VIEWS: (View & { camera3d: [number, number, number] })[] = [
  {
    id: 'registration-p1-rotteckring',
    centre: [40, -122],
    size: [24, 16],
    zoom: 30,
    camera3d: [48, 45, 0],
  },
  {
    id: 'D1-crossings-n211-n1139',
    centre: [-193, -247],
    size: [80, 40],
    zoom: 10,
    lift: true,
    marks: [
      { at: { x: -226.6, y: -257.9 }, text: 'OSM zebra 2479358348' },
      { at: { x: -164.8, y: -237.2 }, text: 'OSM zebra 9118444286' },
    ],
    camera3d: [9, 45, 0],
  },
  {
    id: 'D2-group-stop-line-n1147',
    centre: [-112, -466],
    size: [60, 36],
    zoom: 12,
    marks: [{ at: { x: -129.2, y: -472.5 }, text: 'stop line on the ground' }],
    camera3d: [19, 45, 0],
  },
  {
    id: 'D4-stop-line-r1178',
    centre: [-145, -492],
    size: [30, 22],
    zoom: 20,
    grid: true,
    marks: [{ at: { x: -142.4, y: -498.2 }, text: 'stop line on the ground' }],
    camera3d: [32, 45, 0],
  },
  {
    id: 'D3a-width-r1179-stefan-meier',
    centre: [NaN, NaN],
    size: [40, 30],
    zoom: 13,
    sections: [['r:1179', 6, 15]],
    camera3d: [21, 45, 0],
  },
  {
    id: 'D3b-width-r261-zur-unterfuehrung',
    centre: [NaN, NaN],
    size: [40, 30],
    zoom: 13,
    sections: [['r:261', 20, 15]],
    camera3d: [21, 45, 0],
  },
  {
    id: 'D9-width-tag-r1590-rotteckring',
    centre: [NaN, NaN],
    size: [40, 30],
    zoom: 13,
    sections: [['r:1590', 30, 12]],
    camera3d: [21, 45, 0],
  },
  {
    id: 'D5-median-r1251-bismarckallee',
    centre: [NaN, NaN],
    size: [40, 30],
    zoom: 13,
    sections: [['r:1251', 40, 15]],
    camera3d: [21, 45, 0],
  },
  {
    id: 'D7-lane-gain-n1146',
    centre: [-75, -455],
    size: [60, 36],
    zoom: 12,
    marks: [
      { at: { x: -65.6, y: -453.8 }, text: 'painted arrows' },
      { at: { x: -85, y: -456.6 }, text: 'drawn arrows' },
    ],
    camera3d: [19, 45, 0],
  },
  {
    id: 'D6-promenade-r226',
    centre: [-212, -305],
    size: [40, 30],
    zoom: 14,
    camera3d: [22, 45, 0],
  },
  {
    id: 'D8-tram-bed-friedrichring',
    centre: [205, -355],
    size: [50, 36],
    zoom: 14,
    camera3d: [22, 45, 0],
  },
];

/** The overview sweep: the box in tiles of 150 x 120 m at 5 px/m, with ids. */
const sweep = (): View[] => {
  const views: View[] = [];
  for (let y = BOX.y0; y < BOX.y1; y += 120)
    for (let x = BOX.x0; x < BOX.x1; x += 150)
      views.push({
        id: `sweep-${Math.round(x)}-${Math.round(y)}`,
        centre: [x + 75, y + 60],
        size: [150, 120],
        zoom: 5,
        labels: true,
      });
  return views;
};

async function render(dataDir: string, out: string, views: View[]) {
  const record = JSON.parse(readFileSync(join(dataDir, 'tiles.json'), 'utf8')) as {
    tiles: Tile[];
    attribution: string;
  };
  const geometry = await overlayGeometry();
  mkdirSync(out, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'cityflows-aerial-'));
  const page = join(work, 'overlay.html');
  writeFileSync(page, overlayPage(record.tiles, dataDir, geometry));
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const tab = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await tab.route(/^https?:\/\//, (route) => route.abort());
    await tab.goto(pathToFileURL(page).href);
    for (const view of views) {
      const cuts = (view.sections ?? []).map((spec) => section(geometry, spec));
      // A view without a centre of its own is centred on its first cross-section.
      if (Number.isNaN(view.centre[0]) && cuts[0])
        view.centre = [cuts[0].centre.x, cuts[0].centre.y];
      for (const cut of cuts)
        console.info(
          `${view.id} ${cut.road} @${cut.atM} m: kerbs ${cut.kerbs.join(' ')} | lines ${cut.lines.join(' ')}`,
        );
      const [width, height] = await tab.evaluate(
        ([v, a, c]) =>
          (window as unknown as { show: (v: View, a: string, c: unknown) => number[] }).show(
            v,
            a,
            c,
          ),
        [view, record.attribution, cuts] as const,
      );
      await tab.setViewportSize({ width: Math.round(width!), height: Math.round(height!) });
      await tab.evaluate(() => Promise.all([...document.images].map((i) => i.decode?.())));
      // JPEG: the close-ups are photographs, a fifth of their PNG size.
      await tab.screenshot({ path: join(out, `${view.id}.jpg`), type: 'jpeg', quality: 85 });
      console.info(`${view.id}.jpg`);
    }
  } finally {
    await browser.close();
  }
}

/** The registration's fixed points: stretches of tram track (the OSM way's track nearest
 * `near`, between two stations of its line, m), embedded in asphalt (rails read dark) or on a
 * grass bed (bright). Each gives the offset of the visible track from the drawn one across it. */
export const RAIL_STRETCHES = [
  {
    id: 'P1',
    label: 'Rotteckring, northbound',
    way: 440945775,
    near: [41, -121],
    fromM: 5,
    toM: 75,
    dark: true,
  },
  {
    id: 'P2',
    label: 'Rotteckring, southbound',
    way: 440945776,
    near: [39, -122],
    fromM: 5,
    toM: 75,
    dark: true,
  },
  {
    id: 'P3',
    label: 'curve into Friedrichring, northbound',
    way: 440945775,
    near: [189, -352],
    fromM: 2,
    toM: 19,
    dark: false,
  },
  {
    id: 'P4',
    label: 'Friedrichring, westbound',
    way: 440945776,
    near: [215, -364],
    fromM: 37,
    toM: 51,
    dark: false,
  },
];
/** In every stretch the track shows as two lines this far apart (the rail heads blurred into the
 * 0.2 m pixels); the midpoint of the pair is the track's centre. */
const PAIR_M = 1.0;

/** The offset (m, right of travel) of the visible track's centre: the midpoint of the line pair
 * with the strongest ridge response within 1.5 m of the drawn centre. */
function trackCentre(offsets: number[], profile: (number | null)[], dark: boolean) {
  const step = offsets[1]! - offsets[0]!;
  const at = (d: number) => profile[Math.round((d - offsets[0]!) / step)] ?? NaN;
  const ridge = (d: number) => at(d) - (at(d - 0.35) + at(d + 0.35)) / 2;
  let best = { centre: NaN, score: -Infinity };
  for (let c = -1.5; c <= 1.5 + 1e-9; c += step) {
    const score = (dark ? -1 : 1) * (ridge(c - PAIR_M / 2) + ridge(c + PAIR_M / 2));
    if (score > best.score) best = { centre: c, score };
  }
  return best;
}

/** Fits one constant offset (m) to the stretches' cross-track offsets by least squares, each
 * along its stretch's mean normal (right of travel), and returns it with each residual. */
function registration(results: Awaited<ReturnType<typeof railProfiles>>) {
  const rows = results.map((r) => {
    let nx = 0,
      ny = 0;
    for (let i = 1; i < r.line.length; i++) {
      const a = r.line[i - 1]!,
        b = r.line[i]!;
      nx += -(b.y - a.y);
      ny += b.x - a.x;
    }
    const length = Math.hypot(nx, ny);
    const { centre, score } = trackCentre(r.offsets, r.profile, r.dark);
    return { id: r.id, label: r.label, normal: { x: nx / length, y: ny / length }, centre, score };
  });
  // Normal equations of min sum (n . o - c)^2.
  let a11 = 0,
    a12 = 0,
    a22 = 0,
    b1 = 0,
    b2 = 0;
  for (const { normal: n, centre: c } of rows) {
    a11 += n.x * n.x;
    a12 += n.x * n.y;
    a22 += n.y * n.y;
    b1 += n.x * c;
    b2 += n.y * c;
  }
  const det = a11 * a22 - a12 * a12;
  const offset = { x: (a22 * b1 - a12 * b2) / det, y: (a11 * b2 - a12 * b1) / det };
  return {
    offset,
    offsetM: Math.hypot(offset.x, offset.y),
    points: rows.map((row) => ({
      ...row,
      residualM: row.centre - (row.normal.x * offset.x + row.normal.y * offset.y),
    })),
  };
}

async function railProfiles(dataDir: string) {
  const record = JSON.parse(readFileSync(join(dataDir, 'tiles.json'), 'utf8')) as {
    tiles: Tile[];
  };
  const geometry = await overlayGeometry();
  const work = mkdtempSync(join(tmpdir(), 'cityflows-aerial-'));
  const page = join(work, 'overlay.html');
  writeFileSync(page, overlayPage(record.tiles, dataDir, geometry));
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const offsets = Array.from({ length: 161 }, (_, i) => -4 + i * 0.05);
  const results = [];
  try {
    const tab = await browser.newPage();
    await tab.route(/^https?:\/\//, (route) => route.abort());
    await tab.goto(pathToFileURL(page).href);
    for (const stretch of RAIL_STRETCHES) {
      const track = Object.values(geometry.city.rail!.tracks)
        .filter((t) => t.osmId === stretch.way)
        .sort(
          (a, b) =>
            nearestOnPolyline(a.line, { x: stretch.near[0]!, y: stretch.near[1]! }).away -
            nearestOnPolyline(b.line, { x: stretch.near[0]!, y: stretch.near[1]! }).away,
        )[0]!;
      const line = trimPolyline(
        track.line,
        stretch.fromM,
        polylineLength(track.line) - stretch.toM,
      );
      const profile = await tab.evaluate(
        ([line, offsets]) =>
          (
            window as unknown as {
              profile: (l: Vec2[], o: number[]) => Promise<(number | null)[]>;
            }
          ).profile(line, offsets),
        [line, offsets] as const,
      );
      results.push({ ...stretch, track: track.id, line, offsets, profile });
    }
  } finally {
    await browser.close();
  }
  return results;
}

/** The views' cameras in the app's 3D view (the bundled Freiburg project from the dev server,
 * port 5416), with buildings, trees, places and entrances off, as `<id>-3d.png`. */
async function shots3d(out: string, views: typeof VIEWS) {
  mkdirSync(out, { recursive: true });
  const geometry = await overlayGeometry();
  const port = 5416;
  const server = spawn(
    process.execPath,
    [
      resolve('node_modules/vite/bin/vite.js'),
      '--mode',
      'test',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    { stdio: 'ignore' },
  );
  const browser = await chromium.launch();
  try {
    const url = `http://127.0.0.1:${port}/`;
    for (let tries = 0; ; tries++) {
      if (
        await fetch(url).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      if (tries > 240) throw new Error('dev server did not start');
      await new Promise((done) => setTimeout(done, 500));
    }
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce',
    });
    page.setDefaultTimeout(180_000);
    await page.route(/^https:\/\//, (route) => route.abort());
    await page.goto(url);
    // `city()` throws until the project has opened.
    await page.waitForFunction(() => {
      try {
        return !!window.cityflows?.city?.();
      } catch {
        return false;
      }
    });
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    await button('Layers').click();
    const layers = page.getByRole('region', { name: 'Map layers' });
    for (const label of [
      'Surroundings',
      'Trees',
      'Street trees',
      'Places',
      'Entrances and exits',
      'Labels',
      'Parked cars',
    ]) {
      const toggle = layers.getByLabel(label, { exact: true });
      if (await toggle.count()) await toggle.uncheck();
    }
    await button('Layers').click();
    await button('3D').click();
    await page.waitForFunction(() => !!window.cityflows?.view3D?.());
    const canvas = page.getByLabel('3D city view', { exact: true });
    for (const view of views) {
      const centre = Number.isNaN(view.centre[0])
        ? section(geometry, view.sections![0]!).centre
        : { x: view.centre[0], y: view.centre[1] };
      const [zoom, pitch, bearing] = view.camera3d;
      const frames = Number(await canvas.getAttribute('data-frames'));
      await page.evaluate(([c, z, p, b]) => window.cityflows!.setView3D!(c, z, p, b), [
        centre,
        zoom,
        pitch,
        bearing,
      ] as const);
      await page.waitForFunction(
        (n) =>
          Number(
            document.querySelector('[aria-label="3D city view"]')?.getAttribute('data-frames'),
          ) > n,
        frames,
      );
      await canvas.screenshot({ path: join(out, `${view.id}-3d.jpg`), type: 'jpeg', quality: 85 });
      console.info(`${view.id}-3d.jpg`);
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

/** `--view id:x,y,w,h,zoom[,grid][,bare][,labels]` renders ad hoc views. */
function parseView(spec: string): View {
  const id = spec.slice(0, spec.indexOf(':'));
  const rest = spec.slice(id.length + 1);
  const parts = rest!.split(',');
  const [x, y, w, h, zoom] = parts.slice(0, 5).map(Number) as number[];
  return {
    id: id!,
    centre: [x!, y!],
    size: [w!, h!],
    zoom: zoom!,
    grid: parts.includes('grid'),
    bare: parts.includes('bare'),
    labels: parts.includes('labels'),
    lift: parts.includes('lift'),
    plain: parts.includes('plain'),
    sections: parts
      .filter((part) => part.startsWith('r:'))
      .map((part) => {
        const [road, at, half] = part.split('@');
        return [road!, Number(at), Number(half ?? 15)] as [string, number, number];
      }),
  };
}

const [command, ...args] = process.argv.slice(2);
if (command === 'fetch' && args.length === 1) await fetchTiles(resolve(args[0]!));
else if (command === 'render' && args.length >= 2) {
  const [dataDir, out, flag, value] = args;
  const views =
    flag === '--sweep'
      ? sweep()
      : flag === '--view'
        ? args.slice(3).map(parseView)
        : VIEWS.filter((view) => flag !== '--only' || value!.split(',').includes(view.id));
  await render(resolve(dataDir!), resolve(out!), views);
} else if (command === 'shots3d' && args.length >= 1) {
  const [out, flag, value] = args;
  await shots3d(
    resolve(out!),
    VIEWS.filter((view) => flag !== '--only' || value!.split(',').includes(view.id)),
  );
} else if (command === 'register' && args.length === 1) {
  console.info(JSON.stringify(registration(await railProfiles(resolve(args[0]!))), null, 2));
} else
  throw new Error(
    'Usage: bench/aerial-overlay.ts fetch <data-dir> | register <data-dir> | render <data-dir> <out-dir> [--sweep | --view <spec>... | --only <id,id>] | shots3d <out-dir> [--only <id,id>]',
  );
