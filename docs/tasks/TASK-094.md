# TASK-094 — Stop lines behind set-back crossings at signals (B53)

Owner: unassigned
Gate: 5 (owner decision 2026-11-07: "Yes, move stop lines")
Depends on: TASK-072 (stop positions, crossings on the road), TASK-091 (crossings everywhere,
set-back), TASK-090 (tiers). Design: `docs/plan.md` backlog B50 and B53, the TASK-091 review;
`docs/architecture.md` sections 5.1 and the TASK-072 stop-position paragraph. Read those
before the code.

## Goal

At a signalised approach the crossing still sits where TASK-072 put it, 0.25 to 2.75 m from
the cut, between the stop line and the junction. TASK-091's set-back (the near stripe 1 m
beyond the curb return) could not apply there, because the crossing would land behind the
stop line and cars waiting at red would stand on it (T26). The owner approved the simulation
change: the crossing sets back at signal arms like everywhere else, and the stop line moves
behind it.

## Design

1. **Crossing placement.** At signal arms, the crossing follows TASK-091's set-back rule:
   near stripe 1 m beyond the curb return, outside the junction polygon and curb arcs,
   moving out along the road as TASK-089 does. Remove the signal-arm exception. One function
   must give the crossing's span along each lane (near and far edge in lane metres), and both
   the renderer and `populateStops` use it. Keep the span out of the compiled network unless
   the renderer already needs it there.
2. **Stop line.** On a lane whose road end has a crossing and a served signal,
   `stopM = crossing far edge - 0.5 m`, measured toward the road's start, so a waiting car's
   front stays 0.5 m short of the stripes. Clamp `stopM` to `[0.5 * lengthM, lengthM]`. Where
   the clamp bites, draw no crossing (TASK-091's "too short" rule) and keep TASK-072's 3 m
   value. The stop marking line is drawn at `stopM`, as now.
   - Non-signal ends with crossings keep their stop rules. Crossings there are decorative and
     cars do not stop for them.
   - If TASK-091's overrides turn a signal arm's crossing off, `stopM` falls back to TASK-072's
     value.
3. **Simulation.** No rule changes besides the stop position. Benchmark hashes change: record
   the new ones in `bench/latest.log`, and show that a second run reproduces them.

## In scope

`src/network/stops.ts`, the shared crossing-span function (in `src/network` or a module both
layers may import, respecting the layer rule), `src/render/layers/roads.ts` (crossing
placement only), `tests/sim/T26*`, `tests/render/T41*`, `bench/latest.log` (new hashes), the
traffic baseline `bench/traffic-baseline.json` if the gate's main figures move (the lead
decides), and expectations that move, each named.

## Out of scope

`src/network/junctions.ts` and `src/render/layers/nodes.ts` (TASK-092 is in parallel),
`src/network/continuity.ts`, `corridor.ts`, `lanes.ts` and `src/importers` (TASK-093 is in
parallel). No other simulation rule changes.

## Gates

1. **Crossings.** No stripe at a signal arm lies inside a junction polygon, inside a curb arc,
   or within 1 m of the curb return, on all four cities. `n:291` and Sindelfingen `n:110`
   shots show this.
2. **Stop lines.** At every signalised approach with a crossing, a stopped car's front is at
   least 0.5 m short of the crossing's far edge (T26 extended).
3. **Traffic.** `npm run test:traffic` passes the gate (at least 3 497 completed and 90
   percent of the recorded 3 762; gridlocked at most 1.5 times 49; stalledHeads 0; failures
   only gridlocked). Report the full-demand morning too. Use `traffic:quick` while iterating.
4. **Benchmarks.** New hashes are recorded and reproduced by a second run. Report the per
   scenario completed and failed counts against the old ones, and explain any change of more
   than 2 percent.
5. `npm run check` and `npm run test:city` green; `test:e2e:smoke` green on port 5287.

## Acceptance

All gates. Give `npm run geometry-shots -- <dir> --only ...` before and after (B52-n291,
R3-1-n1181, B41-n949, and a Sindelfingen `n:110` camera). Read the images yourself.

## Deliverable

A report in the body of your last commit message (no new Markdown files):

- the crossing-span function;
- the stop rule as implemented;
- old and new hashes;
- benchmark and traffic numbers;
- image paths;
- the final lines of `npm run check`.

Commit in your git worktree; the lead reviews only commits.
