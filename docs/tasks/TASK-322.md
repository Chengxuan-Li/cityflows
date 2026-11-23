# TASK-322 — Block signalling and dynamic taxi flows in the airside simulation

Status: in progress 2026-11-23 (owner: "build the block signaling into the real sim now, before we try to scale").
Proposed owner: Claude Code subagent (Opus 5.5, high). Branch `task/322-block-signalling-sim`, worktree
`D:\cityflows-wt\322`, ports 5522 / 5622.

## Goal

Bring TASK-321's validated design (`bench/block-signalling.ts`, report in its commit body `6809c54`) into
`src/sim/aircraft.ts`, replacing TASK-312's order of admission:

1. **Block layer**, built when the fleet is created from the compiled airside (no schema change): junction clusters
   and segments cut into blocks of about one aircraft length plus separation (by type code where it matters).
2. **Block clearance (railway-style):** an aircraft enters a junction only if the block beyond it is free (the
   overlap), so it never stops in a junction or on a runway crossing; it enters a segment only after locking the
   direction of every segment through to its next safe place (a stand, a line-up, a runway exit taxiway, or a
   segment taken in its preferred direction); aircraft going the same way share a lock. Continuous spacing stays for
   aircraft following each other inside a block.
3. **Dynamic one-way preferences per runway configuration:** derived from that configuration's routes (not map
   data), soft (a wrong-way move costs routing weight and is allowed when no alternative exists), recomputed and
   cached on a configuration change, replacing TASK-300's fixed 3x against-flow cost. The owner's framing: an ATC
   practice that follows the runway direction in use, to optimise taxi efficiency.
4. **The four refinements TASK-321 found:** a preferred segment is a safe place only if the route does not go the
   wrong way next; a freed block goes to the longest waiter; a pushback never cuts in ahead of a taxiing aircraft; an
   aircraft waiting at a crossing of the arrival runway gets a gap between landings.
5. Keep TASK-321's loop-capacity check only as a gridlock detector in tests and benches.

## Method

Pilots first: the synthetic airports and London City, then peak windows at Zurich (730), Boston and Heathrow on the
fast airside bench (`bench/airside-delay.ts`), and full days only for the final gate numbers.

## Scope

`src/sim/aircraft.ts` (and a new block module beside it), `src/sim/runway-configuration.ts` and
`src/routing/airside.ts` where preferences enter routing, `bench/`, tests, `docs/architecture.md`.

Out of scope: parking poses (TASK-320, in parallel: merge it when it lands), ground vehicles (TASK-316, parked),
schema, gate floors, `bench/traffic-baseline.json`, any download.

## Gates

- No circular wait and nothing stuck in any run (synthetic, London City, the three large airports' peak windows and
  full days), with a gridlock detector asserting it in tests.
- London City seeds 1 to 3 keep TASK-312's gates (completion, mean at most 300 s, worst at most 1,800 s, zero
  go-arounds, overlaps, conflicts).
- Full days at Zurich (730), Boston (1,000) and Heathrow (1,306), seed 1 (seeds 2, 3 if time allows): completion,
  diversions, go-arounds, overlaps, delays, taxi times, against TASK-312's numbers; aim 98%.
- Startup pins re-pinned where states change, stated; existing cities unchanged per the rule bullet; the lead's
  tiers.

## Report

Write it as the commit body.
