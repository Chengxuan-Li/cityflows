# TASK-362 — A stop line under two actuated controls never gets both greens

Status: started 2026-11-26 (owner defaults; bounded, Codex). Owner: Codex (gpt-6.2-sol, high). Base: main.

## Finding (TASK-279 re-run, 2026-11-26)

Branch `task/279-unmarked-yield` `0145e94a`, Freiburg gate: 19 vehicles gridlock from 07:50.

The first car on `r:1348` stands at a stop line shared by the `n:18` signal and a tram crossing. The tram crossing
holds it for `n:39`'s red. `n:18` gives it green, but the tram crossing then holds it. The two actuated controls
alternate, so the car never gets both at once.

TASK-222 (merged 2026-11-19) fixed a lock between the same controls. It keeps a green only when cars wait on each
other, so it does not cover this case.

TASK-279 shows the lock is in main's signal logic, not in its own rule. Reading every unmarked crossing as a zebra
gives main's hash exactly, and holding waiting walkers back still gives 19 gridlocked. TASK-279 only shifts the
timing into it.

## Goal

A general rule in the actuated control (`src/sim/signals.ts`, and the rail-crossing calls TASK-222 touched): a head
held at a stop line by two controls is served.

Possible rules:
- the controller that turns green second keeps its green, or extends it, while the head still waits on the first
  one;
- the two calls are coordinated so both greens overlap for at least the head's start-up time;
- a bounded wait after which the second control serves the waiting head.

Cite the rule. Signal-coordination practice, for example the German RiLSA, or MUTCD 8C/4D on pre-emption near
grade crossings, would do.

## Scope

`src/sim/signals.ts` and the actuated-control code TASK-222 changed, their tests, and re-pins.

## Out of scope

The crossings importer (`src/network/crossings.ts`), `src/sim/aircraft.ts`, `src/schema`.

## Gates

- A repro test that fails without the rule. Build it from the TASK-279 branch state, or from a minimal fixture with
  one stop line under a signal and a tram crossing tied to a second actuated signal.
- On TASK-279's branch, Freiburg's gate no longer gridlocks. Merge the fix into a scratch copy; do not commit there.
- On main, the owner's merge rule:
  - Munich 0.15, seed 1, all four configurations (choice off/on × fixed/actuated). If not identical, seeds 1–5.
  - Full demand, mean of seeds 1–5, if Munich changes: within 2%.
  - Freiburg gate within 5 s of main, with no gridlock or stalled heads.
  - All panel showcase gates pass.
- `npm run check`, `npm run test:city`, `npm run test:traffic:light`, `npm run test:e2e:light`.

## Result

**Pass.** Implementation `b099f2d6` on `task/362-two-controls`, based on `origin/main`
`593f15ae`. Not merged or pushed.

### Coordination rule and reproduction

At Freiburg, the head on `r:1348#0` reached the shared stop line at 07:50:56.5. The group
containing `n:39` started switching toward the required green at 07:51:16.8. The `n:18`
green ended at 07:51:20.3, half a second before the downstream green started. There was
no reciprocal call by then, so TASK-222 did not keep the near green.

When the crossing and near signal share a stop line, a stopped lane head held by another
actuated controller can keep the near green through the downstream change and for the
existing 3 s passage time. If the head has stopped for a full local cycle and the change
has not started, the hold can extend the normal green by at most one programmed
downstream cycle while waiting for the change. A TASK-222 reciprocal call still uses its
existing rule. This changes neither rail admission nor fixed-time control. The simulator
rule draws on the guidance to time neighboring signals together and allow for vehicle
start-up at crossings, not on a prescribed 3 s interval. [FHWA MUTCD, 11th ed. Rev. 1,
§8D.11 ¶¶04, 08–10](https://mutcd.fhwa.dot.gov/pdfs/11th_Editionr1/part8r1.pdf#page=42)

The T75 regression uses a real tram-crossing hold and two actuated signals 10 m apart.
The near and far greens otherwise alternate as the far max-out leads by 0.5 s, ties, or trails by
0.5 s. All three one-sided cases fail without the new rule. With it, the head gets 3 s
of continuous usable green and the near controller returns to opposing demand. The
existing TASK-222 mutual-wait test also passes.

### Freiburg on TASK-279

Same seed-1 showcase demand and same gate driver in the scratch worktree at `0145e94a`.

| Tree | Completed | Gridlocked | Stalled heads | Mean delay | State hash |
| --- | ---: | ---: | ---: | ---: | ---: |
| TASK-279 before | 1,482 | 19 | 0 | 59.72 s | 3906630995 |
| TASK-279 + TASK-362 | 1,532 | 0 | 0 | 60.68 s | 1953721968 |

No commit on the scratch worktree. Its junction was removed before removing the worktree.

### Owner's merge rule vs main

Munich at 0.15, seed 1. Both trees produced identical seed-report output in all four cases.

| Signals | Mode choice | Main delay | Task delay | Completed | Gridlocked | State hash | Drain |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Actuated | Off | 602.33 s | 602.33 s | 5,311 | 1 | 1040881020 | Pass |
| Actuated | On | 96.11 s | 96.11 s | 2,567 | 0 | 905846996 | Pass |
| Fixed | Off | 828.52 s | 828.52 s | 5,301 | 0 | 1000561560 | Pass |
| Fixed | On | 128.96 s | 128.96 s | 2,545 | 0 | 4281278361 | Pass |

The one actuated/choice-off gridlock was already present on main. Stalled heads were zero
on every run. Seeds 2–5 and full demand were not triggered because all four hashes and
drain results were identical.

| Gate | Main | TASK-362 | Result |
| --- | --- | --- | --- |
| Freiburg | 1,528 completed, 62.48 s, hash 1766099943 | Identical | Pass, 0.00 s delta, zero gridlock or stalled heads |
| Munich showcase | Pass, 96.11 s, hash 905846996 | Identical | Pass |
| Sindelfingen | Pass, 17.17 s, hash 3554708898 | Identical | Pass |
| Philadelphia | Pass, 167.60 s, hash 1607936079 | Identical | Pass |
| Lübeck | Pass, 126.18 s, hash 1323686958 | Identical | Pass |
| York | Pass, 86.74 s, hash 3568133015 | Identical | Pass |
| London City Airport | Pass, 210.15 s, hash 272003577 | Identical | Pass |
| Zurich Airport | Pass, 114.92 s, hash 817699485 | Identical | Pass |

No re-pins. The existing gate results and pinned hashes were unchanged. The historic TASK-279 failure hash is reported for comparison, not re-pinned.

### Verification

- Focused T75 regression — `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- `npm run check` — typecheck, lint and format passed. `Test Files 304 passed | 1 skipped (305)`,
  `Tests 2180 passed | 3 skipped (2183)`, `built in 2.44s`, exit 0.
- `npm run test:city -- --reporter verbose` — `Test Files 77 passed (77)`,
  `Tests 290 passed | 1 skipped (291)`, exit 0.
- `npm run test:traffic:light` — `Test Files 2 passed (2)`,
  `Tests 5 passed | 1 expected fail (6)`, exit 0.
- `npm run test:e2e:light` — `63 passed (5.7m)`, exit 0. Configured ports 5392/5393.

Logs and drivers are in `D:\cityflows-wt\330-pilot\R\t362`.
