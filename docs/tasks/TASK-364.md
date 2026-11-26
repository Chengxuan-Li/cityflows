# TASK-364 — One-way to two-way continuations without the Munich full-demand loss (TASK-348 rule 3)

Status: started 2026-11-26 (owner defaults; bounded, Codex). Owner: Codex (gpt-6.2-sol, high). Base: main.

## Finding (TASK-348, 2026-11-26)

The owner decided that nodes where a one-way road becomes two-way are laid out as continuations, amending
`docs/architecture.md` §5.1. TASK-348 implemented this as rule 3:
- `08f5e139`: same lanes only;
- `a3db7964`: room for a 15 m taper.

The rule is switched off in `f65d75ff` because it failed the owner's merge rule. With rule 3, Munich's results were:

| Run | Without rule 3 | With rule 3 |
|---|---|---|
| Full demand, fixed time, mean of seeds 1–5 | 1,797.4 s, 3,291 completed | 1,891.8 s (+5.3%), 3,180 completed |
| 0.15 morning, actuated, mode choice on, seeds 1–5 | 87.6 s | 91.6 s (+4.6%) |

Rule 3 is the only change to Munich's network: Munich's signalised crossings are group members. The nodes it lays
out in Munich are, among others, `n:347`, `n:40`, `n:705`, `n:452` and `n:670`.

## Goal

1. Turn rule 3 on and find where the loss comes from. Compare per node, main against rule 3:
   - delay;
   - queue;
   - movements;
   - lane connections.

   A continuation may change:
   - which lanes connect;
   - the merge or taper length;
   - whether a node still holds vehicles;
   - turning movements that a junction layout allowed and a continuation drops.
2. Fix the cause with a general rule in the continuation layout. Examples:
   - keep the lane connections the junction layout gave;
   - lay out only nodes without turning movements;
   - a taper length by speed.
3. Measure the fixed rule under the owner's merge rule. If it misses, at most one variant, with both tables.

## Scope

The rule 3 code in `src/network` (`compile.ts`, `lanes.ts`, `junctions.ts`, as TASK-348 touched), its tests, the
Freiburg rebuild and pins, re-pins.

## Out of scope

`src/sim/**`, `src/schema`, the audit, `bench/traffic-baseline.json`, OSM edits, per-id curation.

## Gates

- Owner's merge rule against main:
  - Munich 0.15, seeds 1–12, both signal modes, choice off and on, delay within 3%;
  - full demand, mean of seeds 1–5, both modes, within 2%;
  - Freiburg gate within 5 s;
  - drain criterion;
  - all panel showcase gates.
- Geometry audit within the lead's tolerance (< 1 cm, < 1 m², one non-sharp corner).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
