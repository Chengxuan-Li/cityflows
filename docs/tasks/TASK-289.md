# TASK-289 — York's lot deadlock: a car at the entry and cars inside waiting on each other (TASK-288's v1)

Status: in progress 2026-11-21 (owner's go). Proposed owner: Claude Code subagent (Opus 5.5, high). Branch
`task/289-lot-deadlock`, worktree `D:\cityflows-wt\289`, ports 5489 / 5589.

## Goal

TASK-288's first version (`edf4099`, York archive in that commit) failed York's showcase gate on seeds 1 and 2:
7 and 6 trips gridlocked, worst visit 5,869 s on George Street (`r:704`). The cause is a deadlock at the 17-space
public lot `pk:4462`: a car waits at the entry from 08:21 to 10:00 while two cars inside wait to leave. Main's
population does not hit it, but the rule that lets it happen is still in `src/sim`. Reproduce it on `edf4099`'s York
archive (read that file from git, do not change main's archives), find the rule in the lot entry, exit and mouth
logic that lets the waits close into a cycle, and change it in general code so the cycle cannot form (or is broken
the way a real lot would break it: the entering car clears the mouth, or the leaving cars go first). Add a test with
a small synthetic lot that deadlocks without the change.

## Scope

`src/sim/parking.ts` and the lot mouth and connector rules it uses, tests, a bench script for the reproduction.

Out of scope: `src/schema`, `src/demand`, importer and archive changes, gate floors,
`bench/traffic-baseline.json`.

## Gates

- The synthetic test fails without the change; `edf4099`'s York seeds 1 and 2 pass the showcase gate with it.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes; full demand on
  seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3; Sindelfingen; every bundled city's showcase gate; the
  Munich gate and the mode-share guard. Identical state hashes where no lot cycle forms are the expected result;
  say where they differ and why.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
