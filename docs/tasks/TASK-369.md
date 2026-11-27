# TASK-369 — Heathrow: an arrival whose way in is blocked by a parked aircraft takes another stand

Status: started 2026-11-27 (owner defaults; airside: merge on gates, realism changes allowed with a cited rule).
Owner: Codex (gpt-6.2-sol, high). Base: main `3602dbd7` (TASK-363 on by default).

## Finding (TASK-353, TASK-358, TASK-363)

With TASK-363 on, an arrival whose way to its stand passes an aircraft parked across it steps out of the landing
order and waits in the air until the way is clear. It no longer holds the arrivals behind it, but it still waits.
Heathrow stepped-out time (bench `steppedOut`):
- peak seed 1: remote stand `st:31169` 1,740 s (the aircraft at `st:31168` stands across its way in);
- full days 1–3: `st:31169` 7,735 / 1,835 / 5,715 s; stand 232 1,840 s and stand 412 490 s on day 2.

`standAvailable` (`src/sim/flight-operations.ts`) checks `standPairSafe` against parked neighbours when a stand is
assigned. TASK-358's way-in pairing rule (parked, `task/358-helipad-clearance` `1ed91f74`) made days worse:
772/726/736 against 752/758/777.

## Goal

An arrival whose way in is blocked by a parked aircraft for longer than a short wait is given another free stand of its
kind, nearest first, as stand planners do (stand reallocation on the day; cite a source such as Heathrow's Stand
Allocation Rules or the ICAO Airport Planning Manual, Doc 9184 Part 1). The reassignment is made while the arrival
is still in the air, or at the latest when it lands. If no stand of its kind is free, it keeps today's behaviour.

Keep TASK-363's step-out and approach order, the TASK-339 parked-blocker rules and the TASK-353 tow rules intact.

## Gates (owner ladder)

1. Heathrow 06:00–08:00 seed 1, `--checks`.
2. Heathrow peaks seeds 1–5 against main:
   - completed not worse in sum;
   - stepped-out seconds down;
   - go-arounds not worse in sum;
   - overlaps 0, `runwayConflictsReal` 0, no gridlock.
3. Full days, seeds 1–3: Heathrow, Zurich (`--daily 730`) and Boston, plus the London City day, against main:
   completed not worse, go-arounds not worse in sum per airport.
4. `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`; re-pin
   `tests/traffic/bundled-airport-load.test.ts` if it changes. City hashes identical.

Main references (on `3602dbd7`) must be measured first: Heathrow peaks 1–5 and days 1–3. TASK-363's runs with the same
code are `D:\cityflows-wt\330-pilot\R\t363\m-p1..p5` and `m-d1..3`; Zurich, Boston and London City are unchanged from
`t360\irm-zrh-d1..3`, `irm-bos-d1..2`, `t353\fo-bos-d3` and `irm-lcy-d1`.
