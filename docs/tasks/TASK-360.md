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

## Result (2026-11-26)

**Rules** (`src/sim/aircraft.ts`; all three on by default, the env `T360=<i|r|m letters>` picks them for the ladder,
`T360=` is the line-up choice before them).

1. **Intersection take-off by performance** (`lineUps`, `departurePlan`). Full-length entries and intersection
   entries whose remaining runway covers the take-off run with 15 % to spare are one choice, made before any
   backtrack. The run (`need`, roll plus 3 s at rotation speed) is about the distance to 35 ft; certification's
   all-engines take-off distance is 115 % of it (CS-25.113(a)(2), 14 CFR 25.113(a)(2)), and the declared distance from
   an intermediate holding position must cover it (ICAO Doc 7030, 6.5.4: intersection take-off criteria shall be
   complied with). Of those, the departure takes the entry nearest its taxi route (route cost without the runway arc it
   lines up on) plus 300 m for each other departure planned to that entry and not lined up yet (the controller names
   the intermediate holding position in the line-up instruction: CAP 493, Section 2, Chapter 1, 14.2). An entry whose
   hold leaves the holding body in the way of the widest type rolling on the centreline is not used (Heathrow 27R's
   A5, drawn 16 degrees off the runway: an A380 at its fallback hold stood 29 m from the centreline). A follower with a
   wake interval behind a leader that started its roll more than 150 m behind its own line-up keeps a minute more
   (ICAO Doc 4444, 5.8.3.2: 3 instead of 2 minutes from an intermediate part of the same runway; ported from TASK-352).
   SKYbrary's intersection take-off pages (intersections used to make the most of runway capacity) refused automated
   fetches; the TASK-352 citation stands.
2. **Line-up behind a passing roll** (`rollingAway`). On a runway that crosses no other (the IND rule), a departure may
   line up at an entry ahead of a rolling departure's start once that one's tail is `margin` (half the widest span +
   12 m) past the nose of the line-up and its entry, rolling away from it (CAP 493, Section 2, Chapter 1, 13.3 and 14:
   conditional line-up behind departing traffic).
3. **Multiple line-ups** (`linedUpAhead`, `takeoffHeld`). On such a runway a departure may line up while another stands
   lined up (or is lining up) ahead of it from the same end, its nose 200 m behind that one's tail (CAP 493, Section 2,
   Chapter 1, 14.1: line-up instructions may be issued to more than one aircraft at different points on the same
   runway; ICAO Doc 7030, 6.5.4 (Asia/Pacific text, ATM/SG/6 Appendix H): wake separation is applied). 200 m is our
   choice: CAP 493, 10F asks for particular care with preceding departures' jet blast in multiple line-ups and sets no
   distance. The front one takes off first; the rear one rolls once the front one is off the runway (CAP 493, 15.5:
   not before the preceding departure is airborne) and its departure and wake gap has run. A grant checks every
   aircraft holding the runway, not only the last to claim it, and the rear one's booking counts its wait behind the
   front one, so arrivals' windows see its real occupancy. No landing clearance with an aircraft lined up, as before
   (CAP 493, 13.1).

**Checker.** `exemptRunwayPair` also exempts two aircraft lined up for the same runway end with the rear one's centre
at least half their lengths behind the front one along its heading. A line-up behind a passing roll was already exempt
(a line-up behind a roll rolling away, wherever it started). Two rolls, a roll toward a lined-up aircraft, and two
lined-up aircraft for opposite ends still count (`tests/sim/runway-exemptions.test.ts`). Fixture tests
(`tests/sim/aircraft.test.ts`): rule 1 (an E190 enters at x = 300 with 1.8 km ahead; a B77W backtracks), rule 2 (a PC24
lines up at x = -300 while the E190 that started at x = 300 rolls past), rule 3 (an E175 lines up at x = 300 behind the
lined-up PC24; the PC24 rolls first, the E175 75 s or more later), and the same three departures with the rules off.
The 27 backtrack test (kept as it was) and six other tests that test something else on the pre-rule line-up choice (closed holds,
crossing holds, the pavement gate, an editor re-route) run with `withRules('')`; one test's stop condition now waits
for all three arrivals to park; the synthetic airport's parallel layout asserts no backtrack instead of the 27 end.
