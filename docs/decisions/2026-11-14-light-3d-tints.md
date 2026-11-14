# Decision: deeper place tints in Light 3D (TASK-166 colour-space fix)

Raised by TASK-166's agent and the lead, 2026-11-13 (plan.md TASK-166 review).

## Context

3D place fills (land-use and destination tints) were written to vertex colours as sRGB bytes that
three.js reads as linear, which washed them out. TASK-166 converts them through `three`'s `Color`
(`src/render3d/geometry.ts`, in `buildGeometry`: "Vertex colours are linear"). The dark appearance
needed it (dark tints were washed to grey); a side effect is that Light 3D place tints are a shade
deeper than before, now matching 2D.

## Options

1. **Keep the fix** (main): 3D tints match 2D in both appearances.
2. **Revert for Light only**: Light 3D returns to the paler pre-TASK-166 tints (no longer matching 2D);
   Dark keeps the fix.
3. **Revert entirely**: Dark 3D tints wash out again (not recommended).

## Lead recommendation

Option 1: one colour for one place kind in both views, and it is the correct colour handling.

## How to apply

Option 1: nothing. Option 2: in `buildGeometry`, use the old byte path when the palette is
`mapPalettes.light` (a few lines), with a 3D Light screenshot before and after. Option 3: revert the
`Color` line.

Status: awaiting owner
