# TASK-381 — Queue reserves at unmarked crossings: why Munich needs them, and a rule that serves all three cities

Status: started 2026-11-27 (lead, 10 h unsupervised run; city work merges under the traffic merge rule and the audit
tolerance). Owner: Codex (gpt-6.2-sol, high). Base: main.

## Finding (TASK-378, TASK-379)

Two diagnoses point at the same rule: the keep-clear queue reserve at ordinary unmarked crossings (TASK-169 zones,
`src/network/keep-clear.ts`, `src/sim/keep-clear.ts`, engine admission and queue stops).

- **London City (TASK-378):** 97% of TASK-279's added delay is queue spillback. Without the reserve at ordinary
  unmarked crossings (branch `task/378-lcy-delay`, `8920c953`), London City goes 385.7 → 249.4 s, worst visit 722 s.
- **Munich, same change:**
  - 0.15 actuated, choice off: +5.5%;
  - 0.15 fixed, choice off: +3.9%;
  - full demand, fixed: +6.9%.
- **Boston (TASK-379, `7be89357`):** 40 of 54 gridlocks are spillback where the reserve beyond a crossing wastes room
  before it. Its pocket variants failed: one had worse delay, the other made London City fail.

Nobody has looked at where Munich loses without the reserve.

## Goal

1. On Munich (0.15 seeds 1–3, actuated and fixed, choice off; full demand seed 1, fixed), compare main with TASK-378 V2:
   - where the added delay forms (roads, nodes, crossings);
   - what holds the vehicles (a car stopped on a crossing blocking a junction exit, walkers held, a turning
     movement blocked, spill into a junction box);
   - which crossings matter. Table the top places.
2. Design one rule from that: for example, keep the reserve only where a car standing on the crossing would block a
   junction (the crossing is within one car length of a junction's conflict area), or only while a walker waits or
   approaches. Then apply it to London City, Boston and Munich. Ground it in a traffic rule where one exists (StVO §11(3)
   / §12, Highway Code rules 151 and 191, UVC). At most two variants.

## Scope

`src/sim/**` (engine admission, `keep-clear.ts`, `walkers.ts`), `src/network/keep-clear.ts`, tests, re-pins.

Out of scope: gate floors, `bench/traffic-baseline.json`, OSM edits, per-id curation, signal programs.

## Gates

- The owner's merge rule:
  - Munich 0.15, seeds 1–12, four configurations, within 3%;
  - full demand within 2% on the mean of seeds 1–5, both modes;
  - Freiburg within 5 s; drain; Sindelfingen; all showcases pass.
- Report London City (mean delay, worst visit) and the Boston morning probe (completed, gridlocks, mean delay).
- If the compiled network changes: the geometry audit within tolerance.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
