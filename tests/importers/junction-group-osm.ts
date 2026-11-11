/** TASK-131 (T68): OSM documents of ways given in metres (x east, y south) around 48 N, 11 E;
 * `tagged` adds node tags by position "x,y". */
export function osm(
  ways: { id: number; tags: Record<string, string>; points: [number, number][] }[],
  tagged: Record<string, Record<string, string>> = {},
) {
  const ids = new Map<string, number>();
  const nodes: string[] = [];
  const body = ways.map(({ id: wayId, tags, points }) => {
    const refs = points.map(([x, y]) => {
      const key = `${x},${y}`;
      if (!ids.has(key)) {
        ids.set(key, ids.size + 1);
        const { lat, lon } = lonLat(x, y);
        const nodeTags = Object.entries(tagged[key] ?? {}).map(
          ([k, v]) => `<tag k="${k}" v="${v}"/>`,
        );
        nodes.push(
          `<node id="${ids.get(key)}" lat="${lat.toFixed(10)}" lon="${lon.toFixed(10)}">${nodeTags.join('')}</node>`,
        );
      }
      return `<nd ref="${ids.get(key)}"/>`;
    });
    const wayTags = Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`);
    return `<way id="${wayId}">${refs.join('')}${wayTags.join('')}</way>`;
  });
  const [nw, se] = [lonLat(-300, -300), lonLat(300, 300)];
  const bounds = `minlat="${se.lat}" minlon="${nw.lon}" maxlat="${nw.lat}" maxlon="${se.lon}"`;
  return `<osm><bounds ${bounds}/>${nodes.join('')}${body.join('')}</osm>`;
}

export function lonLat(x: number, y: number) {
  const metres = 111_320;
  return { lat: 48 - y / metres, lon: 11 + x / (metres * Math.cos((48 * Math.PI) / 180)) };
}

/** A dual carriageway "Main" (eastbound at y = gap/2, westbound at y = -gap/2, two-lane
 * one-way secondary ways 1 and 2) crossed by the two-way residential "Side" (way 3) at x = 0;
 * `signal` tags the westbound crossing node as traffic signals. */
export function dualSingle(gap: number, signal = false) {
  const main = { highway: 'secondary', oneway: 'yes', lanes: '2', name: 'Main' };
  const h = gap / 2;
  return osm(
    [
      {
        id: 1,
        tags: main,
        points: [
          [-250, h],
          [0, h],
          [250, h],
        ],
      },
      {
        id: 2,
        tags: main,
        points: [
          [250, -h],
          [0, -h],
          [-250, -h],
        ],
      },
      {
        id: 3,
        tags: { highway: 'residential', name: 'Side' },
        points: [
          [0, 250],
          [0, h],
          [0, -h],
          [0, -250],
        ],
      },
    ],
    signal ? { [`0,${-h}`]: { highway: 'traffic_signals' } } : {},
  );
}

/** `dualSingle`'s Main crossed by a Side that arrives from the north as two one-way ways meeting
 * at the westbound crossing, as Munich's Marsstraße at n:366: way 4 southbound with two lanes
 * marked `turnLanes`, way 5 northbound; the two-way way 3 runs on south across the median. */
export function dualTurnLanes(gap: number, turnLanes: string, signal = false) {
  const main = { highway: 'secondary', oneway: 'yes', lanes: '2', name: 'Main' };
  const side = { highway: 'secondary', oneway: 'yes', name: 'Side' };
  const h = gap / 2;
  return osm(
    [
      {
        id: 1,
        tags: main,
        points: [
          [-250, h],
          [0, h],
          [250, h],
        ],
      },
      {
        id: 2,
        tags: main,
        points: [
          [250, -h],
          [0, -h],
          [-250, -h],
        ],
      },
      {
        id: 3,
        tags: { highway: 'secondary', name: 'Side' },
        points: [
          [0, -h],
          [0, h],
          [0, 250],
        ],
      },
      {
        id: 4,
        tags: { ...side, lanes: '2', 'turn:lanes': turnLanes },
        points: [
          [-6, -250],
          [0, -h],
        ],
      },
      {
        id: 5,
        tags: side,
        points: [
          [0, -h],
          [6, -250],
        ],
      },
    ],
    signal ? { [`0,${-h}`]: { highway: 'traffic_signals' } } : {},
  );
}
