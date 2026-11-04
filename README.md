# CityFlows

A browser-based city traffic sandbox. Individual vehicles drive on lane-level road networks
that are imported from OpenStreetMap or drawn by hand, following car-following and
lane-changing rules, legal turn movements, signals and right-of-way, between places where
people live and work. You edit the network, restart with the same seed, and watch what
changes.

All traffic is synthetic. Nothing here predicts real congestion.

## Run it

```
npm ci
npm run dev
```

Open the printed URL. The bundled 5 by 5 grid loads with a morning commute scheduled; press
Play, pick a speed, click a car, a street or a junction, change a lane count, a one-way, a
turn or a signal phase, then Restart to replay the same demand on the edited network.

```
npm run check      # typecheck, lint, format check, unit tests, build
npm run test:e2e   # Playwright scenarios (first: npx playwright install chromium)
```

## Where things are

`docs/architecture.md` holds the contracts (data model, compile, routing, simulation,
project format); `docs/plan.md` the delivery gates and task graph; `AGENTS.md` the rules for
working on the code.

## License and data

GPL-3.0-or-later; see `LICENSE` and `NOTICE`. Imported map data is from OpenStreetMap
contributors under the ODbL (https://www.openstreetmap.org/copyright); every imported project
carries that attribution.
