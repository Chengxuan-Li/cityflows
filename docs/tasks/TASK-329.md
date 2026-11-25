# TASK-329 — Moving aircraft never wait for aircraft that have not started

Status: in progress 2026-11-23 (owner: "lhr case a bit suspicious, what are these aircraft blocked by where no one
is close to it — you are right about your judgement"). Proposed owner: Claude subagent (Opus 5.5, high). Branch
`task/329-admission-unstarted`, worktree `D:\cityflows-wt\329`, ports 5529 / 5629.

## Finding (lead, 2026-11-23, real sim, main 5fdbbce)

The order of admission (TASK-312, `order()` / `commitOrder()` / `waitCap()` in `src/sim/aircraft.ts`) ranks
movements before they move:

- arrivals while still queued in the air;
- departures and tows at their stands, before they have a start grant.

A taxiing aircraft whose route meets the remaining movement of an earlier-ranked aircraft stops and waits,
even if that aircraft is still in the air or at its stand. That aircraft in turn waits for others ranked before
it.

Heathrow, seed 1, 1,300 a day:
- **05:50:** a B77W taxiing in (rank 43) stops on an empty taxiway for a B77W at its stand (rank 35). That one
  waits for a B748 holding, a B738 at its stand, and six arrivals still in the air (ranks 22–31).
- **06:20:** the waits close into cycles of 3–6 aircraft. Example: B77W taxi r43 → A388 queued r42 → B77W
  taxi r91. The A388 waits for a later rank through the parked-in-the-way or yield rules.
- **07:30:** 850 cycles. Nothing moves after about 08:30: 37 landed, 10 departed, 104 holding in the air.

Clip: `D:\cityflows-wt\lead-evidence\video\heathrow-real-sim.mp4`. Wait graphs: `lhr-waits.txt` beside it,
written by `D:\cityflows-wt\lead-evidence\wait-graph.ts`. That tool needs a `debugWaits` export, which lives
only in the throwaway worktree `D:\cityflows-wt\diag` (`git diff` there shows it). Copy it into your worktree
uncommitted if it helps; never commit it.

## Goal

The order of admission keeps its purpose: deadlock-free passage for aircraft that are moving or committed. It
must stop creating waits on aircraft that have not started and cannot start soon.

1. **Moving aircraft go first.** An aircraft on the ground and moving (taxiing, towing, crossing) never waits
   for an aircraft that is still queued in the air (no committed landing) or parked without a start grant.
   Where their movements conflict, the unstarted one is ordered after it: its rank moves behind, or its waits
   are taken when it starts.
2. **Start only when the way is clear.** An aircraft starts (start grant, landing commitment) only if it will
   not stop on a taxiway for an aircraft that has not started. It may wait at its stand or in the air instead.
3. **No wait cycles.** Detect any cycle that still forms and break it deterministically: the aircraft that can
   wait where it is (at a stand, in the air, at a hold clear of others) gives way. A cycle must never persist.
4. **Keep what TASK-312 fixed.** Dead ends, stand pushback against arrivals, runway crossings, and London City's
   clean day.

Pilot in small steps first: the Heathrow 05:00–08:00 window, then full days. Stop at the evidence: if a
variant does not reduce stuck aircraft at Heathrow, say so rather than stacking rules.

## Scope

`src/sim/aircraft.ts` (admission order, start grants, landing commitment), tests in `tests/sim/`. No schema change.
TASK-327 (runway interlocks) also edits `src/sim/aircraft.ts` in parallel. Keep your edits to the ordering
functions and merge the lead line before final verification.

## Gates

- Tests:
  - A synthetic case where a taxiing arrival's route meets the pushback of an earlier-ranked departure that has
    no start grant: the arrival passes, and the departure starts after.
  - A synthetic three-aircraft cycle, as at Heathrow, resolves.
  - No body overlaps or runway conflicts (`tests/sim/aircraft-checks.ts`).
- Real sim, `bench/airside-delay.ts --checks`, branch against base, seeds 1–3:
  - **Heathrow** (1,300): the 05:00–10:00 window, then the full day. Report completed movements, holding in the
    air, aircraft stuck 5 min or more, and gridlocks.
  - **Zurich** at 730, **Boston** (1,000), **London City** (schedule): full day, same table plus taxi times
    and go-arounds.
  - Runway conflicts and overlaps stay 0.
- Airports batch merge rule (existing cities unchanged), `bundled-airport-load` (re-pin only as this change
  explains), `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
