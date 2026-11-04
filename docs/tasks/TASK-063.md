# TASK-063 — Junction surface, crossings and one asphalt colour

Owner: unassigned
Gate: 5 (owner backlog B21, B23, B24, B25)
Depends on: TASK-061. Design: `docs/architecture.md` section 5.1 (the TASK-063 outline rule:
fillets, no convex hull, gores), section 11 (the TASK-063 crossing order and the "Road
classes" layer), section 14 (T20). Read those before the code.

## Goal

The owner tested Munich after wave 11. Junctions look better but not right: a road's edge
should run smoothly from one road through the junction into the next, and today the
surface is a polygon through the road-end corners, widened to a convex hull wherever a
movement curve escapes it, which shows corners and blobs (B23). At acute approaches the
lane blocks of two roads overlap beyond the 10 m setback cap with their markings crossing
(B21). Queued cars stand on the zebra crossing, because the crossing is drawn before the
stop line (B24). Junctions are a different colour from the roads they join, and the per-
class road tones should be optional (B25). This task fixes how junctions are drawn; it does
not change where cars drive or stop.

## In scope

- `src/network/junctions.ts`: `junctionOutline` and `containMovements` per the 5.1 TASK-063
  rule (fillet per adjacent pair with the largest radius up to 8 m that keeps that pair's
  movement surfaces inside, straight join and edge extension as the fallbacks, gore at a
  capped acute pair, no convex hull, a simple polygon). Do not change `junctionSetbacks`,
  `SETBACK_CAP_M` or anything that moves a lane end: lane and movement polylines, lengths and
  therefore every state hash stay exactly as they are (TASK-064 runs in parallel in
  `src/sim` and `src/network/conflicts.ts` and lifts the cap later).
- `src/geo/polyline.ts`, additive helpers only.
- `src/render/layers/nodes.ts` (outline fill and colour), `src/render/layers/roads.ts`
  (crossing in the junction mouth per section 11, stop line where it is), `src/render/style.ts`
  (one asphalt colour, class tones kept for the layer), `src/render/scene.ts` (layer order so
  node areas cover markings, the class-tone switch, terrain cache invalidation on the switch),
  `src/render/types.ts` (a `roadClasses` layer flag, default false), `src/ui/layers.tsx` (the
  "Road classes" entry).
- Tests: `tests/network/T20-junction-geometry.test.ts` and `T20-imported-junctions.test.ts`
  (outline rules below), `tests/render` (crossing and colour), `tests/e2e/gate4-layers.spec.ts`
  (the toggle), additively.

## Out of scope

- `src/sim`, `src/routing`, `src/network/conflicts.ts`, `src/network/types.ts`,
  `src/network/lanes.ts`, `src/network/movements.ts`, the setback rule and the cap, the importer,
  the editor. If a geometry problem needs a lane end to move, report it with node and road ids.

## T20 additions (unit)

1. On the junction fixture, Sindelfingen and Munich, every outline is a simple polygon (no
   self-intersection), contains every movement polyline of its node (0.1 m), and contains no
   point farther from the node than the farthest trimmed lane end or gore tip plus 8 m (so
   no hull blobs). Report the count of nodes whose outline changed shape class (fillet,
   straight, extended, gore) on Munich.
2. Smoothness: at every fillet, the outline's tangent at both tangency points matches the
   adjacent road edge within 2 degrees.
3. Gore: on the fixture's acute Y, the outline reaches the gore tip, and no lane marking of
   either road is drawn outside the road's own surface beyond the outline (render test).
4. Crossing order: at a signalized approach the crossing stripes lie between the trimmed
   lane end and the outline, and an ungranted car's stopping position (lane end minus
   `minGapM`) is behind the stop line and the crossing.
5. Colour: with `roadClasses` off every road surface and node area uses the one asphalt
   colour; with it on a node takes the tone of its highest-class road.

## Acceptance

- T20 additions pass; the existing T20 and every other test pass unchanged in intent.
- The four benchmark state hashes are unchanged (1639643273, 3254820089, 1071430910,
  3932636798); `npm run route-audit` zero on the four cities; the Munich probe unchanged.
- Screenshots in the report: the Munich signal junction east of the Donnersbergerbrücke
  with a queue at the crossing, the acute Y of the fixture, a Munich acute approach with a
  gore, and the same view with "Road classes" on and off. T16 figures within noise.
- `npm run check` green; `npm run test:e2e` green on a port of your own.

## Commands

`npm run check`, `npm run test:e2e` (set `CITYFLOWS_TEST_PORT`), `npm run bench`,
`npm run route-audit -- <project or osm file ...>`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148 --scale 0.15`.

## Deliverable

A report (commit message body or a short `REPORT` section at the end of the last commit
message is fine; no new Markdown files) with what works, what is not supported, the T20
results, the Munich shape-class counts, the screenshots' paths, the four hashes and the
final lines of `npm run check`.
