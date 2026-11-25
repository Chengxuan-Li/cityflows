# TASK-336 — Night halo shader compiles in every city

Status: done 2026-11-23 by the lead (owner: "fix", after TASK-335 reported the error). Branch
`task/336-signal-halo-shader`, worktree `D:\cityflows-wt\336`. Base: main 6da5b0f.

## Finding

TASK-335's agent found a vertex shader error when night comes on in 3D. It shows on main as well as on its branch:
`THREE.WebGLProgram: Shader Error ... 'instanceColor' : undeclared identifier` at `vTint = instanceColor`. The
halo material in `src/render3d/lights.ts` (`buildHalos`, used for lamp and signal halos) reads `instanceColor`.
three declares `instanceColor` only for an instanced mesh whose `instanceColor` attribute is set, and `buildHalos`
set it only through `setColorAt` for each light. A city with no lamps or no signals (the mixed-class vehicle grid
of `D:\cityflows-wt\335-evidence\models-full.cityflows`, for example) built an empty halo mesh without the attribute,
and its shader failed to compile at night.

## Fix

`buildHalos` gives the mesh an `instanceColor` buffer up front (white), so the attribute always exists. The vertex
shader also guards the read with `USE_INSTANCING_COLOR`. Halo colours, sizes and positions are unchanged.

## Scope

`src/render3d/lights.ts`, `src/render3d/lights.test.ts`.

## Gates

- Unit test: an empty and a one-light halo mesh both carry an instance colour; the shader guards the read; a red
  light stays red. It fails on the base (`expected null not to be null`).
- Browser, ANGLE D3D11, test-mode builds of base and branch, night in 3D after 2,400 steps: the vehicle-model
  project shows 1 shader error on base and 0 on the branch; Munich, Freiburg and London City show 0 on the branch,
  with lamp and signal halos still drawn.
- Sim unchanged (render-only); `npm run check`, `test:city`, `test:e2e:light`.
