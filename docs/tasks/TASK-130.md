# TASK-130 — Break the Landsberger loop (B56 reopened)

Owner: unassigned
Gate: 7 (road betterment), B56 reopened by the owner (2026-11-10, TASK-122 re-measure)
Branch: `task/130-landsberger-loop` (created by the lead from main)
Depends on: TASK-121 (queue-head detours), TASK-122 (parking egress, merged with the baseline
reset), TASK-077 (gridlock respawn).
Runs alongside: TASK-128 (stations as trip ends), which adds walk trips around Donnersbergerbrücke
and does not touch `src/sim/engine.ts`, `intersection.ts` or `reroute.ts`. The lead reconciles at
merge; both reset the traffic baseline.
Design: this file; `docs/architecture.md` section 8 (simulation: intersections, lane changes,
re-routing, gridlock recovery) and section 7 (routing). Read B56 in `docs/plan.md` ("Owner
findings"), `docs/tasks/TASK-121.md`, and the TASK-121 and TASK-122 review entries before the code.

## Goal

Munich at 0.15 still holds the B56 deadlock loop on Landsberger Straße. TASK-121 lets a stuck queue
head take a detour, which brought the stalled-head count to 0 at 10:00, but the loop itself never
cleared. On main at 10:00 about 20 cars stand on each of `r:961`, `r:364`, `r:248`, `r:703`
(`n:967`'s ramp), `r:273` and `r:997`, with waits of 80 to 100 minutes. The cars in the cycle each
wait for the car ahead, and only TASK-077's respawn (180 s standing, three times, then
`gridlocked`) thins them.

The gate only sees whether the front car moved in the last 5 minutes, so the loop shows up as a
stalled head by chance:
- **TASK-122 re-measure:** one stalled head on `r:961` in every one of three demand seeds; main had
  one on `r:248` in seed 3. The baseline now holds 1 stalled head at 10:00 and 2 at 09:30
  (`r:248`, `r:961`), all on this loop.
- **Gridlock is noise:** over three seeds main had 17 / 35 / 43 gridlocked, TASK-122 30 / 32 / 36.
- **Every gate is fragile:** an unrelated 1 cm shift once moved completed trips by up to 211.
- **More traffic arrives than before:** 743 cars pass `r:961` by 10:00 since TASK-122, against
  609, because fewer cars fail or search for parking upstream.

Break the loop so the corridor drains, then gate on it over several seeds.

## Design

1. **Trace first.** Before changing any rule, trace the loop on main at 0.15, seed 1, from 07:30
   to 10:00, in the default fleet:
   - the cycle of lanes that closes the loop, with the junctions between them (`n:263`, `n:638`,
     `n:967`, `n:936`, `n:247` and whatever the trace shows);
   - for each head in the cycle over time: its planned movement and the refusal reason
     (`exit-full`, `box`, `gap`, `signal`), whether TASK-121's detour fired, what it found, and
     why no detour was taken;
   - which cars sit inside junction boxes when the cycle locks, and whether they entered a box
     whose exit was already full;
   - where the corridor's cars come from and go (origin and destination places, parking
     facilities such as the `pk:1951` to `pk:1981` garage cluster).

   Put the trace in your report. Then state which mechanism closes the cycle. If the cause is in
   the network (a lane connection, a missing movement, a signal plan that never serves a
   movement, a ramp geometry) rather than in the simulation rules, stop and report to the lead
   before changing `src/network` or the importer.
2. **The rule.** Pick the smallest rule change that breaks the cycle the trace shows. Candidates,
   in the order the lead expects them to matter:
   - **Keep the box clear:** a car does not enter a junction box unless its exit lane has room for
     its whole length beyond the box (an "exit-full" check at entry, not only at the stop line),
     with the existing `boxWaitS` as the bound;
   - **Give way at the cycle's merge:** when two queues feed one lane, alternate (zipper) instead
     of letting one stream starve the other;
   - **Wider head detours:** TASK-121's candidates widened to lanes the head can still change to
     before the stop line.

   Explain why the chosen rule is general (it would apply to any such cycle, not only Munich's)
   and why the others were not needed. Keep `SimParams` additions to named, defaulted fields.
3. **Seeds in the probe.** Add an optional demand seed to `probeMorning` (`bench/import-probe.ts`)
   and to the quick tier, default 1 so every existing pin stays where it is.
4. **Measure.** Per run, against main at your branch point:
   - Munich 0.15 to 10:00 for seeds 1, 2 and 3: completed, gridlocked, parking failures, stalled
     heads with their roads, mean delay, and the longest wait of any car on the loop's roads at
     10:00;
   - the quick 09:30 tier (seed 1);
   - Sindelfingen 0.15 to 10:00;
   - Munich full demand (`tests/traffic/munich-full-demand.test.ts`);
   - T53 with and without walkers;
   - step time and route requests for the seed 1 run.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file the
feature needs in order to be wired in, type-check or be tested, as long as it is not named under
"Out of scope"; list each such file and why in your report. Stop and ask the lead only for a file
named under "Out of scope", a contract change this task does not describe, or a behaviour change
to another feature.

Pre-approved, no need to ask:
- `src/sim/intersection.ts`, `src/sim/engine.ts` (`planLane`, the head detour, entry checks),
  `src/sim/reroute.ts`, `src/sim/lane-change.ts`, `src/sim/merge.ts`, `src/sim/params.ts` and
  `SimParams` in `src/schema` (new defaulted fields);
- `docs/architecture.md` section 8;
- `bench/import-probe.ts`, `bench/traffic-quick.ts` (the seed option and a loop census) and
  `bench/traffic-baseline.json` (the baseline resets at this merge, owner rule 7; the lead
  re-records it);
- tests: a new `tests/sim/T66-box-cycle.test.ts` (or a name that fits the rule), the traffic tests'
  expected counts and hash pins that move, each named with its reason.

## Out of scope

- `src/sim/parking.ts`, `src/sim/connectors.ts`, `src/sim/persons.ts`, `src/sim/walkers.ts`: no
  change to parking, person trips or walkers.
- `src/demand/**` (TASK-128 works there), `src/routing/**` except reading routes, `src/network/**`
  and the importer unless the lead agrees after the trace (Design 1).
- Signal plans and lane geometry, B54 east and B55.

## Gates

1. **Rule.** In T66, on synthetic fixtures:
   - **The cycle:** a small ring of four junctions loaded until it locks on main locks no more:
     every car completes or leaves the ring within a bound you state;
   - **No regressions:** an uncongested junction gives the same results as main (same arrivals
     and the same order);
   - **Determinism:** same seed, same state hash.
2. **The loop drains.** Munich 0.15 to 10:00, seeds 1, 2 and 3:
   - 0 stalled heads in all three seeds;
   - no car on `r:961`, `r:364`, `r:248`, `r:703`, `r:273` or `r:997` waits more than 15 minutes
     at 10:00;
   - completed at least main's for each seed; gridlocked at most main's mean over the three seeds;
     parking failures at most main's (0).
3. **Traffic.** `npm run test:traffic:light` passes. Update the expected counts that move, each
   with its reason; the baseline resets at merge and the traffic gate goes back to 0 stalled heads.
4. **Elsewhere:**
   - **Sindelfingen:** completed and gridlocked no worse than main's.
   - **Full demand:** the full-demand test passes; report completed and gridlocked against main.
   - **T53:** passes, at the 5% walker cost the owner allowed for TASK-122. Report whether it is
     back under 3%.
5. **Performance.** Step time within 5% of main on the seed 1 run, warm, side by side, nothing else
   running. Report route requests against main.
6. **Checks.** The light tier (AGENTS.md "Delivering a task"):
   - `npm run check`, `npm run test:city`, `npm run test:traffic:light` and
     `npm run test:e2e:light` are green;
   - so are `T16-performance`, `T54-parking-motion`, `T57-person-trips` and `demo-c-bypass`.

   Run e2e with `CITYFLOWS_TEST_PORT=5330` and `CITYFLOWS_PRODUCTION_TEST_PORT=5430`; never use
   port 4173 or 5173. Do not run the whole `npm run test:e2e`, `npm run test:traffic` or
   `npm run bench`; they run at checkpoints.

## Acceptance

All gates. Then open the app (`npm run dev -- --port 5330`), import Munich at 0.15 and play from
07:00 at ×10 to 10:00:
- watch Landsberger Straße between the Donnersbergerbrücke and `n:247`;
- check that the queues move and no car stands in a junction box for minutes.

Describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files):
- the trace: the cycle, the heads, the refusal reasons, why TASK-121's detour did not break it;
- the rule, why it is general, and the candidates you did not need;
- every count under Measure, against main, for each seed;
- files changed outside the pre-approved list and why;
- expectations changed, with their reasons;
- the final lines of `npm run check`.

Report every timing that grew against main.

Commit on `task/130-landsberger-loop`; do not push or merge. The lead reviews only commits.
