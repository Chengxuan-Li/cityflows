# TASK-143 — Reuse a waiting head's detour search

On main, seed 1 issued 246735 route requests. A diagnostic counted 133788 repeated
requests from lane position zero with identical inputs and costs. The sampled caller
was the queue-head detour on 2003 of 2090 hits. The B56 branch showed the same pattern.

On `task/143-head-search-reuse`, reuse the route from a proposed detour's landing lane
while the same vehicle waits under the same routing inputs. Cache successes and failures.
Bound the retained entries by active heads or the current cost epoch. Invalidate on
changes to the compiled city, cost version, vehicle routing inputs or destination.
Re-evaluate physical availability, permissions and competing movements each step.
Keep RouteProvider's public contract, traffic rules, measurement clocks and baseline.
Own the head-detour search in `src/sim/engine.ts`, focused tests and the §8 description.

Verify repeated failed searches and changes of costs/destination/topology as applicable.
Compare Munich outcome counts and state hashes for seeds 1–3 on main and the branch,
request counts and isolated warm performance. Run check and the relevant light tiers.
The lead may land this independently if the published simulation behavior is identical
and the change saves work on main. Use ports 5343/5443 if running browser tests.
