# TASK-384 — Runway checker: a departure turning onto the runway behind one lined up (TASK-367's widening)

Status: started 2026-11-28. Started by the lead in the 9 h autonomous run (owner 2026-11-28: "Take all suggestions"). Owner: Codex (gpt-6.2-sol, high). Base: main.

## Finding (TASK-367)

`tests/sim/aircraft-checks.ts` (`exemptRunwayPair`) exempts two departures lined up on one runway end only when they are
in line along the front aircraft's heading. A second departure still swinging onto the runway at an intersection
(TASK-360's multiple line-up) is then counted as a real runway conflict. TASK-367's branch (`587a9aa0`) widens the
exemption to either aircraft's heading and adds `tests/sim/runway-exemptions.test.ts`. TASK-382's one Heathrow day-2
conflict (G-KFAD and G-FDXM on 27R at 18:57:47) looks like the same case.

## Goal

Bring TASK-367's checker change alone to main (not its admission-order rule, which stays parked behind `T367`). The
owner accepted this gate-metric change on 2026-11-28.

## Scope

`tests/sim/aircraft-checks.ts`, `tests/sim/runway-exemptions.test.ts`, the bench only if it imports the checker.

## Gates

- The new test fails without the change.
- Main's references unchanged: Heathrow peaks 1–5 and days 1–3, Zurich, Boston and London City days keep
  `runwayConflictsReal` 0 (the simulation itself is untouched; results identical apart from that count).
- TASK-382's day-2 sample: run TASK-382's branch (`task/382-a380-tows`, `T382=rs`) Heathrow day 2 with the new checker
  and report whether the 18:57:47 sample is exempted, and why.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Result (2026-11-28)

Ported only TASK-367's “Runway checker” change from `587a9aa0`. For two `line-up` poses on the
same non-null runway end, the checker accepts a longitudinal gap of at least half their combined
length along either aircraft's heading. Crossing, rolling, body-overlap and protected-intersection
checks are unchanged. No simulator or bench code changed and `T367` admission ordering stayed out.

The TASK-367 regression in `tests/sim/runway-exemptions.test.ts` failed on the original checker
(`expected false to be true`, 1 failed / 6 passed) and passed after the port (7 passed). It
also rejects aircraft too close to line up.

**Main references.** All 15 TASK-383 main runs (`e6ffa10d`, TASK-377 enabled, `R/t383/m-*.json`)
reported zero `runwayConflictsReal`: Heathrow peaks 1–5 and days 1–3, Zurich days 1–3
(`--daily 730`), Boston days 1–3 and London City day 1. An old exemption that passed along
the selected aircraft's heading still passes along that heading, so the checker cannot add any
previously uncounted conflicts. No other deterministic result fields are affected. Fresh branch
runs for Heathrow peak seed 1 and Heathrow day 2 matched main's full JSON excluding `wallS`.

**TASK-382 day 2.** In a detached `d6d29541` worktree with `T382=rs`, the 18:57:47 (68,267 s)
sample was exempted. The raw checker still counted one pair. Both departures were in `line-up` on
27R. The old checker measured 7.2 m along the turning G-FDXM's heading, below the 38.15 m required
by the two lengths. The aligned G-KFAD's heading gave 349.9 m of separation, so the new checker
correctly exempted the pair. The full day changed `runwayConflictsReal` from 1 to 0 and matched
TASK-382's saved `R/t382/days/rs-lhr-d2.json` in all other fields except `wallS`.

**Gates.** All passed (exit 0).

- `npm run check`: 2,240 unit tests passed, 2 skipped. Vite built in 2.01 s.
- `npm run test:city`: 77 files passed, 292 tests passed, 1 skipped (2,893.88 s).
- `npm run test:traffic:light`: 2 files passed, 5 tests passed, 1 expected fail (406.13 s).
- `npm run test:e2e:light` on port 5393: 63 passed (5.3 min).

Raw reruns and gate logs are in `D:/cityflows-wt/330-pilot/R/t384/`.
