# TASK-365 — At most two departures lined up at once on one runway end

Status: merged 2026-11-26 (lead; airside: merge on gates). Base: main after TASK-358's helipad rule.

## Finding (TASK-363, 2026-11-26)

With TASK-363's `T363=pk`, Heathrow full-day seed 3 had three departures lined up on 27R at 21:07:36–38: G-LCJQ,
G-FQWK and G-UUCO. The checker counted 3 real runway-conflict samples. TASK-360 rule 3 checked each holder of the
runway separately, so a third aircraft could line up behind a pair.

## Rule

A line-up shares its runway with at most one departure lined up ahead of it. CAP 493 describes multiple line-ups
as aircraft at two points on the same runway (Section 2, Chapter 1, 14.1).

## Result

Main → branch, `--checks`:

| Run | Result |
|---|---|
| Heathrow 06:00–08:00, seeds 1–5 | identical: 143/130/133/134/136, 0 overlaps, 0 real runway conflicts |
| Heathrow seed 1 multiple line-ups | 18 → 17, same outcome |
| Heathrow days, seeds 1–3 | identical: 849/813/757 |
| London City day | identical |

Zurich and Boston do not use the rule: their runways cross others. Tests: aircraft and runway unit tests 50 passed;
typecheck and lint clean. Outputs: `D:\cityflows-wt\330-pilot\R\t365\`.
