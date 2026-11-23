# TASK-333 — DLR, Elizabeth line and DB intercity trains

Status: planned 2026-11-23 (owner: "must include 1 light rail variant (for DLR)", "2 train variant (elizabeth line
rolling stock multiple units, plus a normal DB power car + passenger carriages)"). Starts after TASK-332 merges.
Proposed owner: Codex (gpt-6.2-sol, high), or a Claude Code subagent if the lead wants to steer the look. Branch
`task/333-dlr-elizabeth-db`, worktree `D:\cityflows-wt\333`, ports 5533 / 5633.

## Lead decision (2026-11-23, after TASK-332)

TASK-332's rule gives London City's Elizabeth Line routes the DB intercity, because they run as `mainline` (no stops
inside the extract). Change the rule: in a left-hand-traffic city every route mostly on `rail` track gets the
Elizabeth-line EMU, stopping or not; `mainline` routes get the DB intercity only in right-hand-traffic cities. Update
TASK-332's city test pins accordingly (York's and London City's `mainline` routes become Elizabeth-line trains).
TASK-332 is merged; start from main.

## Goal

Add three variants to TASK-332's kit as data records, plus whatever small, general builder features they need. The
variant rule, levels of detail, performance budget and drawing-only decision are TASK-332's.

1. **DLR-style light metro** (routes mostly on `light_rail` track).
   - Body: two-section articulated units (B07-like) at the sim's car length, coupled. Narrower and lower than
     main-line stock.
   - Ends: no driver's cab windscreen; a plain end with a large window and lamps.
   - Doors and roof: two double doors per side per section; third-rail shoes on the bogies, no pantograph.
   - Colours: red, blue and white.
2. **Elizabeth-line-style EMU, Class 345-like** (routes mostly on `rail` in left-hand-traffic cities).
   - Body: long, smooth body with wide windows; cars drawn at the sim's 25 m.
   - Ends: a cab at each end of the train only, with a sloped nose and a large windscreen.
   - Doors and roof: three double doors per side per car; pantographs on two cars.
   - Colours: white body, purple doors and band, dark grey window band.
3. **DB intercity: BR 101-like locomotive, coaches and a cab car** (`mainline` kind, right-hand-traffic cities).
   - Train make-up: the locomotive at one end, coaches between, and a control car with a cab at the other end. Keep
     this push-pull order whichever way the train runs.
   - Locomotive: about 19 m long, drawn in the first 25 m car pose and centred. Two pantographs, roof equipment,
     two two-axle bogies (Bo'Bo'), cab at both ends.
   - Coaches: about 26 m, with a window per seat bay, single-leaf plug doors near the ends and closed gangways.
   - Colours: white with a red band (Intercity), the locomotive red.

## Scope

TASK-332's variant files and builder (small, general extensions only), tests, `docs/architecture.md`.

Out of scope: the sim, `src/schema`, the 2D layer, TASK-332's variant rule (change it only to stop the stand-in
fallback for these three), `bench/traffic-baseline.json`, any download or new dependency.

## Gates

- Tests:
  - The three records build within TASK-332's budgets.
  - London City's DLR and Elizabeth-line routes get their variants; York's routes get the Elizabeth-line variant;
    Munich's, Freiburg's and Lübeck's through routes get the DB train.
  - The DB locomotive and control car sit at opposite ends in both running directions.
- Screenshots, day and night: each variant close up; the DLR and the Elizabeth line together near London City
  (Custom House); a DB intercity passing Munich Donnersbergerbrücke. The lead forwards them to the owner as they land.
- 3D render p95 within noise of main at London City and Munich (TASK-332's method); draw calls and triangles
  reported.
- Sim state hashes identical; 2D identity hashes identical; `npm run check`, `test:city`, `test:traffic:light`,
  `test:e2e:light`.

## Report

Write it as the commit body.
