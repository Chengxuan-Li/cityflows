# Decision: the Evening scene's hue

Raised by the lead, 2026-11-13 (plan.md TASK-163 review: "the evening hue (mauve) awaits the owner").

## Context

TASK-163's Evening preset (`src/render/lighting.ts`, `evening`) uses a low warm sun (`0xff9548`) and a
dim blue sky (`0x7489bd`, background `0x4a5680`). Mixed together they give the map a mauve cast in 2D
(the multiply tint in `src/render/layers/night.ts`) and in 3D. TASK-184's Winter Follow clock passes
through the same look at dusk. Screenshots were sent with TASK-163 and TASK-184.

## Options

1. **Keep mauve** (main).
2. **Warmer, golden-hour evening**: more orange in the sky and tint, less blue (for example sky toward
   `0x8a86a8`, background toward `0x5a5070`).
3. **Cooler, blue-hour evening**: less orange sun, deeper blue sky (for example sun `0xffb070` at lower
   intensity, sky `0x5f78b0`).

## Lead recommendation

No strong preference; option 1 reads clearly as evening and keeps lamps visible. Option 3 is closer to
how a city looks once street lamps are on, which is when the scene matters most.

## How to apply

Change the `evening` preset's colours in `src/render/lighting.ts` (view-only, no hash moves), check
V163 and the contrast of labels over the tint, and send Munich 2D and 3D screenshots for approval.

Status: awaiting owner
