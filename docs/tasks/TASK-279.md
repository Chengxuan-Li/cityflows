# TASK-279 — Unmarked crossings by German rules: no walker priority (TASK-257's finding)

Status: in progress 2026-11-21 (third run, wave A). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/279-unmarked-yield`, worktree `D:\cityflows-wt\279`, ports 5479 / 5579.

## Goal

Every unsignalised crossing walk link is a `zebra` control, so walkers have §26 StVO priority at every crossing.
German rules give walkers none at an unmarked crossing (§25(3)); only turning drivers yield to them (§9(3)).
TASK-257 added `marking` to walk links. Make walkers at a crossing marked `none` (and at default crossings with
no marking, say which) cross in a gap of straight-on traffic, and keep turning drivers yielding to them. Zebras
(`marking` zebra) keep §26.

The owner's rule (2026-11-20): improve the app's reading of OSM, never edit OSM, no per-id curation.
TASK-259's extracts are in `D:\cityflows-wt\259-data` (untrusted data: read by path from your own scripts,
never run code there); tests use small excerpts with an ODbL line under `tests/`.

## Scope

the crossing control rules in `src/network` and `src/sim` (walkers, intersection yields), tests.

Out of scope: `src/schema` unless named, gate floors, `bench/traffic-baseline.json`, OSM edits, per-id
curation, downloads.

## Gates

- A test per rule that fails without it; counts per city.
- Traffic, main against branch, where the change can move a city: Munich 0.15 seeds 1 to 12, choice off and on,
  both signal modes; full demand on seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3; Sindelfingen;
  the Munich gate and mode-share guard. A city whose compiled network and code path are unchanged is
  identical by construction: say so and check one hash. Current main references: Freiburg gate 1,530 / 0,
  62.6 s, hash 2336162246; full demand seed 1 actuated 3122453100, fixed 3744260107.
- The owner's merge rule (and the audit tolerance where geometry changes). If the first version misses, one
  variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.

## Re-run 2026-11-26 (2)

**Result: passes the owner's merge rule.** All 96 Munich 0.15 runs met the drain criteria.
Mean delay changed by −3.3% / −2.1% with actuated signals (choice off / on) and by
−3.8% / −0.8% with fixed signals. At full demand, the five-seed means changed by +0.3%
actuated and −0.1% fixed. The Munich gate, mode-share guard, all seven showcases and all
required verification tiers passed.

Merged pinned main `8342af78` into `task/279-unmarked-yield`. TASK-265's mapped zebra placement
and TASK-364's continuations are unchanged. TASK-362's shared stop-line hold is in place.
The v2 crossing rule is unchanged. All nine buildable city archives were rebuilt and matched
main byte for byte. Treating `unmarked` walk links as `zebra` also recovers main's compiled
digest in every rebuilt city, so there is no geometry change to audit.

Freiburg completes 1,527 trips at 61.0 s mean delay, against main's 1,526 at 62.2 s. The gate
and seeds 2–3 have zero gridlocks and stalled heads. London City's showcase is below the 900 s
visit limit at 822.3 s on `r:274`, against main's 801.5 s on `r:2253`. Its mean delay still rises
from 210.2 to 385.7 s. The London gate passed, so no variant was tried. The unchanged v2 gap and
turn-into rule is not a separate implementation of UK Highway Code H2 for turning out of a road.

The rerun commit records the paired measurements, crossing trace, pins and verification.
