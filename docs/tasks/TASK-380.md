# TASK-380 — Heathrow: two-way stand pairing that covers tows, with a fallback

Status: started 2026-11-27 (lead, 10 h unsupervised run; airside merges on gates). Owner: Claude subagent (Opus 5.5,
continuing TASK-376). Base: branch `task/376-stand-access` at `b00f03e3`.

## Finding (TASK-376)

Stepped-out waits over 300 s on Heathrow main are 77% A380s bound for code F remote stand `st:31169`, blocked by a B77W
parked at TE3 or `st:31168` (A380 half-span plus B77W half-length 76.9 m against 74 m to the taxiway). Stand allocation
checks parked bodies and pushback paths only. TASK-376's way-in allocation (`T376=a`) gave G-OOQV another stand on peak
seed 1, but the conflict moved: a tow of another A380 went to `st:31169` past TE3 instead, and from 07:58 the 27L
arrival queue head (a B77W bound for TE3) was held; landings 08:00–08:30 fell from 11 to 0. Peaks 689 → 678 (`ah` 683).

## Goal

A two-way pairing rule: a stand is not assigned (to an arrival or a tow) if its occupant would stand across the way in
of an aircraft already assigned to, or on its way to, a stand it blocks; nor if a parked aircraft stands across its own
way in. Tows count as arrivals. When every compatible stand is blocked, keep today's behaviour (fallback), so a block
never becomes a diversion or a held runway exit. Cite the rule (ICAO Annex 14 Vol I 3.13.6; Heathrow ASGrOps_OSI_047
§3.2.6). Behind a switch while measuring; one variant allowed after the first.

## Scope

As TASK-376: `src/sim/aircraft.ts`, `src/sim/flight-operations.ts`, `bench/airside-delay.ts`, tests.

## Gates

TASK-376's ladder: Heathrow peak seed 1 `--checks`; peaks 1–5 (689, go-arounds 18) not lower / not higher; full days
Heathrow 1–3, Zurich `--daily 730` 1–3, Boston 1–3 (re-run main), London City day 1 not worse; Munich and Freiburg
hashes identical; `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
