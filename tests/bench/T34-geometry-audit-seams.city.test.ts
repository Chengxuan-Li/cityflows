import { expect, test } from 'vitest';
import { compileCity, cornerAudit, drawnJunctions } from '../../bench/geometry-audit';
import { limit } from '../timeouts';

// T34 (TASK-355): measure 10 counts kerbs, not seams. The TASK-347 review's eight largest new nose
// records (D:\cityflows-wt\330-pilot\R\screens\q1-*): seams where a drawn surface's outline crosses
// open asphalt or ends in a spike are no curb; the real medians, islands and gore tips are.
const records = {
  munich: [
    // n:838's strip end drawn across r:839/r:840 (the white tick in the screenshot).
    ['n:838', 'r:839>r:840', false],
    // Its inner side is a kerb: the strip's curb meeting r:839's own tight bend, a nose because
    // both roads run west beyond the U-turn around the block.
    ['n:838', 'r:875>r:839', true],
    ['n:1369', 'r:368>r:480', true],
  ],
  freiburg: [
    ['n:254', 'r:1743>r:2152', false],
    ['n:397', 'r:1177>r:1078', true],
    ['n:640', 'r:838>r:641', true],
    ['n:1172', 'r:1262>r:2241', true],
  ],
  sindelfingen: [
    ['n:631', 'r:638>r:637', false],
    ['n:139', 'r:863>r:864', false],
  ],
} as const;

test.each(Object.keys(records) as (keyof typeof records)[])(
  'T34.12: %s seams are no curb, real noses are',
  async (name) => {
    const { city, net } = await compileCity(name);
    const drawn = drawnJunctions(net);
    for (const [id, roads, counted] of records[name]) {
      const junction = drawn.find(({ node }) => node.id.split('+').includes(id))!;
      const record = cornerAudit(city, net, junction.node, junction.ends).find(
        (c) => c.roads === roads,
      );
      expect(record !== undefined, `${junction.node.id} ${roads}`).toBe(counted);
      if (record) expect(record.kind).toBe('nose');
    }
  },
  limit(240_000),
);
