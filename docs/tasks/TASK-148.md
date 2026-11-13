# TASK-148 — SwiftShader rail drawing

Bring the default headless SwiftShader T62 stationary and T64 moving Munich 3D rail overhead within the existing 10% rail-on/off budget. Work from the TASK-145 timings and failed prototypes. Preserve the 2D and hardware paths, visible track forms, rail furniture, stations, trains, picking, camera and layer toggles. Own 3D rendering and focused regressions. Keep the timing harness, scene and workload comparable. Use ports 5348/5448, one worker, CI unset, with coordinated quiet samples. Record paired milliseconds, renderer identity, repeated test outcomes and matched real application views for visual verification. Run check, city and the named specs. Report candidate and evidence to the lead.

## Result

Implemented in `02e645a`, with context-restoration recovery in `6089ea6` (PR #6).
Final product validation used the clean combined TASK-148/TASK-149 revision
`c6d1233b6d5deb5fe465cf1f9b10be37f7699996` in
`D:/cityflows-wt/lead-148-merge`; the working directory and SHA were checked before each run.

Dense, unlit rail paint is cached after the camera settles, retaining multisampled color,
coverage and depth. Trains, furniture and other layers remain live and depth-tested.
Mutable frames use original geometry. Reuse is bounded over the complete rail bounds to
0.01 physical pixels and one 24-bit depth unit, relative to the captured view rather than
the previous frame. This handles the observed alternating 1.42e-13 clip-matrix translation
without accumulating camera drift. Context restoration resets textures and capability state,
restores the background and schedules a fresh frame.

Only positively identified SwiftShader is eligible, after checking attachment sample support.
The allocation limit is 1440 × 960 physical pixels and at most four MSAA samples (about
106 MiB including resolved buffers). Hardware/unknown contexts, larger targets, small meshes,
terrain and below-ground views retain original meshes. No dependency, canonical model,
simulation, 2D rendering, timing helper, sample length, budget or CI exemption changed.

TASK-145's component evidence implicated paint rather than JavaScript submission time.
An additional single-draw culling probe removed 35,453 offscreen triangles without a supported
gain; face/material variants were also discarded. Two advisory comparisons that raced the
initial city fit to 0.55 px/m were rejected. No rejected prototype remains in the renderer.

## Measurements

All named runs used one worker, `CI` unset, ports 5348/5448, 1440 × 960, DPR 1, reduced
motion, no terrain, Basemap and Entrances and exits off. Cameras and workloads retain the
TASK-145 settings: 1.6 px/m, 40° pitch, 0° bearing; paused T62 at 07:00 with 120/30 frames,
and T64's station-serving route at ×5 with 150/40 frames. Captured submissions match all
90/110 sampled intervals. Raw intervals, capture UTC, camera and simulation times are saved.

Chromium is 156.0.8078.4. Default headless selects ANGLE Vulkan SwiftShader Device (Subzero),
driver 5.0.0. Full Chromium (`channel: 'chromium'`, no extra flags) selects ANGLE NVIDIA
GeForce RTX 4070 SUPER / Direct3D11, driver 32.0.16.1088. Hardware always reports mesh mode.

Each cell is rail-on / rail-off milliseconds, followed by overhead. T62 is the two-pair
aggregate; each T64 pair is checked independently against the unchanged 10% limit.

| Revision/run | T62 3D | T64 3D pair 1 | T64 3D pair 2 | Named outcome |
|---|---|---|---|---|
| `02e645a`, candidate | 225.917 / 208.696 (+8.252%) | 231.961 / 215.597 (+7.590%) | 237.565 / 217.567 (+9.192%) | 6 passed |
| `c6d1233`, combined first | 221.658 / 208.140 (+6.495%) | 224.688 / 209.536 (+7.231%) | 228.778 / 209.992 (+8.946%) | 5 passed; 2D failure below |
| `c6d1233`, independent repeat | 220.177 / 205.084 (+7.359%) | 228.022 / 211.052 (+8.041%) | 230.294 / 214.234 (+7.496%) | 6 passed |
| `c6d1233`, RTX hardware | 31.247 / 31.252 (−0.014%) | 31.247 / 31.246 (+0.003%) | 31.244 / 31.254 (−0.032%) | 6 passed |

The unchanged 2D path's variability is retained rather than discarded:

| Software run | T62 2D | T64 2D pair 1 | T64 2D pair 2 |
|---|---|---|---|
| Candidate | 176.289 / 160.828 (+9.614%) | 176.962 / 163.478 (+8.248%) | 176.659 / 162.266 (+8.870%) |
| Combined first | 172.956 / 159.901 (+8.164%) | 169.235 / 155.599 (+8.764%) | 175.447 / 155.296 (+12.976%, fails) |
| Independent repeat | 168.789 / 154.161 (+9.489%) | 171.811 / 157.115 (+9.354%) | 172.265 / 157.266 (+9.537%) |

Hardware 2D was 31.250 / 31.248 ms for T62, and 31.251 / 31.252 and
31.244 / 31.249 ms for T64. An earlier initial run (`named1`) passed stationary 3D at
+8.06%, but moving 3D remained on meshes because exact matrix equality rejected numerical
drift; its 247.41 / 218.93 and 247.72 / 216.81 ms pairs failed. That run also retained a
second 2D pair at +12.30%. These failures remain in the evidence; no threshold was relaxed.

## Verification and artifacts

The focused browser test compares real application source/cache frames at station, train
focus, selected, rotated, far, resized, DPR 2 and panned views. Final software comparisons
have exact framebuffer alpha, at most 0.554% of pixels differing by more than two RGB levels,
and mean maximum-channel error below 0.088/255. Restoration and the 1600 × 1200 fallback
are pixel-identical. Hardware uses original meshes and has no differences above two levels.
Matched station views and the main-line train beneath the bridge were also visually inspected.
Stations, trains, inspection, pause, layer toggles and Sindelfingen crossing workflows passed.

The restoration regression failed before the fix (204,869 changed pixels, 14.82%) and passed
afterward with zero changed pixels. Five focused projection tests and two existing rail
geometry tests passed. Fresh typecheck, focused lint/format and test-mode build passed.
[Source CI on `6089ea6`](https://github.com/Chengxuan-Li/cityflows/actions/runs/43360398882)
passed all check components (1,167 unit tests; one skipped), city (164; one skipped),
traffic-light (five; one expected failure) and light browser tests. Local parallel check/city
attempts hit existing 60 s import/audit timeouts; the serial aggregate was stopped at the
lead's request for quiet performance runs. Their failed logs are retained alongside hosted
command logs; they are not represented as local aggregate passes.

Local artifacts are ignored, as in TASK-145. Under
`D:/cityflows-wt/148-swiftshader/test-results/task148/`: `named1`, `named2`, advisory logs,
`drift-focus*.json`, `drift-bounds.json`, restoration red/green results and hosted check logs.
Under `D:/cityflows-wt/lead-148-merge/test-results/task148/`: `final-default`,
`final-hardware`, `final-default-repeat`, their logs/start/end files, `measurements.json`
(including per-window standard deviations), provenance JSON and `hardware.config.ts`.
Each result directory contains raw frame/environment JSON and named application images;
the focused case includes `station-mesh.png` / `station-cache.png`, restoration and pan views.

Coordinated quiet windows on **2026-11-13 UTC**: candidate 03:18:32.964–03:30:18.021;
combined 03:40:45.368–03:51:58.602; hardware 03:54:36.434–03:58:34.300;
independent combined repeat 03:59:32.222–04:10:37.789. Other local heavy work was held.
