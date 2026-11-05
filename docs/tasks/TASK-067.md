# TASK-067 — Ship it: a public static deploy and a user guide

Owner: unassigned
Gate: 5 (owner decision 2026-11-04: shipping is wanted)
Depends on: TASK-060. Design: `docs/architecture.md` section 2 (Deployment). Read it before
the code.

## Goal

Nothing in the project puts a build in front of anyone but the owner. Publish the app as a
static site from CI, so testers open a link instead of cloning the repository, and give them
a short guide to what they can do.

## In scope

- `.github/workflows/`: a deploy job (or a second workflow) that builds on every push to
  `main` after the check job passes and publishes `dist` to GitHub Pages with the official
  Pages actions; pull requests build but never publish. Keep the existing check and e2e jobs
  as they are.
- `vite.config.ts`: the base path from an environment variable set only by the Pages build,
  so `npm run dev`, `npm run preview` and the Playwright server keep serving from `/`.
- `src/render/layers/tiles.ts`, `src/ui/import/area-picker.tsx`, `src/importers/overpass.ts`:
  read `VITE_TILE_URL` and `VITE_OVERPASS_URL` with today's URLs as defaults; nothing else in
  those files changes.
- `README.md`: a "Use it" section at the top with the published link, what the app does in
  three sentences, the main things to try (open the grid, play, click a car, edit a street or a
  signal while it runs, import an area of a real city, compare before and after, export), the
  synthetic-traffic notice and the OpenStreetMap attribution; the existing developer sections
  stay below. No new Markdown files.
- Check that the production build has no test hooks (`window.cityflows` absent) and that the
  bundled projects, the import wizard, Overpass and tiles work from the base path; fix asset
  URLs that assume `/`.

## Out of scope

- `src/sim`, `src/network`, `src/importers/osm` (TASK-065 and TASK-066 run in parallel there),
  `src/render` and `src/ui` beyond the URL lines and asset paths, new dependencies, a
  backend, analytics, a custom domain.

## Owner steps after merge (state them in the report)

Enable GitHub Pages for the repository with "GitHub Actions" as the source, and decide
whether the public site may use `tile.openstreetmap.org` (light use with attribution is
allowed by its usage policy; heavy public use is not) or should set `VITE_TILE_URL` to
another provider in the workflow.

## Acceptance

- The workflow passes `actionlint`-style review by reading (official actions at pinned major
  versions, `permissions: pages: write, id-token: write` only on the deploy job, a
  `concurrency` group so deploys do not overlap).
- `npm run build` with the Pages base path set, then `npm run preview` with that base:
  the app loads, the grid plays, the town opens from New, the import wizard uploads
  `fixtures/osm/downtown.osm`, and `window.cityflows` is undefined. Report what you saw and
  a screenshot path.
- `npm run check` green; `npm run test:e2e` green on a port of your own, unchanged.

## Commands

`npm run check`, `npm run test:e2e` (set `CITYFLOWS_TEST_PORT`), `npm run build`,
`npm run preview`.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, the
owner steps, how the base path is set, what you saw in the preview, and the final lines of
`npm run check`.
