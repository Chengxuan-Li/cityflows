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
