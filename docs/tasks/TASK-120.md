# TASK-120 — Dead-end turnarounds

Owner: unassigned
Gate: 7 (road betterment), follow-up to TASK-118 and TASK-119 (lead, 2026-11-09)
Branch: `task/120-dead-end-turnarounds` (created by the lead from main)
Depends on: TASK-103 (strips), TASK-118 (strip manoeuvres), TASK-119 (mapped street-side strips).
Design: this file; `docs/architecture.md` sections 5 (movements and junction geometry), 8 and 9
(the TASK-103 and TASK-118 parking notes) and 10 (diagnostics). Read those before the code.

## Goal

A lane that ends at a dead end (a node with a single two-way road and no gateway) has no
outgoing movement: turn rules never allow a U-turn there, so the compiler emits nothing and
diagnoses `dead_end`. A car that parks on a strip along such a lane, or starts the day there
as a resident's stock, can never leave. In the Munich extract three strips (33 slots, among them
mapped area 135401789 on `r:953`) and in Sindelfingen one strip (7 slots) sit on such lanes.
At full demand this causes most of the rise in counted parking failures in the TASK-118/119
merge (Munich 32 of 1 599 local arrivals, main 21 of 1 433), and the lead raised
`tests/traffic/munich-full-demand.test.ts` to 2.5% until this task restores 2%. Zeroing those
strips' capacity was tried and makes it worse (51): their residents then have no car at all.

Cars must be able to turn around at a dead end, as drivers do at the end of a cul-de-sac.

## Design

1. **Turnaround movement (compile).** At a node whose only road is two-way, open to cars and
   not a gateway, compile one U-turn movement from each inbound lane that has no other way out
   to the outbound curb lane, `turn: 'uturn'`, as an implicit default rather than a turn rule.
   Its path is a turning loop inside the node's cap (a half circle at the cap's width, or a
   three-point-turn polyline when the road is too narrow for the class's turning radius; pick
   one rule and document it). Explicit turn rules that forbid the U-turn still win.
2. **Junction geometry.** The dead-end cap grows only as far as the loop needs (paved, inside
   the cap's outline); no other node, lane or junction surface changes.
3. **Routing and simulation.** The movement is an ordinary movement: the router may use it, and
   the simulation drives it at the movement's speed limit for a U-turn. Gridlock, yielding and
   zone rules apply as for any movement. Strip departures on such lanes now find an exit.
4. **Diagnostics.** `dead_end` stays for lanes that still have no way out (one-way dead ends,
   forbidden U-turns, gateways excluded); a turnaround is not reported.
5. **Measure.** Per city: dead-end nodes found, turnarounds compiled, lanes still dead-ended
   (with reasons); Munich morning at 0.15 and at full demand against main, parking failures
   at the strips named above.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested, as long as it is not named
under "Out of scope"; list each such file and why in your report. Stop and ask the lead only
for a file named under "Out of scope", a contract change this task does not describe, or a
behaviour change to another feature. Trip counts may change; that is not a behaviour change
to ask about.

Pre-approved, no need to ask: `src/network/movements.ts`, `junctions.ts` (the dead-end cap),
`diagnostics.ts`, `compile.ts`; `src/sim/**` only where a U-turn movement needs handling;
`src/render/**` and `src/render3d/**` only where the cap or a movement path draws;
`docs/architecture.md` sections 5, 10 and 11 (the contract change: implicit dead-end U-turns);
`tests/traffic/munich-full-demand.test.ts` (restore `0.02`); tests (a new
`tests/network/T56-dead-end-turnaround.test.ts`, a simulation case where a car leaves a strip
on a dead-end lane), and the hash pins and counts that move, each named with its reason.

## Out of scope

U-turns anywhere other than single-road dead ends; turn-rule editing UI; parking rules and
stock (TASK-118 and the lead's follow-up: keep them); importers; pedestrians (TASK-112).

## Gates

1. **Network.** Lanes, roads and every movement other than the new turnarounds equal main's
   (hash without the new movements and the dead-end caps); grid and town unchanged unless
   they contain a qualifying dead end (report it).
2. **Turnaround.** In T56: a two-way dead-end road gets one turnaround per inbound lane with no
   other exit, drivable by every allowed class; a one-way dead end, a gateway end and a node
   with a forbidding turn rule get none; the loop stays inside the paved cap.
3. **Parking.** In T56: a car parked on a strip on a dead-end lane leaves, turns around and
   completes its trip. Munich and Sindelfingen: zero strips on lanes without a way out unless
   reported with a reason.
4. **Traffic.** `npm run traffic:quick` against main; every failure is a gridlock or a counted
   parking failure, parking failures under 2% of local arrivals. The lead runs the full gate,
   including full demand at the restored 2%, and resets the baseline at merge.
5. **Render.** 2D and 3D shots `V120-munich-dead-end` (the end of `r:953` at 08:00, a car
   mid-turnaround if one can be caught) and the same on main; read them yourself.
6. **Performance.** Compile within 10% of main, step time within 10%.
7. `npm run check`, `npm run test:city`, `npm run traffic:quick` and `npm run test:e2e:smoke`
   green. Heavy e2e cases need `test.setTimeout(420_000)`. Run e2e with
   `CITYFLOWS_TEST_PORT=5320`; never use port 4173 or 5173.

## Checks to run

- While iterating: `npm test` (unit tier), `npm run traffic:quick`,
  `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick` and
  `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, the full `npm run test:e2e` or `npm run bench`; the lead
  runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5320`), import
Munich, find the end of `r:953`, play from 07:00 with "Parked cars" on and watch a car leave a
strip there and turn around; describe what you saw in 2D and 3D.

## Deliverable

A report in the body of your last commit message (no new Markdown files): the turnaround rule
and its geometry, the per-city counts with every remaining dead end and its reason, traffic
before and after (0.15 quick, and the full-demand parking failures if you measured them),
image paths, files changed outside the pre-approved list and why, expectations changed with
their reasons, and the final lines of `npm run check`. Report every timing that grew against
main. Write any Markdown or docs as UTF-8.

Commit on `task/120-dead-end-turnarounds`; do not push or merge. The lead reviews only commits.
