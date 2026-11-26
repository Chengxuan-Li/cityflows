# TASK-352 — Heathrow intersection departures with the arrival side

Status: proposed 2026-11-25 (owner: "a new task is ok"). Owner: to be dispatched. Base: main (`75d6a7f5` or later,
the consolidated airside stack).

## Finding (TASK-344, 2026-11-25)

27R's end is a dead end in the OSM data. Every departure enters about 400 m in, backtracks along the runway and turns
round. Line-up takes about 104 s, and that, not the 75 s wake time, sets the take-off gap: about 32 take-offs an hour
against about 52 ready.

`T344IDEP` (`17b9e522`, off) prefers an intersection departure that leaves a quarter of the take-off run to spare, and
adds a minute for a wake pair from an intermediate point (ICAO Doc 4444 §5.8.3.2). Heathrow seed 1, 06:00–08:00:

| | Before | With `T344IDEP` |
|---|---|---|
| Median gap between take-offs | 112 s | 89 s |
| Take-offs (06:00–09:00) | 82 | 89 |
| Start wait | 1,018 s | 649 s |
| Taxi-out | 23.2 min | 15.7 min |
| Landings | 67 | 58 |
| Go-arounds | 0 | 5 |

The go-arounds were landing commitments refused because an arrival or tow still stood on the previous lander's exit.
Release holds for the first queued arrival also rose.

## Goal

Port `T344IDEP` to main as a rule, with the arrival side changed with it, so that both runways gain:
- arrival release when departures flow faster;
- tows standing on runway exits;
- the queued-arrival order.

Cite each rule.

## Gates

- Light first: Heathrow 06:00–08:00 seed 1, then seeds 1–5. Take-offs and landings up, completed up, go-arounds and
  overlaps not worse than main, no gridlock.
- Then full days for Heathrow, Zurich and Boston, seeds 1–3, against main.
- The 27 backtrack test kept or explained.
- Light tiers.
