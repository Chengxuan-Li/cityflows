# TASK-337 — Aircraft wait at runway holds clear of rolling widebodies

Status: in progress 2026-11-23 (owner: "you may move the fixes"). Proposed owner: Codex CLI (gpt-6.2-sol, high).
Branch `task/337-hold-clearance`, worktree `D:\cityflows-wt\337`, ports 5537 / 5637. Base: main.

## Finding (TASK-330 pilot, 2026-11-23)

Zurich at 730 movements a day, seed 2, 06:00–10:00, main 771235f: a BCS3 waiting at a mapped runway-16 hold near
(−981, −532) is touched by a B77W's take-off roll at 10:33. In the pilot, the same hold had two more cases (E175 against
an A359 at 09:33, A20N against a B77W at 10:40). The aircraft stops at the hold position. Its body is then inside the
wingspan of a large type rolling on the runway centreline: the hold is placed for smaller types, and nothing checks the
waiting body against the widest type the runway takes.

## Goal

An aircraft that stops short of a runway (runway hold, crossing hold, line-up wait) stands clear of the widest type
that runway takes rolling on its centreline, plus the margin the sim already uses for bodies. If the mapped hold is
too close, the stop moves back along the aircraft's own route until it is clear, at most 150 m. Nothing else changes.

The TASK-330 pilot has a working version of this rule: commit `1b57f5a8` on branch `task/330-landing-flow`, in
`src/sim/aircraft.ts`. It uses `widestOfCode` and a step-back loop in 2 m steps, up to 150 m. Read
`git show 1b57f5a8 -- src/sim/aircraft.ts` and port **only** the hold-clearance rule. Leave out every other part of that
commit: landing flow, release, commitment, the bench fields and the debug logging. Put the rule where main computes the
stop short of a runway. Keep it deterministic.

## Scope

- `src/sim/aircraft.ts`, for the stop position short of a runway.
- Tests in `tests/sim/`.

No schema change. `bench/` stays unchanged.

## Out of scope

- Everything else in the TASK-330 pilot.
- `tests/sim/aircraft-checks.ts`: the overlap and runway-conflict checkers stay as they are.
- Zurich seed 1's 25 pushback overlaps, a separate problem.

## Gates

- **Synthetic test:** on a runway built in the test, a small aircraft waits at a hold placed too close for a widebody.
  A widebody's take-off roll passes with no body overlap. A runway that takes only small types keeps the hold where it
  is.
- **Real sim** (`bench/airside-delay.ts --checks`, branch against base):
  - Zurich at 730, seeds 1–3, full day: seed 2's overlaps from this cause go to 0, and no other count gets worse.
  - Heathrow (1,300), Boston (1,000) and London City (schedule), seed 1, full day: completed movements, go-arounds,
    gridlocks, overlaps and runway conflicts not worse than base. Report taxi times.
- Airports batch merge rule: existing cities byte-identical.
- `bundled-airport-load`: re-pin only if a startup state changes, and say why.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
