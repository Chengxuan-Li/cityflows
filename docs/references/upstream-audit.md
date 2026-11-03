# TASK-000 · Upstream audit

Source snapshots fetched on November 3, 2026. Findings come from static inspection. The recommendations target the existing contracts in [architecture §§5, 8 and 13](../architecture.md) and the destination files named by the downstream tasks.

| Target | Fetched revision | License | Key paths | Feeds |
| --- | --- | --- | --- | --- |
| TRIZHAX Traffic Flow Simulation | [`9dae181b042939227608b19401f4b36dff7cd232`][tr-commit] | [MIT][tr-license] | [TrafficModel.ts][tr-idm], [MapImporter.ts][tr-tags], [selftest.mjs][tr-test] | TASK-003, 004, 020 |
| traffic-simulation.de | [`d8966b408c63a465926a67316e377ea2e20db99d`][mv-commit] | [GNU GPL v3][mv-license] | [models.js][mv-idm], [road.js][mv-merge] | TASK-003, 004, 032 |
| CityFlow | [`81ee0f47659ca66177a71f81676691c58ee89184`][cf-commit] | [Apache-2.0][cf-license] | [roadnet.rst][cf-doc], [roadnet.cpp][cf-cross], [engine.cpp][cf-engine] | TASK-001, 003 |
| osm2streets | [`fc119c47dac567d030c6ce7c24a48896f58ed906`][osm-commit] | [Apache-2.0][osm-license] | [algorithm.rs][osm-algo], [lib.rs][osm-width], [general_case.rs][osm-geom] | TASK-001, 020 |
| A/B Street docs | Docs [`dbeb0c2eab591e05d661218ae105ff63a40063d0`][ab-commit]<br>Game [`0964f29315820c91b171b585eb51e300164e9197`][abs-commit] | Apache-2.0 ([docs][ab-license], [game][abs-license]) | [Map edits][ab-edits], [lane editor][ab-lane], [signal editor][ab-screenshot] | TASK-010, 022, 040 |
| Eclipse SUMO netconvert docs | [`48f39d18e350d079fdc03c74ca256f320be7c5ce`][su-commit] | [EPL-2.0][su-license] with a [conditional GPL-2.0-or-later secondary option][su-notice] | [netconvert.md][su-doc], [OpenStreetMap.md][su-osm], [OSM typemap][su-types] | TASK-001, 020 |
| Nitai Aharoni's Traffic Simulator | Unavailable. GitHub fetch failed. | PolyForm Noncommercial 1.0.0 (author-reported, license file unavailable) | [Architecture path, HTTP 404][nitai-arch], [demo, HTTP 200][nitai-demo] | Study only |

For any later code adaptation, record the source path, pinned commit, license and destination in `NOTICE` in the same change, and preserve the applicable upstream notices. The recommendations below propose specific functions or patterns from MIT, Apache-2.0 or GPL v3 source.

## TRIZHAX · TASK-003, 004, 020

- Implements IDM acceleration, braking bounds and ballistic integration. [`src/simulation/TrafficModel.ts`][tr-idm]
- Checks target-lane gaps, follower braking and incentive for a lane change. [`src/simulation/TrafficModel.ts`][tr-mobil]
- Finds neighbors and immediately transfers a vehicle between lane lists. [`src/simulation/VehicleManager.ts`][tr-manager]
- Advances green, amber and all-red stages with mutable timers. [`src/simulation/TrafficLight.ts`][tr-light]
- Writes signal state to connectors and leaves unserved connectors free. [`src/simulation/TrafficLight.ts`][tr-light-output]
- Uses queue demand and gaps to choose adaptive phases. [`src/simulation/TrafficController.ts`][tr-controller]
- Repairs invalid node data and identifiers before the world reaches the engine. [`src/world/WorldValidator.ts`][tr-validator]
- Repairs lane and spawn data that CityFlows would validate at its boundary. [`src/world/WorldValidator.ts`][tr-validator-lanes]
- Infers directional counts from tags and parses posted speeds. [`src/world/MapImporter.ts`][tr-tags]
- Deduplicates endpoint pairs, removes short links and prunes components. [`src/world/MapImporter.ts`][tr-topology]
- Checks both matching seeds and changed seeds. [`scripts/selftest.mjs`][tr-test]
- Compares aggregate end-of-run fingerprints. [`src/testing/harness.ts`][tr-harness]

**Adapt from MIT source.**

- Port the equations in `TrafficModel.ts` functions `desiredGap`, `freeAcceleration` and `idmAcceleration` to `src/sim/idm.ts`. Use CityFlows' SI parameters and explicit bumper gaps. Keep emergency braking explicit and the §8 integration in `src/sim/engine.ts`. [IDM source][tr-idm]
- Use the gap, safety and incentive checks from `TrafficModel.ts` function `evaluateLaneChange` in `src/sim/lane-change.ts`. Compute before/after acceleration for both affected followers with their own parameters and actual leaders. Apply the §8 mandatory rule and resolve all proposals in fixed order. [MOBIL source][tr-mobil]
- Use the green, amber and all-red branches of `TrafficLight.ts` method `step` in `src/sim/signals.ts`. Compute phase from simulation time plus offset, using the compiled phase table and `neverGreen` flag. [Phase transitions][tr-light]
- Port the numeric km/h and mph branches of `MapImporter.ts` function `parseMaxSpeed` to `src/importers/osm/roads.ts`. Convert directly to m/s and record default provenance for values outside the supported syntax. [Speed parsing][tr-tags]

**Study only.** Use the paired-run test structure in `tests/sim/T02-determinism.test.ts` with the per-step hash from `src/sim/hash.ts`. Review the validator for diagnostic cases in `src/network/diagnostics.ts` and directional tag precedence for `src/importers/osm/roads.ts`. Keep queue-adaptive phase selection for comparison with future controllers. [Test harness][tr-harness] [Validator][tr-validator] [Tag inference][tr-tags] [Adaptive controller][tr-controller]

**Risks.** The fetched revision has no parent. The end-of-run sums can hide transient divergences. Immediate lane-list mutation can bias later decisions, unserved connectors can admit traffic, and removing short or parallel links can change legal routes. Keep §8 proposal and resolution ordering, §5.4 signal validation, and §13 shared-node connectivity. [Lane changes][tr-manager] [Signal outputs][tr-light-output] [Importer topology][tr-topology]

## traffic-simulation.de · TASK-003, 004, 032

- Provides deterministic IDM math alongside a noisy acceleration wrapper. [`js/models.js`][mv-idm]
- Implements MOBIL with speed-dependent safe braking and directional bias. [`js/models.js`][mv-mobil]
- Sets browser demo defaults for following, lane changes and truck scaling. [`js/control_gui.js`][mv-params]
- Builds the car and truck ACC and MOBIL instances from GUI parameters. [`js/control_gui.js`][mv-presets]
- Transfers vehicles between overlapping road intervals in the on-ramp scenario. [`js/onramp.js`][mv-onramp]
- Finds merge neighbors, measures bumper gaps and checks follower braking and priority. [`js/road.js`][mv-merge]
- Connects roads across a lane-count drop using an offset and a virtual blocker. [`js/test2_bottleneck.js`][mv-drop]
- Removes occupants when a lane is deleted. [`js/road.js`][mv-delete]

**Adapt from GPL v3 source.** Port the prospective leader/follower lookup and bumper-gap calculation in `js/road.js` method `road.prototype.mergeDiverge` into `src/sim/merge.ts`. Measure at the compiled movement exit and use CityFlows' clearance, actual follower IDM parameters and deterministic grant order. [Merge implementation][mv-merge]

**Study only.** Cross-check the desired gap against `IDM.prototype.calcAccDet` and use `MOBIL.prototype.realizeLaneChange` to review target-follower safety. The demo uses a 1.4 s headway, 2 m standstill gap and 3 m/s² comfortable braking. Keep §8 values in `src/sim/params.ts`. Use the lane-drop scenario to test a required lane change before the drop in `tests/sim/T07-lane-aware-ramp.test.ts`. [IDM][mv-idm] [MOBIL][mv-mobil] [Presets][mv-params] [Lane drop][mv-drop]

**Risks.** The acceleration wrapper uses `Math.random` and global time-step state. MOBIL has a high-bias branch that bypasses safety. Road transfers skip explicit movement traversal and deleting occupied lanes breaks trip conservation. [Models][mv-idm] [Safety bypass][mv-mobil] [On-ramp][mv-onramp] [Deletion][mv-delete]

## CityFlow · TASK-001, 003

- Defines directional roads, lane links with geometry and phase permissions by road link. [`docs/source/roadnet.rst`][cf-doc]
- Loads lane-index pairs and links signal phase permissions to road links. [`src/roadnet/roadnet.cpp`][cf-load]
- Searches segment pairs for crossings between lane links at the same intersection. [`src/roadnet/roadnet.cpp`][cf-cross]
- Orders simulation work stages across thread barriers. [`src/engine/engine.cpp`][cf-workers]
- Spawns, plans and commits vehicle changes before advancing signals. [`src/engine/engine.cpp`][cf-engine]
- Advances the current signal phase using remaining duration. [`src/roadnet/trafficlight.cpp`][cf-light]

**Adapt from Apache-2.0 source.** Use the per-intersection lane-link pair traversal in `Intersection::initCrosses` in `src/network/conflicts.ts`. Use CityFlows' polyline intersection routine and §5.3 rules for shared origins and destinations. Use the road-link-to-lane-link grouping in `RoadNet::loadFromJson` as the basis for expanding road-pair phase permissions to stable movement IDs in `src/network/signals.ts`. [Crossing search][cf-cross] [Roadnet loader][cf-load]

**Study only.** Review the action/commit separation for `src/sim/engine.ts`. Keep signals at step start, resolve movement grants deterministically, and check downstream blocking before commit. [Worker stages][cf-workers] [Step order][cf-engine]

**Risks.** CityFlow's road-link indexes are positional. Its phase data and mutable timer leave CityFlows' clearance intervals, unserved movements and conflict validation to the local compiler. Its thread barriers and flow format couple the example to a different engine and demand model. [Roadnet format][cf-doc] [Phase timer][cf-light]

## osm2streets · TASK-001, 020

- Delegates tag-to-lane inference to Muv and resolves direction, driving side and width in the resulting lane specs. [`osm2lanes/src/algorithm.rs`][osm-algo]
- Pins the separate Muv source used for the delegated lane inference. [`Cargo.lock`][osm-muv]
- Orders fallback lane widths by lane type and highway class. [`osm2lanes/src/lib.rs`][osm-width]
- Exercises asymmetric counts from directional lane tags. [`osm2lanes/src/tests.rs`][osm-tests]
- Moves reference lines to account for lane placement. [`osm2streets/src/road.rs`][osm-road]
- Selects a junction polygon strategy and computes road trimming. [`osm2streets/src/geometry/mod.rs`][osm-shape]
- Uses adjacent road-edge intersections to trim approaches and form corners. [`osm2streets/src/geometry/general_case.rs`][osm-geom]
- Groups junction candidates using projected points. [`streets_reader/src/split_ways.rs`][osm-split]

**Adapt from Apache-2.0 source.** Use the class-keyed fallback pattern in `LaneSpec::typical_lane_widths` in `src/importers/osm/roads.ts`. Keep CityFlows' §13 widths of 3.0 m for residential and service and 3.5 m elsewhere. Record inference for class-default lane counts and speeds. [Width fallback][osm-width]

**Study only.** Use the asymmetric directional examples to check that unequal two-way lane blocks and left-hand traffic mirror correctly in `src/network/lanes.ts` and its compile tests. Study complex junction polygons for geometry cases while keeping the §5.1 miter/bevel offsets and radius trimming. [Directional tests][osm-tests] [Reference lines][osm-road] [Junction polygons][osm-geom]

**Risks.** Muv owns the delegated inference logic and has separate provenance. A wholesale port would bring in a different lane model and unsupported tag semantics. Projected-point grouping can connect roads that share coordinates but have different OSM node IDs. [Delegation][osm-algo] [Dependency pin][osm-muv] [Way splitting][osm-split]

## A/B Street docs · TASK-010, 022, 040

- Describes rebuilding turns and drawing geometry after map edits, with route recomputation deferred. [`book/src/tech/map/edits.md`][ab-edits]
- Distinguishes signal edits from topology edits that can invalidate active paths. [`book/src/tech/trafficsim/live_edits.md`][ab-live]
- Visual reference for selecting a lane in a street cross-section. [`book/src/tech/map/geometry/edit_transit.png`][ab-lane]
- Visual reference for a phase list paired with highlighted junction movements. [`book/src/project/history/retrospective/tsig_four_stage.png`][ab-screenshot]
- Defines the old/new edit command stack and changed entity sets. [`map_model/src/edits/mod.rs`][ab-model]
- Reverses the obsolete command suffix, applies the new suffix, and tracks affected turns. [`map_model/src/edits/apply.rs`][ab-apply]
- Links lane-card selection and hover to map geometry. [`apps/game/src/edit/roads.rs`][ab-roads]
- Uses the selected stage to draw its protected and yielding movements. [`apps/game/src/edit/traffic_signals/mod.rs`][ab-signals]

**Adapt.** No code proposed.

**Study only.** Pair lane selection with a map highlight in `src/ui/inspector/street.tsx`. Use the changed-turn examples to review undo after a split in `src/editor/commands/topology.ts`. Pair phase selection in `src/ui/inspector/signal.tsx` with movement highlights in `src/render/layers/signal-preview.ts`. [Lane editor][ab-lane] [Edit application][ab-apply] [Signal editor][ab-screenshot]

**Risks.** The source's in-place edit and deferred routing model can leave a running simulation on stale paths. CityFlows compiles and validates a candidate before committing the editor version and prompts for restart in `src/ui/run-bar.tsx`. A/B Street's yielding stage movements also differ from CityFlows' phase conflict rules. [Live edits][ab-live] [Stage editor][ab-signals]

## Eclipse SUMO netconvert docs · TASK-001, 020

- Defines generic edge defaults of one lane and 13.89 m/s. [`docs/web/docs/netconvert.md`][su-doc]
- Documents opt-in interpretation of OSM turn lanes. [`docs/web/docs/netconvert.md`][su-turn-option]
- Explains that the selected typemap supplies defaults and explicit OSM tags override them. [`docs/web/docs/Networks/Import/OpenStreetMap.md`][su-osm]
- Explains how lane arrows guide guessed connections, including the assumption for unmarked lanes. [`docs/web/docs/Networks/Import/OpenStreetMap.md`][su-osm-arrows]
- Sets OSM motorway defaults to two lanes at 39.44 m/s, trunk and primary to two at 27.78 m/s, and residential to one at 13.89 m/s. [`data/typemap/osmNetconvert.typ.xml`][su-types]
- Overrides speeds for a Germany-oriented urban profile. [`data/typemap/osmNetconvertUrbanDe.typ.xml`][su-urban]
- Distinguishes guessed connections from explicit lane-to-lane connections. [`docs/web/docs/Networks/PlainXML.md`][su-plain]
- Defines lane index zero at the right edge. [`docs/web/docs/Networks/SUMO_Road_Networks.md`][su-index]
- Distributes lanes across angle-ordered reachable edges using priority weights and vehicle permissions. [`src/netbuild/NBEdge.cpp`][su-edge]
- Handles lane additions and on-ramps separately from general lane assignment. [`src/netbuild/NBNode.cpp`][su-node]
- Records the conditions on distribution under the secondary license. [`NOTICE.md`][su-notice]

**Adapt.** No SUMO code, documentation or typemap data proposed for adaptation.

**Study only.** Compare typemap precedence with explicit-tag parsing and inference provenance in `src/importers/osm/roads.ts`. Use marked versus unmarked approaches, a widening and an on-ramp as cases for `src/importers/osm/turns.ts` and `src/network/movements.ts`. Generate the §5.2 index-based defaults and apply §13 tag-derived turn rules using CityFlows' rule specificity. [OSM import][su-osm] [Lane arrows][su-osm-arrows] [Connection heuristics][su-edge] [Ramp cases][su-node]

**Risks.** SUMO's rightmost-first numbering reverses CityFlows' convention. Its primary-road defaults, unmarked-as-through assumption and priority-based turn distribution would change CityFlows' lane counts and legal routes. The secondary license option has distribution conditions. [Lane indexes][su-index] [Typemap][su-types] [Lane arrows][su-osm-arrows] [License notice][su-notice]

## Nitai Aharoni's simulator · reachability only

- Architecture entry point named in the handoff and indexed repository listing. The raw file returned HTTP 404. [`ARCHITECTURE.md`][nitai-arch]
- License file named in the indexed listing. The raw file returned HTTP 404. [`LICENSE`][nitai-license]
- The hosted demo returned HTTP 200 on November 3, 2026. This checks reachability only. [Hosted demo][nitai-demo]

**Adapt.** No code or assets permitted.

**Study only.** If source access returns, compare the documented boundary between imported topology, headless simulation and rendering. The indexed author description identifies congestion rerouting, land-use demand, and transit as gaps. Treat those as author claims until the architecture notes can be checked. [Indexed repository][nitai-repo]

**Risks.** Unauthenticated clone and `git ls-remote` both returned “Repository not found.” The GitHub page, repository API, and `master` archive returned HTTP 404. No commit or license blob could be verified. The handoff and indexed author description identify PolyForm Noncommercial 1.0.0, which excludes this source from reuse under CityFlows' licensing policy.

## Do not use

- Nitai's source, derived code, bundled assets or screenshots. PolyForm Noncommercial restricts use, and the source revision is unavailable.
- Upstream screenshots and UI artwork as CityFlows assets. The A/B Street images are design references.
- SUMO typemaps as CityFlows defaults, or the SUMO engine and Rust/C++ reference engines as runtime dependencies for these tasks. The browser contracts specify the data model and step sequence.
- Reference importer shortcuts that join roads by proximity or remove short links and disconnected components. They can create or erase legal routes. Preserve OSM attribution separately from code notices.

[tr-commit]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/commit/9dae181b042939227608b19401f4b36dff7cd232
[tr-license]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/9dae181b042939227608b19401f4b36dff7cd232/LICENSE
[mv-commit]: https://github.com/movsim/traffic-simulation-de/commit/d8966b408c63a465926a67316e377ea2e20db99d
[mv-license]: https://github.com/movsim/traffic-simulation-de/blob/d8966b408c63a465926a67316e377ea2e20db99d/LICENSE
[cf-commit]: https://github.com/cityflow-project/CityFlow/commit/81ee0f47659ca66177a71f81676691c58ee89184
[cf-license]: https://github.com/cityflow-project/CityFlow/blob/81ee0f47659ca66177a71f81676691c58ee89184/LICENSE.txt
[osm-commit]: https://github.com/a-b-street/osm2streets/commit/fc119c47dac567d030c6ce7c24a48896f58ed906
[osm-license]: https://github.com/a-b-street/osm2streets/blob/fc119c47dac567d030c6ce7c24a48896f58ed906/LICENSE
[ab-commit]: https://github.com/a-b-street/docs/commit/dbeb0c2eab591e05d661218ae105ff63a40063d0
[ab-license]: https://github.com/a-b-street/docs/blob/dbeb0c2eab591e05d661218ae105ff63a40063d0/LICENSE
[abs-commit]: https://github.com/a-b-street/abstreet/commit/0964f29315820c91b171b585eb51e300164e9197
[abs-license]: https://github.com/a-b-street/abstreet/blob/0964f29315820c91b171b585eb51e300164e9197/LICENSE
[su-commit]: https://github.com/eclipse-sumo/sumo/commit/48f39d18e350d079fdc03c74ca256f320be7c5ce
[su-license]: https://github.com/eclipse-sumo/sumo/blob/48f39d18e350d079fdc03c74ca256f320be7c5ce/LICENSE
[tr-idm]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/9dae181b042939227608b19401f4b36dff7cd232/src/simulation/TrafficModel.ts#L79-L160
[tr-mobil]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/9dae181b042939227608b19401f4b36dff7cd232/src/simulation/TrafficModel.ts#L198-L230
[tr-manager]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/9dae181b042939227608b19401f4b36dff7cd232/src/simulation/VehicleManager.ts#L649-L712
[tr-light]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/9dae181b042939227608b19401f4b36dff7cd232/src/simulation/TrafficLight.ts#L128-L181
[tr-light-output]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/9dae181b042939227608b19401f4b36dff7cd232/src/simulation/TrafficLight.ts#L216-L234
[tr-controller]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/9dae181b042939227608b19401f4b36dff7cd232/src/simulation/TrafficController.ts#L66-L189
[tr-validator]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/9dae181b042939227608b19401f4b36dff7cd232/src/world/WorldValidator.ts#L56-L125
[tr-validator-lanes]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/9dae181b042939227608b19401f4b36dff7cd232/src/world/WorldValidator.ts#L190-L285
[tr-tags]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/9dae181b042939227608b19401f4b36dff7cd232/src/world/MapImporter.ts#L612-L699
[tr-topology]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/9dae181b042939227608b19401f4b36dff7cd232/src/world/MapImporter.ts#L447-L543
[tr-test]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/9dae181b042939227608b19401f4b36dff7cd232/scripts/selftest.mjs#L104-L119
[tr-harness]: https://github.com/TRIZHAX/trizhax-traffic-flow-simulation/blob/9dae181b042939227608b19401f4b36dff7cd232/src/testing/harness.ts#L229-L276
[mv-idm]: https://github.com/movsim/traffic-simulation-de/blob/d8966b408c63a465926a67316e377ea2e20db99d/js/models.js#L152-L196
[mv-mobil]: https://github.com/movsim/traffic-simulation-de/blob/d8966b408c63a465926a67316e377ea2e20db99d/js/models.js#L566-L631
[mv-params]: https://github.com/movsim/traffic-simulation-de/blob/d8966b408c63a465926a67316e377ea2e20db99d/js/control_gui.js#L803-L873
[mv-presets]: https://github.com/movsim/traffic-simulation-de/blob/d8966b408c63a465926a67316e377ea2e20db99d/js/control_gui.js#L1056-L1105
[mv-onramp]: https://github.com/movsim/traffic-simulation-de/blob/d8966b408c63a465926a67316e377ea2e20db99d/js/onramp.js#L570-L601
[mv-merge]: https://github.com/movsim/traffic-simulation-de/blob/d8966b408c63a465926a67316e377ea2e20db99d/js/road.js#L3319-L3430
[mv-drop]: https://github.com/movsim/traffic-simulation-de/blob/d8966b408c63a465926a67316e377ea2e20db99d/js/test2_bottleneck.js#L411-L425
[mv-delete]: https://github.com/movsim/traffic-simulation-de/blob/d8966b408c63a465926a67316e377ea2e20db99d/js/road.js#L350-L362
[cf-doc]: https://github.com/cityflow-project/CityFlow/blob/81ee0f47659ca66177a71f81676691c58ee89184/docs/source/roadnet.rst#L6-L85
[cf-load]: https://github.com/cityflow-project/CityFlow/blob/81ee0f47659ca66177a71f81676691c58ee89184/src/roadnet/roadnet.cpp#L172-L282
[cf-cross]: https://github.com/cityflow-project/CityFlow/blob/81ee0f47659ca66177a71f81676691c58ee89184/src/roadnet/roadnet.cpp#L515-L575
[cf-workers]: https://github.com/cityflow-project/CityFlow/blob/81ee0f47659ca66177a71f81676691c58ee89184/src/engine/engine.cpp#L253-L269
[cf-engine]: https://github.com/cityflow-project/CityFlow/blob/81ee0f47659ca66177a71f81676691c58ee89184/src/engine/engine.cpp#L566-L592
[cf-light]: https://github.com/cityflow-project/CityFlow/blob/81ee0f47659ca66177a71f81676691c58ee89184/src/roadnet/trafficlight.cpp#L29-L39
[osm-algo]: https://github.com/a-b-street/osm2streets/blob/fc119c47dac567d030c6ce7c24a48896f58ed906/osm2lanes/src/algorithm.rs#L23-L138
[osm-muv]: https://github.com/a-b-street/osm2streets/blob/fc119c47dac567d030c6ce7c24a48896f58ed906/Cargo.lock#L870-L872
[osm-width]: https://github.com/a-b-street/osm2streets/blob/fc119c47dac567d030c6ce7c24a48896f58ed906/osm2lanes/src/lib.rs#L292-L309
[osm-tests]: https://github.com/a-b-street/osm2streets/blob/fc119c47dac567d030c6ce7c24a48896f58ed906/osm2lanes/src/tests.rs#L151-L180
[osm-road]: https://github.com/a-b-street/osm2streets/blob/fc119c47dac567d030c6ce7c24a48896f58ed906/osm2streets/src/road.rs#L164-L194
[osm-shape]: https://github.com/a-b-street/osm2streets/blob/fc119c47dac567d030c6ce7c24a48896f58ed906/osm2streets/src/geometry/mod.rs#L100-L168
[osm-geom]: https://github.com/a-b-street/osm2streets/blob/fc119c47dac567d030c6ce7c24a48896f58ed906/osm2streets/src/geometry/general_case.rs#L11-L125
[osm-split]: https://github.com/a-b-street/osm2streets/blob/fc119c47dac567d030c6ce7c24a48896f58ed906/streets_reader/src/split_ways.rs#L14-L108
[su-doc]: https://github.com/eclipse-sumo/sumo/blob/48f39d18e350d079fdc03c74ca256f320be7c5ce/docs/web/docs/netconvert.md#L291-L305
[su-turn-option]: https://github.com/eclipse-sumo/sumo/blob/48f39d18e350d079fdc03c74ca256f320be7c5ce/docs/web/docs/netconvert.md#L511-L517
[su-osm]: https://github.com/eclipse-sumo/sumo/blob/48f39d18e350d079fdc03c74ca256f320be7c5ce/docs/web/docs/Networks/Import/OpenStreetMap.md#L483-L508
[su-osm-arrows]: https://github.com/eclipse-sumo/sumo/blob/48f39d18e350d079fdc03c74ca256f320be7c5ce/docs/web/docs/Networks/Import/OpenStreetMap.md#L121-L126
[su-types]: https://github.com/eclipse-sumo/sumo/blob/48f39d18e350d079fdc03c74ca256f320be7c5ce/data/typemap/osmNetconvert.typ.xml#L2-L17
[su-urban]: https://github.com/eclipse-sumo/sumo/blob/48f39d18e350d079fdc03c74ca256f320be7c5ce/data/typemap/osmNetconvertUrbanDe.typ.xml#L2-L11
[su-plain]: https://github.com/eclipse-sumo/sumo/blob/48f39d18e350d079fdc03c74ca256f320be7c5ce/docs/web/docs/Networks/PlainXML.md#L857-L873
[su-index]: https://github.com/eclipse-sumo/sumo/blob/48f39d18e350d079fdc03c74ca256f320be7c5ce/docs/web/docs/Networks/SUMO_Road_Networks.md#L196-L206
[su-edge]: https://github.com/eclipse-sumo/sumo/blob/48f39d18e350d079fdc03c74ca256f320be7c5ce/src/netbuild/NBEdge.cpp#L3450-L3550
[su-node]: https://github.com/eclipse-sumo/sumo/blob/48f39d18e350d079fdc03c74ca256f320be7c5ce/src/netbuild/NBNode.cpp#L1243-L1330
[su-notice]: https://github.com/eclipse-sumo/sumo/blob/48f39d18e350d079fdc03c74ca256f320be7c5ce/NOTICE.md#L15-L24
[ab-edits]: https://github.com/a-b-street/docs/blob/dbeb0c2eab591e05d661218ae105ff63a40063d0/book/src/tech/map/edits.md
[ab-live]: https://github.com/a-b-street/docs/blob/dbeb0c2eab591e05d661218ae105ff63a40063d0/book/src/tech/trafficsim/live_edits.md
[ab-lane]: https://github.com/a-b-street/docs/blob/dbeb0c2eab591e05d661218ae105ff63a40063d0/book/src/tech/map/geometry/edit_transit.png
[ab-screenshot]: https://github.com/a-b-street/docs/blob/dbeb0c2eab591e05d661218ae105ff63a40063d0/book/src/project/history/retrospective/tsig_four_stage.png
[ab-model]: https://github.com/a-b-street/abstreet/blob/0964f29315820c91b171b585eb51e300164e9197/map_model/src/edits/mod.rs
[ab-apply]: https://github.com/a-b-street/abstreet/blob/0964f29315820c91b171b585eb51e300164e9197/map_model/src/edits/apply.rs
[ab-roads]: https://github.com/a-b-street/abstreet/blob/0964f29315820c91b171b585eb51e300164e9197/apps/game/src/edit/roads.rs
[ab-signals]: https://github.com/a-b-street/abstreet/blob/0964f29315820c91b171b585eb51e300164e9197/apps/game/src/edit/traffic_signals/mod.rs
[nitai-arch]: https://github.com/nitaiaharoni1/traffic-simulator/blob/master/ARCHITECTURE.md
[nitai-license]: https://github.com/nitaiaharoni1/traffic-simulator/blob/master/LICENSE
[nitai-demo]: https://nitai-traffic-simulator.web.app/
[nitai-repo]: https://github.com/nitaiaharoni1/traffic-simulator
