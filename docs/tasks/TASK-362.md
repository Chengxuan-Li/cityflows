# TASK-362 — A stop line under two actuated controls never gets both greens

Status: started 2026-11-26 (owner defaults; bounded, Codex). Owner: Codex (gpt-6.2-sol, high). Base: main.

## Finding (TASK-279 re-run, 2026-11-26)

Branch `task/279-unmarked-yield` `0145e94a`, Freiburg gate: 19 vehicles gridlock from 07:50.

The first car on `r:1348` stands at a stop line shared by the `n:18` signal and a tram crossing. The tram crossing
holds it for `n:39`'s red. `n:18` gives it green, but the tram crossing then holds it. The two actuated controls
alternate, so the car never gets both at once.

TASK-222 (merged 2026-11-19) fixed a lock between the same controls. It keeps a green only when cars wait on each
other, so it does not cover this case.

TASK-279 shows the lock is in main's signal logic, not in its own rule. Reading every unmarked crossing as a zebra
gives main's hash exactly, and holding waiting walkers back still gives 19 gridlocked. TASK-279 only shifts the
timing into it.

## Goal

A general rule in the actuated control (`src/sim/signals.ts`, and the rail-crossing calls TASK-222 touched): a head
held at a stop line by two controls is served.

Possible rules:
- the controller that turns green second keeps its green, or extends it, while the head still waits on the first
  one;
- the two calls are coordinated so both greens overlap for at least the head's start-up time;
- a bounded wait after which the second control serves the waiting head.

Cite the rule. Signal-coordination practice, for example the German RiLSA, or MUTCD 8C/4D on pre-emption near
grade crossings, would do.

## Scope

`src/sim/signals.ts` and the actuated-control code TASK-222 changed, their tests, and re-pins.

## Out of scope

The crossings importer (`src/network/crossings.ts`), `src/sim/aircraft.ts`, `src/schema`.

## Gates

- A repro test that fails without the rule. Build it from the TASK-279 branch state, or from a minimal fixture with
  one stop line under a signal and a tram crossing tied to a second actuated signal.
- On TASK-279's branch, Freiburg's gate no longer gridlocks. Merge the fix into a scratch copy; do not commit there.
- On main, the owner's merge rule:
  - Munich 0.15, seed 1, all four configurations (choice off/on × fixed/actuated). If not identical, seeds 1–5.
  - Full demand, mean of seeds 1–5, if Munich changes: within 2%.
  - Freiburg gate within 5 s of main, with no gridlock or stalled heads.
  - All panel showcase gates pass.
- `npm run check`, `npm run test:city`, `npm run test:traffic:light`, `npm run test:e2e:light`.
