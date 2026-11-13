# TASK-161 — Junction-group signal programs that serve every approach

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch
`task/161-group-signals`, worktree `D:\cityflows-wt\161`, ports 5361 (production 5461). It is
queued after TASK-154 (B56) and TASK-153 are on main.

## Problem

TASK-154 drained the Landsberger loop's deadlock cycles: there are no sustained cycles on seeds 1
to 3, and no stalled heads. But single visits to loop roads still exceed 900 s:
- `r:961`: 1,803 / 1,785 / 1,544 s;
- `r:997` and `r:273`: up to 1,299 s.

TASK-154 traced `r:961` to junction group 10's generated signal program. Its right turn gets 15 s of
green per 120 s cycle, and its through movements cross the `r:966 > r:703` stream, which never
stops inside the group. The `r:997` and `r:273` waits came from the pk:2049 jam, which TASK-153
addresses.

## Goal

Generate a junction group's signal program (TASK-131's single coordinated controller) so that
every approach movement gets green time in proportion to the demand and capacity it serves. No
movement may be starved by a stream that never stops inside the group. Use a general rule: for
example, a minimum green share per approach, phases that also stop the dominant inner stream, and
splits weighted by lane capacity. Don't hand-tune group 10.

Keep the existing rules intact:
- signals in a group coordinate as one controller;
- inner links carry no control;
- walk greens follow TASK-111.

## In scope

- `src/network/groups.ts`, `signals.ts` and `signal-program.ts`, where group programs are
  generated.
- The signal editor, only if its display of group programs needs it.
- Tests.
- `docs/architecture.md`, the section on signal programs.

## Out of scope

- Intersection admission and flow rules (`src/sim/intersection.ts`, TASK-154's area).
- Parking.
- Demand.
- The traffic gate and its floors.

## Gates

1. TASK-154's drain criterion on seeds 1 to 3. Criteria (a) to (d) are defined in TASK-154.md.
   Criterion (b), no single loop-road visit over 900 s, must now hold for `r:961`. Report all six
   roads per seed.
2. Munich seed-1 gate unchanged. Report seeds 2 and 3, and step time.
3. Every group program in Munich and Sindelfingen:
   - each approach movement has a nonzero green;
   - the minimum share rule holds;
   - cycle lengths are reported before and after.
4. T26, T66, T68, T75 (crossings), the signal editor tests, `npm run check`, `test:city`, and
   `test:e2e:light` on port 5361.
5. Shots of group 10 at 09:30, before and after, and of the signal editor showing its program.

## Report

Write it as the commit body: the rule, the per-group census, the drain criterion per seed, the
gate, hashes moved and why, files touched, and anything left open.
