# TASK-386 — TASK-215's lane markings without the doubled-crossing rule, and solid lines before signals (M7)

Status: started 2026-11-28. Started by the lead in the 9 h autonomous run (owner 2026-11-28: "Take all suggestions"). Owner: Claude subagent (Opus 5.5). Base: main; carries
`archive/task/215-markings` (`3e5e33f7`).

## Finding (TASK-215)

TASK-215's M1 to M6 fix marking defects (arrows through groups, lane lines in short inner lanes, default crossings on
trunk roads, doubled crossings, stepped crossing bands, stop lines in pieces). Its cost, Munich mean delay +4.0%
actuated and +5.3% fixed, sits in M4's doubled-crossing rule (crossings less than 7.5 m apart on one road keep one),
which moves walk links; without it fixed was 125.2 s against 124.8 s.

## Goal

The owner accepted (2026-11-28):
1. TASK-215 without M4's doubled-crossing rule (M4's keep-clear and arrow clearances stay if they do not move walk
   links).
2. M7: solid lane lines, not dashes, on the approach to a signal stop line (German practice, RMS-1 /
   StVO Anlage 2 Zeichen 295 as a Fahrstreifenbegrenzung; the solid length is the lead's default 30 m on urban roads
   unless the data says otherwise; cite the source by name and section).
3. Bring it onto current main, rebuild Freiburg and the other bundled cities as the importer change needs, re-pin.

## Scope

`src/render/road-paint.ts`, `marking-geometry.ts`, `render3d/markings.ts`, `crossings.ts` defaults, and what
TASK-215 touched (`walk.ts`, `inspector/node.tsx`), tests and re-pins, bundled-city rebuilds. Out of scope: OSM
edits, per-id curation, gate floors, `bench/traffic-baseline.json`.

## Gates

- Traffic merge rule against main (Munich within 3% on 12 seeds and four configurations as in TASK-215, full demand
  within 2% on the mean of seeds 1–5, Freiburg within 5 s, drain, every showcase passes).
- TASK-215's marking counts before and after (M1 to M7), the geometry audit within tolerance.
- Close-up screenshots (2D and 3D) of a group entry, a signal approach with M7 and a crossing pair, in the app.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
