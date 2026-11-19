# TASK-224 — Aerial re-check of the Freiburg Hauptbahnhof box after wave A

Status: planned (unsupervised run, owner 2026-11-19; starts when a wave A slot frees). Proposed owner:
Claude Code subagent (Opus 5.5, high). Branch `task/224-aerial-recheck`, worktree `D:\cityflows-wt\224`, ports
5424 / 5524.

## Goal

Re-run TASK-216's overlay (`bench/aerial-overlay.ts`, imagery in `D:\cityflows-wt\216-data`,
read-only) on main after TASK-217 to 220 have merged: each of D1 to D9 with its figure before (TASK-216)
and now, what is fixed, what is not, and any new defect the changes introduced. Extend the box to the
Bertoldsbrunnen and the Martinstor (the tram core) if the existing tiles cover it; download nothing.
Rank the remaining defects as TASK-216 did and propose follow-ups.

## Scope

`bench/aerial-overlay.ts`, `docs/findings/2026-11-19-aerial-recheck/`. Read-only on `src/`.

## Gates

- Every D case with before and now figures and close-ups; `npm run check`.

## Report

Write it as the commit body: per case, the cause, the rule, the figures; the traffic tables.
