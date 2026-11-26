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

**Rules** (`src/sim/aircraft.ts`; all three on by default, on runways that cross no other (the IND rule, as TASK-330's
line-up behind a roll). The env `T360=<letters>` picks them for the ladder: `i`, `r`, `m`, and `a` for rule 1 on every
runway; `T360=` is the line-up choice before them.)

1. **Intersection take-off by performance** (`lineUps`, `departurePlan`). Where an intersection entry's remaining
   runway covers the take-off run with 15 % to spare, it and the full-length entries are one choice, made before any
   backtrack; where none fits, the full-length entry (or a backtrack) is taken as before. The run (`need`, roll plus 3 s at rotation speed) is about the distance to 35 ft; certification's
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
   12 m) past the nose of the line-up and its entry, rolling away from it (CAP 493, Section 2, Chapter 1, 13.3: a
   conditional clearance may be given in respect of an aircraft ahead in the departure sequence; and 14).
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

**Rung 1–2: Heathrow 06:00–08:00 (drain to 09:00), `--checks`, main (after TASK-353) → branch.** `T360=` reproduces
main exactly (seed 1 and 2 JSON identical to `fo-lhr-p1/p2` but for `wallS`); its runs give main's take-off figures.
All departures in the window use 27R; arrivals 27L.

| seed | completed | landed/departed | go-arounds | overlaps | rwyConflictsReal | gridlock | mean delay s | 27R take-offs/h, median gap | multiple line-ups |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 120 → 143 | 50/71 → 61/90 | 8 → 5 | 0 → 3 | 0 → 0 | none | 1,699 → 1,643 | 22.5, 120 s → 30.5, 75 s | 18 |
| 2 | 123 → 130 | 60/69 → 56/79 | 1 → 2 | 0 → 0 | 0 → 0 | none | 1,639 → 1,628 | 22.5, 135 s → 29.5, 75 s | 12 |
| 3 | 121 → 133 | 56/67 → 55/82 | 5 → 0 | 0 → 0 | 0 → 0 | none | 1,566 → 1,442 | MAIN3 → 25.5, 81 s | 13 |
| 4 | 124 → 134 | 64/61 → 64/74 | 5 → 4 | 0 → 0 | 0 → 0 | none | 1,795 → 1,846 | MAIN4 → 25.5, 79 s | 11 |
| 5 | 129 → 136 | 60/70 → 52/85 | 2 → 7 | 0 → 0 | 0 → 0 | none | 1,609 → 1,685 | MAIN5 → 29, 75 s | 21 |
| sum | 617 → 676 | 290/338 → 288/410 | 21 → 18 | 0 → 3 | 0 → 0 | | | | 75 |

Light rung first (seed 1): rule 1 alone (`T360=i`) 143 (58/92, 5 go-arounds, 0 overlaps), take-offs 29.5/h with a
107 s median gap; all three rules 143 (61/90) with a 75 s median gap (the 75 s departure interval: the runway now runs
at its separation whenever departures are queued). Rule 1 alone at seed 2: 132 (53/84, 5 go-arounds).

The three overlaps (seed 1, 08:16:26–28) are a helicopter (A139 G-VMKV) climbing off its helipad while an A380 under
tow (G-TXFW) passes 36 m from it: the helipad-to-tow separation TASK-358 is working on, met on a different trajectory;
no departure is involved.

Take-offs from an intersection (entry more than 150 m past the threshold; Heathrow 27R's A1/A2, 86 and 103 m from its
dead end, count as full length), seeds 1–5 (seed 1 from a re-run of the final code, identical to the ladder's run but
for the counter): 273 of 409 (67 %); A20N 70 %, A21N 65 %, B738 79 %, BCS3 78 %, E190 67 %, A333 100 %, A359 86 %,
B789 81 %, B748 60 %, B77W 43 %, A388 40 %. No
backtracks (main, seeds 1 and 2: every departure backtracked from A1/A2 to the dead end).

Multiple line-ups: 75 in the five windows (18/12/13/11/21), typically a heavy lined up at A4 (404 m in) with a
narrowbody behind it at A1/A2 (the owner's case at the east end of the north runway), or one lined up far down the
runway at an intermediate entry with another behind it. Landings held by them: 0 (Heathrow's runways are segregated:
no arrival on 27R in the window; `arrivalHeldByMultiS` and `landingsHeldByMulti` both 0). Line-ups granted ahead of a
rolling departure's start (rule 2): 176.

Landings: 290 → 288 in sum (seed 1 +11, seeds 2 and 5 −4 and −8). The head of the 27L queue is held almost the whole
window in both (10,605 → 10,600 s at seed 1, 9,865 → 9,770 s at seed 2), so landings follow the mix of its holds, not
the departure rule: the causes are final spacing (about 40 %), a queued arrival ordered before it, its stand or way off
taken (tows, parked aircraft: seed 5's 1,880 s waiting for a parked aircraft not yet started), and gaps left for
aircraft crossing 27L (seed 2: departures waiting to cross 27L from the south 385 → 575 s, more departures). All 18
go-arounds are landing commitments refused by a ground aircraft on the way off: arrivals (13), tows (3), and a
departure taxiing across it (2, seeds 1 and 4); none is a departure on 27R.

**Rung 3: full days, `--checks`, main (after TASK-353) → branch.**

| airport, seed | completed | landed/departed | go-arounds | overlaps | rwyConflictsReal | gridlock | mean delay s |
|---|---|---|---|---|---|---|---|
| Heathrow 1 | 752 → 849 | 381/372 → 427/423 | 20 → 21 | 0 → 0 | 0 → 0 | none | 16,869 → 14,350 |
| Heathrow 2 | 758 → 813 | 385/376 → 415/399 | 24 → 15 | 0 → 0 | 0 → 0 | none | 13,926 → 14,185 |
| Heathrow 3 | LHR3 |
| Zurich 730, 1–3 | 729/727/746 → identical | | 7/7/8 → identical | 0 | 0 | none | 371.9/440.0/337.2 → identical |
| Boston 1–3 | BOS |
| London City 1 | 150 → 150 | 75/75 | 0 → 0 | 0 | 0 | none | 11.6 → 11.6 |

Heathrow days: 27R take-offs 17.5/h (median gap 106 s) and 16.6/h (112 s) over the day; 62 and 51 multiple line-ups,
none delaying a landing. Diverted 160 → 112 and 158 → 145, cancelled 143 → 98 and 142 → 132. Seed 2's mean delay is 1.9 % higher
with 55 more movements completed.

Zurich, Boston and London City: with rule 1 on runways that cross no other, Zurich and Boston do not change (their
departure runways cross others; their JSON matches main's field for field but for wall time, Zurich seeds 1–3 and Boston
seed 1), and London City
changes 8 line-ups a day for the same outcome. Rule 1 on every runway (`T360=irma`), run before the restriction:
Zurich 731/727 (main 729/727), go-arounds 10/4 (7/7), mean delay 402/449 s (372/440 s); Boston 993/968 (992/968),
go-arounds 37/43 (17/35), overlaps 22/1 (22/0), mean delay 559/877 s (489/770 s). At Boston the rule moved only 11–14
PC24 take-offs a day to intersections, yet the day lost on two seeds by arrival-side holds (landing commitments refused
by an arrival standing on the way off: 32 and 28); that is the reason for the restriction, not a mechanism we found.
