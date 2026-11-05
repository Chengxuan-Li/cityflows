# CityFlows

## Use it

[Open CityFlows on GitHub Pages](https://chengxuan-li.github.io/cityflows/).

CityFlows is a traffic sandbox that runs in your browser. Cars travel between homes and
workplaces on lane-level streets you draw or import from OpenStreetMap. You can change
streets and signals and see how the same commute plays out on the edited network.

- The 5 × 5 grid opens by default. You can also choose it from **New**. Press **Play**,
  pick a speed, and click a moving car to inspect its route.
- While the simulation runs, select a street to edit its lanes or a junction to edit its
  signal phases.
- To try a real city, choose **Import** → **Choose map area**, then Shift-drag to select
  an area up to 50 km². You can also upload an `.osm` file.
- For a before-and-after comparison, open **Compare** and select **Save as baseline**.
  Make an edit, then return to **Compare** and select **Run comparison** to see how travel
  times and trip counts changed.
- Use **Export** to download the street network as GeoJSON or the simulation results as
  CSV. Use **Save** to download a project you can reopen later.

**Synthetic traffic, not observed traffic.** Map tiles and imported map data are credited
to [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

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
