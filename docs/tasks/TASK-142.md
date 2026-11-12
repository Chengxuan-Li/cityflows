# TASK-142 — Repair the November 12 full-suite failures

The nightly Full workflow on da7721d failed nine Playwright scenarios. TASK-141 addresses
the two T52 camera cases and T54 parking motion. Restore the remaining six scenarios against
the current contracts on main. Use the completed logs for run 43187179345 and reproduce the
failure before editing. Own the six specs and their test fixtures. If a product behavior is
broken, report the evidence to the lead to coordinate that repair with any affected feature.

- T47 road-access live edit handles movement-encoded vehicle positions.
- V107 street-furniture counts and V114 themes must still verify the actual UI behavior.
- V97 verifies changing under-deck signals at an actual covered signal position.
- QA Munich verifies preservation of imported geometry provenance through an edit, save and open.
- T63 verifies the searching car's claimed space and the historically chased strip. Identify
  the original strip and bay from the reference implementation and use their stable identity.

The lead handles QA Munich and T63. The subagent handles T47, V107, V114 and V97; use ports
5342/5442. Preserve the substantive assertions, gates and traffic floors. Run the affected specs,
check, and the light tiers at integration. The lead verifies Full on the combined repairs before
resuming feature merges. Report each cause and its evidence.
