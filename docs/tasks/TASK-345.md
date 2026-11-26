# TASK-345 — Runway-conflict checker exemptions in the tests

Status: started 2026-11-25 (A5). Owner: lead.
Branch `task/345-checker-exemptions`. Base: main.

## Finding

On 2026-11-24 the owner approved exempting three kinds of runway sharing from the runway-conflict check:
- a crossing at least 150 m behind a landing roll;
- crossings together;
- a line-up behind a departure rolling away.

Only `bench/airside-delay.ts` on the TASK-330 pilot reports this, as `runwayConflictsReal`. The test checker
`runwayConflictCheck` in `tests/sim/aircraft-checks.ts` still counts every pair.

## Goal

`runwayConflictCheck` returns both the raw count and the count without the approved exemptions, using the bench's
rules:
- a crosser (taxi or tow) at least 150 m behind a landing roll, along its heading;
- two crossers;
- a `line-up` aircraft behind a `takeoff-roll`, `rotation` or `climb` aircraft on the same runway.

Tests that assert no runway conflicts assert the exempt-aware count. Main's behaviour is unchanged.

## Scope

`tests/sim/aircraft-checks.ts`, its callers in `tests/` and `bench/airside-delay.ts`.

## Tests

`npm run check`, `test:traffic:light`, and the airport tests that use the checker.
