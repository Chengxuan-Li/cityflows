# TASK-379 — Boston Logan landside: 53 gridlocks in the morning probe

Status: started 2026-11-27 (lead, 10 h unsupervised run; city work merges under the traffic merge rule and the audit
tolerance). Owner: Codex (gpt-6.2-sol, high). Base: main `2fca81f1`.

## Finding (TASK-372, TASK-374)

Boston Logan is held out of the showcase panel. With TASK-374's crash fix, its morning probe (seed 1, demand 0.15,
07:00–10:00, landside and airside) runs to 10:00: 5,342 trips completed, mean delay 1,755.9 s, worst visit 3,503.3 s on
`r:458`, **53 gridlocked trips**. The landside-only probe gives the same counts, so the airport is not the cause.

## Goal

1. Find the gridlocks: for each, the cycle of vehicles and lanes (or the deadlock pattern), the place (roads, nodes,
   terminal kerbs, garage ramps, the Ted Williams / Sumner tunnels, the airport loop), and the rule that let it form.
   Group them by pattern and table the groups with counts.
2. Fix the largest pattern by an app rule that holds for every city (OSM rule: no per-id curation, no OSM edits).
   At most two variants.
3. Report the Boston probe after the fix. Bringing Boston into the panel is not required.

## Scope

`src/sim/**` where the cause lies, `src/network/**` if a compiled-network rule is the cause, tests, re-pins.

Out of scope: gate floors, `bench/traffic-baseline.json`, OSM edits, per-id curation, the showcase panel.

## Gates

- The owner's merge rule: Munich 0.15 seeds 1–12, four configurations, within 3%; full demand within 2% on the mean of
  seeds 1–5, both modes; Freiburg within 5 s; drain; Sindelfingen; all showcases pass.
- If the compiled network changes: the geometry audit within tolerance.
- Airside identical (Heathrow peak seed 1, Boston day seed 1) unless explained.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.