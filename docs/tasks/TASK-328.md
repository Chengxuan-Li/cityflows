# TASK-328 — One runway configuration per day; Zurich uses all three runways

Status: in progress 2026-11-23. Proposed owner: Codex CLI (gpt-6.2-sol, high). Branch `task/328-day-configuration`,
worktree `D:\cityflows-wt\328`, ports 5528 / 5628.

## Owner decision (2026-11-23)

"Let's not change runway direction mid day for now, that would be chaotic. Also maximize runway usage. Zurich
seldom gets all 3 runways used efficiently."

## Finding (lead, real sim, main 5fdbbce)

Zurich at 730 movements locks from about 22:00. At the 21:00 change from north to east (landings 28, take-offs
32/34), a BCS3 already at the hold for end 28 is not re-routed. It waits forever ("no line-up on an end the
configuration has not opened"). About 30 aircraft then wait behind it in admission order, and an A359 waits
155 min at its stand. Clip: `D:\cityflows-wt\lead-evidence\video\zurich-real-sim-root.mp4`.

## Goal

1. **No scheduled configuration change during the operating day**, at every airport with concepts:
   - Zurich runs the north concept (landings 14, take-offs 16 and 28) from 06:00 to the night ban at 23:30.
     Drop the south (06–07) and east (21–23:30) slots for now, and keep the night closure.
   - Heathrow keeps one configuration all day. Drop the 15:00 alternation for now.
   - The wind control still chooses a configuration when the user sets a wind that makes the current one
     unsafe. That is a user action, not a schedule.
   - Keep the other concepts' data in the source as comments or unused entries only if the code stays simple.
     Otherwise delete them and say so in the comment that cites the AIP.
2. **Departures already at a hold re-route when their end closes** (wind change, or a closure at the night ban):
   a departure waiting at the hold of an end that is no longer open re-routes to an open departure end like
   taxiing departures do (`rerouted`), or returns to a stand if none is reachable. Test it on a synthetic
   airport.
3. **Use Zurich's three runways fully under north.**
   - **Arrivals on 14, departures split between 16 and 28.** Use a rule (taxi distance plus the current queue
     at each end), not a fixed share. Each type must fit its runway's length and code.
   - **Optionally, at peaks, arrivals on 16 as well.** Do this only if it measurably raises completed movements
     without new conflicts; real Zurich lands on 16 in the north concept at peaks.
   - **Measure per-runway use:** movements per hour per end, and the share of the day each runway is occupied.
   - **Where 16 and 28 meet,** they depend on each other. TASK-327 is narrowing interlocks to intersection
     areas in parallel. Measure on your base, merge the lead line when it lands, and say which numbers include
     it.

## Scope

`src/sim/runway-configuration.ts`, `src/sim/flight-operations.ts` (end assignment and re-routing),
`src/sim/aircraft.ts` only where the re-route at a hold needs it, with tests. Also `docs/architecture.md` if it
states the concepts. No schema change.

## Gates

- Tests:
  - Zurich and Heathrow: one configuration from opening to closing.
  - A departure at a hold re-routes after its end closes (synthetic).
  - The departure split uses both 16 and 28.
- Real sim, `bench/airside-delay.ts --checks`, full day, seeds 1–3, branch against base: **Zurich** at 730 and at
  its schedule size, **Heathrow** (1,300), **London City**. Report completed movements, go-arounds, gridlocks,
  taxi times, movements per runway end, and runway conflicts (must stay 0).
- Airports batch merge rule, `bundled-airport-load` (re-pin Zurich or Heathrow startup state only as this change
  explains), `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
