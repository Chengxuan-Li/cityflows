# TASK-244 — Departing batches spread over routes (latent fault found by TASK-239)

Status: parked 2026-11-20 (meets the thresholds but not its aim; new stalled heads; review in `docs/plan.md`). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/244-route-batching`, worktree `D:\cityflows-wt\244`, ports 5444 / 5544.

## Goal

TASK-239's diagnosis (review in `docs/plan.md`; evidence in `D:\cityflows-wt\239-evidence\comb`) found
that Freiburg's gate run (0.15, seed 1) has two outcomes, a normal morning (about 78 s) and a jam at
08:00 (90 to 96 s), and small unrelated changes pick one. Road costs (`src/sim/link-costs.ts`) refresh
every 60 s (`linkCostIntervalS`), smoothed with alpha 0.3, from cars that finished a road only; every
car departing within one interval sees the same costs and gets the same cheapest route (the 0.1 route
noise does not split them). A batch of about 50 trips leaving p:2257, p:2263, p:2403 and p:2489 at
about 08:00 for the station places flips together from Wilhelmstraße (`r:698`) onto Schnewlinstraße's
chain of short roads (`r:805`, `r:807`, `r:441`, `r:1245` to the signal at `n:364`), which queues.

1. Reproduce: main's Freiburg seed 1 and TASK-239's rebased tip (`task/239-node-crossings`, `6fd050e`,
   90.3 s), plus the single-link probe (only 1245631005 kept: 91 to 96 s).
2. The smallest rule that spreads a batch: for example, between cost updates, count cars already routed
   onto a road but not yet past it and add a load term per car to that road's cost (BPR-style against
   capacity); or a switching margin on first routes like the 0.15 reroute hysteresis. Say which and why.
3. Show Freiburg's seed 1 stays in a narrow band across TASK-239's probes, and measure everything; Munich
   will move (route choice everywhere), and the merge rule judges.

## Scope

`src/sim/link-costs.ts`, the engine's route assignment that uses it (`src/sim/engine.ts`), `src/sim/params.ts`
(a new parameter if needed), tests.

Out of scope: `src/routing/**` (TASK-243 is changing it for speed), `src/sim/rail-crossings.ts`,
`src/network`, the importer, `src/schema`, gate floors, `bench/traffic-baseline.json`.

## Gates

- A test that reproduces the batch flip on a small network and passes with the rule.
- Freiburg 0.15 seeds 1 to 6 on main and on TASK-239's tip, main against branch; the probe band.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both modes (drain
  criterion); full demand both modes; Freiburg's gate; Sindelfingen; the Munich gate and mode-share
  guard (references: the newest figures in `docs/plan.md`).
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the flip, the rule, the band, the traffic tables.
