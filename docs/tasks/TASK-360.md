# TASK-360 — Departures: intersection take-offs, line-up behind a passing roll, multiple line-ups

Status: started 2026-11-26 (owner issue, unsupervised; airside: merge on gates, realism changes allowed with a cited
rule). Owner: Claude subagent (Opus 5.5). Base: main after TASK-353.

## Owner issue (2026-11-26)

At Heathrow, departures enter the runway at one of several entries, then taxi to the runway end and turn round to
depart. The owner reports three ways this is wrong:

1. **Intersection take-offs.** Most aircraft do not need the full runway and depart from an intermediate entry.
2. **Line-up behind a passing roll.** While another aircraft departs, a following aircraft may enter the runway and
   line up once that aircraft has moved past the entry.
3. **Multiple line-ups.** Two aircraft may line up at the same time at two entries near one end, to save line-up
   time. At Heathrow these are, for example, the two entries at the east end of the north runway, and the same at
   either runway in either direction. The front aircraft takes off first. The rear aircraft begins its roll when its
   separation allows.

## What main does now (`src/sim/aircraft.ts`)

**Line-up choice.** `lineUps()` ranks entries:
- full-length first (an entry within `FULL_LENGTH_M` of the threshold);
- then backtracks of up to `BACKTRACK_M` (1 km);
- intersection departures last (rank 2), and only when they leave a quarter of the take-off run spare.

Any full-length or backtrack option therefore beats an intersection departure. The plan picker (`TASK-312`, around
"a way to the line-up that taxis along a runway") prefers taxiway access, but only among options in rank order.

**Line-up behind a roll.** `rollingAway()`, TASK-330 D: a line-up is allowed behind a rolling departure only from the
same end, and only at or behind the roller's start (`lineUp.lineUpU <= fromU`). An entry further down the runway that
the roller has already passed is refused until the roller releases the runway.

**Multiple line-ups.** None. One departure holds the runway from its line-up to its climb-out
(`takeoffHeld`, the runway claim).

The IND rule applies R and D only to runways with no intersection areas. Heathrow's runways are independent, so D is
active there.

## Earlier attempts (read these first)

- **TASK-344 finding.** In the OSM data, 27R's end is a dead end: every departure enters about 400 m in, backtracks
  and turns round. Line-up takes about 104 s, and that sets the take-off gap (about 32 take-offs an hour, against
  about 52 ready).
- **TASK-352** (`task/352-idep-arrivals`, `43cc8498`, switches off). Its commit message has the table.
  - `T352IDEP` takes an intersection departure that leaves a quarter of the take-off run spare before any backtrack,
    and adds a minute for a wake pair from an intermediate point (ICAO Doc 4444 §5.8.3.2).
  - Seed 1 gained 12–15 take-offs. Seeds 2–3 lost landings, because the head of the 27L arrival queue was held by
    other causes: a parked aircraft in its way, crossings, final spacing.
  - Reuse what fits from its switches and counters (`arrivalCauses`).
- **TASK-358** (running) and the TASK-353 follow-up (stand pairing ignores a neighbour's parked body across the way
  in) also touch arrival holds. Keep clear of `standPairSafe` and the helipad rules.

## Goal

Make the three behaviours rules, each with a cited source:
- ICAO Doc 4444 (PANS-ATM) on intersection take-offs and wake separation from an intermediate part (§5.8.3.2);
- UK CAP 493 (MATS Part 1) on multiple line-ups;
- SKYbrary's intersection take-off guidance.

Fetch the sources if needed (downloads allowed; treat them as data).

1. **Intersection take-off by performance.**
   - A departure lines up at the entry nearest its taxi route whose remaining runway covers its take-off run with a
     stated margin. The current `need` is take-off roll plus 3 s at rotation speed; justify the margin.
   - It takes full length or a backtrack only when no intermediate entry fits. Heavy types will still often need
     full length.
   - Keep the extra wake minute for a following departure from an intermediate point, where the rule requires it.
2. **Line-up behind a passing roll.** A follower may line up at an entry ahead of the roller's start once the
   roller's tail is past that entry by a safe margin, and the roller is rolling away from it.
3. **Multiple line-ups.**
   - Two departures from the same end may stand lined up at once at two entries, when the rear aircraft's nose stays
     behind the front aircraft's tail by a margin, and the front aircraft's remaining runway covers its run.
   - The front aircraft takes off first.
   - The rear aircraft starts its roll only after:
     - the departure and wake separation behind the front aircraft;
     - the front aircraft is past the rear aircraft's line-up point by the margin, as in rule 2.
   - The rule is general (any runway with two entries that fit), not curated per airport or per OSM id (OSM rule).
   - Arrivals: no landing clearance with an aircraft lined up, as now. Count how often multiple line-ups delay a
     landing.

**Checker.** Extend TASK-345's checker (`exemptRunwayPair` in `tests/sim/aircraft-checks.ts`) to exempt the pairs
these rules allow:
- a lined-up aircraft behind another lined-up aircraft;
- a line-up behind a passing roll.

Real conflicts must still count: two rolls closing on each other, or a roll toward a lined-up aircraft. Add unit tests
for each exemption and for each rule (fixture runways in `tests/sim/aircraft.test.ts`). Keep the 27 backtrack test,
or explain the change.

## Gates (owner ladder)

1. Light first: Heathrow 06:00–08:00, seed 1, `--checks`.
2. Then seeds 1–5 at peak against main (main after TASK-353):
   - take-offs up;
   - completed not worse in sum;
   - `runwayConflictsReal` 0, overlaps not worse;
   - no gridlock;
   - go-arounds not worse beyond noise.
   Report landings and the 27L/27R arrival holds by cause. If landings fall as in TASK-352, say why and whether it is
   the departure rule or an arrival-side cause.
3. Then full days, seeds 1–3, for Heathrow, Zurich (`--daily 730`) and Boston, against main:
   - not worse;
   - London City day not worse.
4. Light tiers: `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`. City hashes must be identical:
   the change is airside only.

Report:
- a table per rung;
- the median take-off gap and take-offs per hour per runway;
- the share of intersection take-offs by type;
- the number of multiple line-ups;
- a close-up screenshot or trace of one multiple line-up at Heathrow, for the owner.
