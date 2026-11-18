# TASK-200 — Engine queries racing a project open (gate4-compare fails alone)

Status: in progress (owner started it 2026-11-18). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/200-open-race`, worktree `D:\cityflows-wt\200`, ports 5396 / 5496.

## Goal

`tests/e2e/gate4-compare.spec.ts` fails every time it runs on its own, on main since TASK-198
(lead reproduced it on 7cc1a47 and on the TASK-199 branch): `page.evaluate(window.cityflows.metrics())`
at line 54 rejects with "Traffic worker terminated" right after the spec opens a project file. It
passes inside the full light suite and on CI, where the retry hides it. Find the cause, fix it in
the app (not by retrying in the spec), and make the spec pass on its own every time.

The lead's first suspect, not verified: while `open` loads the new project, `window.cityflows`
(`src/main.tsx`) still resolves `session.engine` to the old grid engine; when the load finishes,
`src/ui/store.ts` terminates that engine (`get().session?.engine.terminate()`), and
`src/host/client.ts` `close()` rejects its pending requests. Say why TASK-198 exposed it (its
faster, staged open, `?city=` start, or something else), and whether the app's own callers (the run
loop, inspectors, metrics panel, comparison) can hit the same rejection when a project opens during
a run or right after the landing city; fix those too if so, as no user-visible error.

A fix might make test-hook queries wait for an open in progress and then ask the new engine, or let
the old engine's pending replies settle before it is terminated; choose the smallest that is right
for real callers, and say why.

## Scope

`src/main.tsx` (the test hook), `src/ui/store.ts` (open and the engine hand-over),
`src/host/client.ts`, and tests: a unit or host test that reproduces the rejection without the fix,
and the e2e spec only if a wait it relies on is itself wrong.

Out of scope: simulation results (no hash or traffic number may move), `src/schema`, gate floors,
`bench/traffic-baseline.json`, the bundled projects, Freiburg's load budget (first frame stays
within TASK-198's 3 s; report the measured number).

## Gates

- `npx playwright test tests/e2e/gate4-compare.spec.ts` passes 10 runs out of 10 on its own
  (`--repeat-each 10`, workers 1), and fails on main the same way before the fix.
- The new test fails without the fix.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`; no new `pageerror` or console
  error in the light suite.

## Report

Write it as the commit body of the last commit: cause, why TASK-198 exposed it, the fix, which real
callers were affected, the repeat counts before and after, and the first-frame time.
