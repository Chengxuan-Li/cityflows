# TASK-383 — Heathrow day 3: the last tail stop on the runway

Status: started 2026-11-27 (lead, 10 h unsupervised run; airside merges on gates). Owner: Codex (gpt-6.2-sol, high).
Base: main `007c2d02` (TASK-377 on).

## Finding (TASK-377)

TASK-377's exit margin (on by default) cleared the tail stops on Heathrow peak seed 5 and day 1. On Heathrow full day
seed 3, one landed aircraft still stands 26 s with its tail before the vacating point (`arrivalCauses.tailOnRunway`).
TASK-377 did not trace it.

## Goal

1. Trace the day-3 stop: who stops, where, what claim holds it, and why the TASK-377 margin does not apply. Example
   causes: the leader is moving rather than standing; the holder is a departure or a crossing aircraft rather than an
   arrival on the same way off; a tug or tow.
2. Extend the rule to cover it (ICAO Doc 4444 §7.10), without adding runway crossings or changing exits. Keep the
   change behind a switch while measuring; one variant allowed.

## Scope

`src/sim/aircraft.ts`, `bench/airside-delay.ts`, tests.

## Gates

TASK-376's ladder:
- Heathrow peak seed 1 `--checks`;
- peaks 1–5 (689, go-arounds 18): completed not lower, go-arounds not higher;
- full days not worse: Heathrow 1–3, Zurich `--daily 730` 1–3, Boston 1–3, London City day 1. Re-run main for every
  day reference, since TASK-377 changed main.
- Tail stops 0 on every run.
- Munich and Freiburg hashes identical;
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
