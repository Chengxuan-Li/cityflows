# TASK-356 — A vehicle tug for tow-aways right after parking

Status: started 2026-11-26 (owner defaults). Owner: Claude subagent (Opus 5.5). Base: main.

## Finding (TASK-350, 2026-11-25)

With ground vehicles on, London City still has 12–18 pushes a day without a vehicle tug: 18, 12 and 12 for seeds 1–3,
and 13 at Zurich. These are:
- tow-aways that start 5–10 s after an aircraft parks;
- each run's first departures.

The sim pushes back from every stand. These pushes still happen on time, only without a tug vehicle drawn. A tug
cannot reach the stand in time because flight operations give no notice before the tow.

Not in scope: whether some London City stands are self-manoeuvring (power-out). The owner raised it; no current
source settles it.

## Goal

- Flight operations announce a planned tow-away when the arrival is released or lands, ahead of the parking, so a tug
  can wait near the stand.
- For the first departures of a run, the tug is placed at its stand at the start.
- Aircraft timing must not change.

## Gates

- London City seeds 1–3 and Zurich seed 1, full days with `--vehicles --checks`:
  - aircraft results identical to main with `--roads --checks`;
  - 0 vehicle overlaps;
  - pushes without a tug down toward 0.
- Served share not lower.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
