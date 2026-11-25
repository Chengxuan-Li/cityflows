# TASK-346 — Consolidated airside stack: pilot rules become the airside rules

Status: started 2026-11-25 in the owner's 6-hour run (A6). Owner: Claude subagent (Opus 5.5), with lead gates. The
owner's rule for this run is merge on gates: existing cities byte-identical, airports not worse.
Branch `task/346-airside-stack`, worktree `D:\cityflows-wt\346`.
Base: `task/339-parked-blockers` at `e7ce9b31`, plus TASK-342 cherry-picked (`f70e6564`).

## Why

The airside improvements since 2026-11-23 live on pilot branches behind environment switches. The set measured on
Heathrow, Zurich, Boston and London City is
`T330P=300 T330R=1 T330D=1 T330IND=1 T330TOW=1`:

| Switch | What it does |
|---|---|
| `T330P` | progressive ordering, 300 m horizon |
| `T330R` | landing booking from threshold − 5 s, with a deferred claim |
| `T330D` | line-up behind a rolling departure, take-off by wake time |
| `T330IND` | R and D only on runways that cross no other |
| `T330TOW` | a tow does not wait for an arrival already behind it |

On top of those are TASK-339 (no waiting behind aircraft parked across the way; already unconditional) and TASK-342
(order against the body where a ground aircraft stands). Main still runs none of it: Heathrow 06:00–08:00 seed 1 is
80/188 on main against about 146 on the stack, and the full day is 367 on main against 774.

## Goal

1. Make that set the airside behaviour with no switch. With no environment variables, the branch must give exactly
   what the pilot gives with the switches set. Check that the bench JSON is identical for:
   - Heathrow 06:00–08:00 seeds 1 and 3;
   - Zurich 730 seed 1, 06:00–10:00;
   - Boston 06:00–10:00;
   - London City full day.
2. Delete the rejected and diagnostic switches and their code:
   - rejected: `T330R2`, `R3`, `R4`, `RG`, `RI`, `D2`, `D3`, `DSEP` (keep the 75 s constant), `RING`, `BLK`, `BLK2`,
     `EDGE`, `PARK`, `PAD0`, `GW`, `GB`, `STAND`, `RECAT`, `XROUTE`, `R4U`, `TOW2`, `PAVE`, `PLAN`;
   - diagnostic: the `DBG330` / `T330DUMP` / `T330WATCH` / `T330BK` debug output, and debug-only fields such as
     `yieldWhy`.

   Keep behaviour-neutral counters the bench reports (`parkedBlockS`, PROGRESSIVE statistics) if they are cheap.
   Rename `T330*` identifiers in code and comments to plain names, citing TASK-330 / 339 / 342.
3. Update tests that encode main's old airside behaviour to the new rules, each with a reason in the commit body. Add
   no new behaviour.
4. Update `docs/architecture.md`'s airside section to describe the rules now in force.

## Scope

`src/sim/aircraft.ts`, `src/sim/flight-operations.ts` (if any switch lives there), `bench/airside-delay.ts`,
`tests/sim/**`, `docs/architecture.md` (airside section).

## Out of scope

New rules; TASK-340, 343 and 344 changes; `src/schema`; roads, rail and cities.

## Gates (the lead runs the ladder)

- **Identity:** bench JSON identical to the pilot runs listed in Goal 1.
- **Ladder** (lead): Heathrow peak 1 seed → several seeds at peak → several seeds over the full day for Heathrow,
  Zurich and Boston, against main. Airports not worse than main on the owner's merge rule.
- **Existing cities byte-identical:** Freiburg 1710089250, Munich hashes.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
