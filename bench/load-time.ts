import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { compile } from '../src/network';
import { crossingEnabled, crossingStyle } from '../src/network/crossings';
import { junctionCorners } from '../src/network/junctions';
import { openProject } from '../src/project/open';
import { cityMarkingTheme } from '../src/schema/marking-theme';
import {
  crossingStripes,
  nodeMarkingGeometry,
  roadMarkingGeometry,
  seams,
  transitionMarkings,
  zebraBeacons,
} from '../src/render/marking-geometry';
import { curbBands, curbTaper, roadEndEdges } from '../src/render/layers/nodes';
import { paintedCity, transitionLanes } from '../src/render/road-paint';
import { placeDetails } from '../src/render/street';
import { markingThemes } from '../src/render/style';
import { walkGeometry } from '../src/render/walk-geometry';
import { projectFile } from './bundled-cities';

// TASK-287: headless times of a bundled city's load in the order the app opens it (open the
// archive, compile without the walk graph, the 2D road, node, transition and crossing markings
// and the curb joins of the first frame, then the walk graph, trees and street furniture, and
// the walk shapes), each run from a fresh compile so no cache carries over, with a sha256 of
// each stage's output, including junctions, transition seams, the compiled city and its
// diagnostics, and every road end's crossing style. The render modules use parameter properties.
// Usage:
// node --experimental-transform-types --import ./bench/register.ts bench/load-time.ts
//   [york freiburg munich ...] [--runs N]

const args = process.argv.slice(2);
const runsAt = args.indexOf('--runs');
const runs = runsAt < 0 ? 3 : Number(args[runsAt + 1]);
const names = args.filter((a, i) => !a.startsWith('--') && (runsAt < 0 || i !== runsAt + 1));
const cities = names.length
  ? names
  : ['york', 'freiburg', 'philadelphia', 'munich', 'luebeck', 'sindelfingen'];

const hashOf = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_, v: unknown) =>
        v instanceof Map ? [...v] : ArrayBuffer.isView(v) ? Array.from(v as Float64Array) : v,
      ),
    )
    .digest('hex')
    .slice(0, 16);

for (const name of cities) {
  const text = readFileSync(projectFile(name), 'utf8');
  const stages = ['open', 'compile', 'markings', 'walk', 'details', 'walkShapes'] as const;
  const times = Object.fromEntries(stages.map((s) => [s, [] as number[]]));
  const hashes: Record<string, string> = {};
  for (let run = 0; run < runs; run++) {
    const time = <T>(stage: (typeof stages)[number], f: () => T): T => {
      const start = performance.now();
      const result = f();
      times[stage]!.push(performance.now() - start);
      return result;
    };
    const start = performance.now();
    const opened = await openProject(text);
    times.open!.push(performance.now() - start);
    if (!opened.ok) throw new Error(opened.error);
    const source = opened.project.city;
    let finishWalk: () => void = () => {};
    const compiled = time('compile', () => compile(source, (finish) => (finishWalk = finish)));
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics.slice(0, 3)));
    const city = paintedCity(compiled.compiled);
    const theme = markingThemes[cityMarkingTheme(source)];
    const markings = time('markings', () => ({
      roads: city.roads.map((r) => roadMarkingGeometry(city, r, source, theme)),
      nodes: city.nodes.map((n) => nodeMarkingGeometry(city, n, theme)),
      transitions: city.roads.map((r) => transitionMarkings(city, r, theme)),
      crossings: city.roads.map((r) =>
        [false, true].map((end) => crossingStripes(city, r, end, source)),
      ),
      // drawRoadJoins: the curb taper and bands of every road end at a junction surface.
      joins: city.roads.map((r) =>
        [false, true].map((atEnd) => {
          const node = city.nodes[atEnd ? r.to : r.from]!;
          if (!node.outline.length) return null;
          return [curbTaper(city, node), curbBands(city, node, r, roadEndEdges(city, r, atEnd))];
        }),
      ),
    }));
    time('walk', finishWalk);
    const details = time('details', () => placeDetails(city, source));
    const walk = time('walkShapes', () => walkGeometry(city, source));
    if (run === 0) {
      const transitionCity = transitionLanes(city);
      const ends = city.roads.flatMap((r) =>
        [false, true].map((atEnd) => [
          crossingEnabled(city, r, atEnd, source),
          crossingStyle(city, r, atEnd, source),
        ]),
      );
      Object.assign(hashes, {
        compiled: hashOf({ ...compiled.compiled, walk: undefined }),
        diagnostics: hashOf(compiled.diagnostics),
        junctions: hashOf(city.nodes.map((node) => [node.outline, junctionCorners(node)])),
        seams: hashOf(transitionCity.roads.map((road) => seams(transitionCity, road))),
        crossings: hashOf(ends),
        markings: hashOf(markings),
        beacons: hashOf(zebraBeacons(city, source, theme)),
        walk: hashOf(city.walk),
        details: hashOf(details),
        walkShapes: hashOf(walk),
      });
    }
  }
  const ms = (list: number[]) => list.map((t) => t.toFixed(0)).join(', ');
  console.info(
    `${name}: ${stages.map((s) => `${s} ${ms(times[s]!)}`).join('; ')} ms\n  ` +
      Object.entries(hashes)
        .map(([k, v]) => `${k} ${v}`)
        .join(', '),
  );
}
