# TASK-012 — Gate 1 integration and acceptance

Owner: lead
Gate: 1
Depends on: TASK-004, TASK-010 (and everything they depend on)

## Goal

Prove the Gate 1 checklist in `docs/plan.md` end to end, fix integration defects, and record
the gate as done.

## In scope

- Any file, for integration fixes only. Larger defects go back to the owning task as a
  follow-up PR.
- `tests/e2e/gate1-*.spec.ts`: extend or add until every checklist item is exercised.
- `docs/plan.md`: statuses, deferrals, and a short "Gate 1 verified" note with the commit.
- `README.md` (new, short): what CityFlows is, how to run it, the synthetic-traffic notice,
  license and OSM attribution. No feature marketing.

## Acceptance

- Checklist items 1 to 7 pass in Playwright on CI and by hand in a browser.
- `npm run check` and `npm run test:e2e` green on `main`.
- A 10x run of `grid5x5` for a simulated day finishes without errors; memory does not grow
  after the morning peak (heap snapshot before and after, numbers in the plan).
- Handoff failure conditions checked and absent: cars without state, decorative-only roads,
  shortest-distance-only routing, no route update after an edit, trips originating mid-road
  without a connector, no project export.

## Deliverable

PRs for fixes, the README, and the plan update.
