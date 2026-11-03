import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import type { ImportOptions } from '../types';

const integer = z
  .string()
  .regex(/^-?\d+$/)
  .transform(Number)
  .pipe(z.int());
const coordinate = z.string().trim().min(1).transform(Number).pipe(z.number());
const tags = z
  .array(z.object({ k: z.string(), v: z.string() }))
  .default([])
  .transform((entries): Record<string, string | undefined> =>
    Object.fromEntries(entries.map(({ k, v }) => [k, v])),
  );
const root = z.object({
  node: z
    .array(
      z.object({
        id: integer,
        lat: coordinate.pipe(z.number().gt(-90).lt(90)),
        lon: coordinate.pipe(z.number().min(-180).max(180)),
        tag: tags,
      }),
    )
    .default([]),
  way: z
    .array(
      z.object({
        id: integer,
        nd: z
          .array(z.object({ ref: integer }))
          .default([])
          .transform((refs) => refs.map(({ ref }) => ref)),
        tag: tags,
      }),
    )
    .default([]),
  relation: z
    .array(
      z.object({
        id: integer,
        member: z.array(z.object({ type: z.string(), ref: integer, role: z.string() })).default([]),
        tag: tags,
      }),
    )
    .default([]),
  bounds: z
    .object({ minlon: coordinate, minlat: coordinate, maxlon: coordinate, maxlat: coordinate })
    .transform(({ minlon, minlat, maxlon, maxlat }): NonNullable<ImportOptions['bbox']> => [
      minlon,
      minlat,
      maxlon,
      maxlat,
    ])
    .optional(),
  meta: z.object({ osm_base: z.string().optional() }).optional(),
  remark: z.string().optional(),
});

export type OsmData = z.output<typeof root>;
export type OsmWay = OsmData['way'][number];
export type OsmTags = OsmWay['tag'];

export function parseOsm(xml: string): OsmData | string {
  if (/<!DOCTYPE\b/i.test(xml)) return 'OSM XML cannot contain a DOCTYPE';
  const valid = XMLValidator.validate(xml);
  if (valid !== true) return `Line ${valid.err.line}: ${valid.err.msg}`;
  const list = new Set(['node', 'way', 'relation', 'nd', 'member', 'tag']);
  const parser = new XMLParser({
    ignoreAttributes: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    attributeNamePrefix: '',
    isArray: (name) => list.has(name),
  });
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return `Invalid OSM XML: ${error.message}`;
  }
  const result = z
    .strictObject({
      osm: z.union([z.literal('').transform(() => ({})), z.object({}).passthrough()]).pipe(root),
    })
    .safeParse(document);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const path = issue.path.join('.');
    return `Invalid OSM XML${path ? ' at ' + path : ''}: ${issue.message}`;
  }
  const data = result.data.osm;
  if (data.remark) return data.remark;
  for (const entities of [data.node, data.way, data.relation]) {
    entities.sort((a, b) => a.id - b.id);
    for (let i = 1; i < entities.length; i++) {
      if (entities[i]!.id === entities[i - 1]!.id) return `Duplicate OSM id ${entities[i]!.id}`;
    }
  }
  return data;
}
