# TASK-113 — Mode choice: walk, drive, or drive and walk, per trip

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch
`task/113-mode-choice`, worktree `D:\cityflows-wt\113`, ports 5313 (production 5413). It starts in
batch 3, once TASK-129 (household car ownership) is on main.

## Goal (Gate 9, item 4, in `docs/plan.md`)

Each person trip chooses a mode at departure: walk, drive, or drive part of the way and walk the
rest (the drive-and-walk trip TASK-112 already runs). The choice is a logit model over:
- walk time;
- drive time from current link costs;
- parking search and walk egress time;
- distance;
- whether the household has a free car, and where it is (TASK-129);
- per-person preferences sampled from the demand seed: a walk preference and a value of time.

The demand sheet gets sliders for the model's parameters. The metrics show mode shares, in
total and by hour.

## Rules

- A person with no free household car can't drive. TASK-129's borrowing and its chained car trips
  stay as they are. A trip chain stays consistent: a person who walked out does not drive home in a
  car that is still parked at home.
- Through and event traffic from gateways stays vehicles without persons, with no choice.
- TASK-128's station riders are not on main. Don't add trains as a mode. Leave a clear place for a
  future transit option in the model's alternatives.
- Determinism. The choice draws from its own seeded stream, so changing a slider changes no other
  draw. Synthetic cities whose trips can't walk (no walk network) give main's trips exactly.
- Performance: the choice cost per departure is bounded. Reuse existing route and walk costs where
  possible. Report the step-time and load cost on Munich.

## Calibration

Choose the default parameters so that Munich's default scenario gives a plausible split for an
inner-city district at 0.15: walking dominates trips under about 1 km, and driving dominates
beyond about 3 km. Report the default mode shares and the distance profile of each mode.

## Traffic gate

The owner keeps the current gate (seed-1 Munich: at least 3,702 completed vehicle trips, at most
39 gridlocked, 0 stalled heads; T63 at least 3,571). Mode choice changes vehicle-trip counts by
design. Rule 7 of the 2026-11-07 decisions resets the baseline at such merges, but the owner's
current instruction keeps the gate fixed.

So measure two settings:
1. The default scenario with mode choice on.
2. Mode choice off, meaning everyone with a car drives as on main. Expose this as a demand toggle.

Setting 2 must pass the gate unchanged. If setting 1 fails the gate only because fewer people
drive, say so with numbers: vehicle trips, person trips completed, mode shares and gridlock. The
lead takes the decision to the owner. Don't lower floors or edit `bench/traffic-baseline.json`.

## In scope

- `src/demand/**`: the choice model, preferences, households and car availability, and the demand
  sheet sliders in `src/ui`.
- `src/schema` demand fields, with optional and defaulted parameters, and their schema round
  trips.
- `src/sim/persons.ts` only where the choice runs at departure.
- Metrics and exports for mode shares.
- `docs/architecture.md`, the demand sections.

## Out of scope

- Parking rules (`src/sim/parking.ts`, owned by TASK-153 in the same batch).
- Crossings and rail (PR #1).
- The importer and the renderer, apart from mode-coloured person markers if they're cheap.
- Gate floors.

## Gates

1. Unit tests for the model:
   - the logit probabilities;
   - no car means no drive;
   - chain consistency;
   - deterministic and independent of the slider streams.
2. A Munich census: mode shares by distance band and by hour, and person trips completed by mode.
3. The traffic gate in both settings, as above. Report seeds 2 and 3 as diagnostics.
4. `npm run check`, `test:city`, and `test:e2e:light` on port 5313, plus an e2e step that moves a
   slider and sees the mode shares change after a restart.
5. Shots: the demand sheet with its sliders, and the metrics panel with mode shares.

## Report

Write it as the commit body: the model and its defaults, the census, both gate settings, the
performance cost, hashes moved and why, files touched, and anything left open.
