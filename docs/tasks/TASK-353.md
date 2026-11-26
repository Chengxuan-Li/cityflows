# TASK-353 — Tow-backs at the start of a run are not held

Status: proposed 2026-11-25 (owner: "yes a new task to fix"). Owner: to be dispatched. Base: main.

## Finding (TASK-344, 2026-11-25)

At Heathrow seed 1, 06:00–08:00, about 46% of departures' readiness wait (58,800 of 128,700 s) comes from aircraft
already on the ground at the run's start. They are parked overnight at remote stands, and their tow back to the
departure stand is held at the start, for up to 2.4 h for some flights. The rest is late inbound flights.

## Goal

Aircraft parked away at the run's start are towed back in time for their departures, as the overnight plan intends.
- Find why the tow-backs are held at the start (`flight-operations.ts`, the tow request timing and its admission).
- Fix it with a general rule.

The owner accepts that this changes every light-run baseline.

## Gates

- Heathrow 06:00–08:00 seeds 1–5: readiness wait from start-of-run aircraft down, completed up or level, no new
  overlaps or gridlock.
- London City, Zurich and Boston light runs not worse.
- Full days for the three large airports, seeds 1–3, against main.
- Light tiers.
