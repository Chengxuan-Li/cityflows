# TASK-145 — T62 and T64 rail frame times

Measure rail layers and train drawing on current main using the named T62/T64 Playwright specs with local performance assertions active, one worker, consistent camera and browser backend, and repeated paired rail-on/off samples. Report per-view milliseconds, variability, and evidence distinguishing rendering cost from sampling noise. Fix a demonstrated measurement or rendering defect and repeat the comparison. Preserve the ten-percent limit, functional coverage and existing CI policy unless measurements support a reviewed change. Own the two specs, their timing helpers and any specifically implicated rendering code. Coordinate quiet sampling windows with the lead. Use ports 5345/5445.

## Audit, November 12

The default Playwright 3D budget remains unresolved. No rendering prototype was retained.
The shared timing helper now filters submissions by their capture timestamps, drains queued
observer records, and saves raw frame/submission intervals, UTC capture boundaries, camera,
simulation time, canvas diagnostics and browser/GPU metadata. The observer previously dropped
the final submission (89 submissions for 90 intervals, or 109 for 110); a focused browser
regression also catches warm-up entries leaking into the result. T62 checks its unchanged
10% allowance after all inspections and named screenshots, so a budget failure retains the
tram coverage. CI's sample lengths and existing exemption are unchanged.

Settings: one worker, `CI` unset, 1440 × 960, device pixel ratio 1, reduced motion, terrain
disabled, Basemap and Entrances and exits off, station camera 1.6 px/m, 3D pitch 40° and
bearing 0°. T62 remains paused at 07:00 with 120 frames / 30 warm-up frames; T64 uses its
original station-serving-route focus, x5 playback and 150 / 40 frames. Default Chromium
156.0.8078.4 headless shell, revision 1248, selects ANGLE Vulkan SwiftShader, despite the host
having an RTX 4070 SUPER. CPU: i7-14700F, 20 cores / 28 logical processors.

Original named-run means, in milliseconds (rail on / off):

| Spec/view | First pair | Second pair | Result |
|---|---|---|---|
| T62 2D | 169.0667 / 157.9567 | 168.5122 / 155.1800 | aggregate +7.81% |
| T62 3D | 234.2500 / 206.6589 | 237.0267 / 205.1767 | aggregate +14.43%, fails |
| T64 2D | 170.5982 / 157.4182 | 170.1455 / 157.5700 | +8.37% / +7.98% |
| T64 3D | 245.1418 / 211.9618 | 254.0809 / 217.4155 | +15.65% / +16.86%, fails |

The T64 Munich platform/bridge and Sindelfingen terminal/crossing workflows passed.
JavaScript submission means were 0.28–1.35 ms; they do not account for the 155–254 ms frame
intervals. Static T62 reproduces the 3D increase without advancing road traffic.

Controlled stationary profiling used the same backend/camera and 75 / 20 frames. Hiding
tracks removed 65,503 submitted triangles (221.51 ms); complete rail on bookends were
233.63 / 234.54 ms, with 105 calls and 869,916 total scene triangles. Hiding station
furniture removed 27 calls without a measurable gain. Indexing duplicate vertices retained
the triangle count and measured 235.45 ms: no supported improvement.

Two spatial-culling prototypes were rejected:

- Per-track batches: clean forward baseline 239.81 ms, candidate 246.10 ms, off 207.95 ms.
  Calls grew 105 → 464 while submitted triangles fell 869,916 → 842,187. Both screenshot
  comparisons retained all 67,375 exact rail-palette pixels; only three other pixels differed.
- Clipped 256 m cells: forward baseline/candidate/off 240.18 / 238.51 / 207.77 ms;
  reverse off/candidate/baseline 207.58 / 238.51 / 237.40 ms. Calls 121, triangles 853,453.
  The candidate still costs about 14.8% over off, with no repeatable gain against baseline.
  It also changed 9,878 rail-palette pixels, so it was discarded.

Quiet windows (UTC): original 20:27:34.864–20:37:33.978; corrected component profile
20:45:37.154–20:49:48.052; per-track 20:56:55.427–21:00:04.250; final cell comparison
21:04:32.569–21:07:40.458. A 2.22 s synthetic test at 20:34:43–20:34:45 may overlap the
original T64 second 2D pair. A competing trace at 20:59:37.940–21:00:01.328 invalidates the
per-track reverse candidate/baseline windows; they are not evidence for an improvement.
An initial component probe whose visibility overrides were overwritten every frame was
discarded before interpreting its component results.

Local artifacts are under `test-results/task145/`: `baseline/baseline-results` (original
reports, screenshots and failure traces), `profile.json` / `profile.log` (corrected component
isolation), `culling-compare.json` / `culling-pixels.json` (rejected per-track batches), and
`grid-compare.json` / `grid-pixels.json` (rejected cell batches). The latter reports contain
all raw intervals and exact UTC capture times. Temporary scripts/configurations remain in
that ignored directory; the temporary renderer hooks and baseline copy were removed.

Supplementary hardware check: full Chromium (`channel: 'chromium'`, no flags) actually uses
ANGLE NVIDIA RTX 4070 SUPER / Direct3D 11. The complete stationary T62 workflow passed in
55.2 s with the same viewport, camera, sample lengths, local assertion and functional shots.
2D pairs were 31.2544 / 31.2500 and 31.2533 / 31.2544 ms (aggregate +0.0053%); 3D pairs
31.5956 / 31.2478 and 31.2500 / 31.2567 ms (aggregate +0.5457%). Most frame-interval
standard deviations were 0.25–0.28 ms; the first 3D on window had a 3.28 ms deviation.
All samples contain 90 render submissions for 90 intervals. This backend dependence supports
an unresolved SwiftShader cost, rather than a generally slow stationary renderer; it does
not replace the authoritative default Playwright gate or establish the moving T64 hardware
result. Hardware window: 21:11:01.809–21:11:58.320 UTC. Artifacts: `hardware-results`,
`hardware-probe.json`, `hardware.config.ts`, `hardware.log`. Invocation:
`npx playwright test --config=test-results/task145/hardware.config.ts --grep 'T62 Munich rail layers' --workers=1`.
That ignored config extends the repository config, changes only the browser channel/project
and output paths, and uses the existing test-mode preview on 5345.

Verification of the final measurement-only change: `npm run check` passed (1,148 passed;
one skipped; typecheck, lint, formatting and build passed). The observer regression failed
before the boundary/drain correction and passed afterward. The lead repeated the named tests with one worker and local assertions enabled.

| GPU and camera | Rail on / off, ms | Difference |
|---|---|---|
| SwiftShader, T62 2D / 3D | 175.83 / 162.77; 237.49 / 207.21 | +8.02%; +14.61% |
| SwiftShader, T64 moving 2D | 176.66 / 162.12; 173.93 / 159.54 | +8.97%; +9.02% |
| SwiftShader, T64 moving 3D | 245.14 / 213.48; 244.84 / 215.14 | +14.83%; +13.80% |
| RTX 4070 SUPER, T64 moving 2D | 31.25 / 31.25 in both runs | within 0.01% |
| RTX 4070 SUPER, T64 moving 3D | 31.25 / 31.25; 31.25 / 31.82 | −0.01%; −1.80% |

The two default-backend 3D frame assertions failed. The other three default tests passed,
including the final-render regression and the Munich and Sindelfingen train interactions.
All three T64 hardware tests passed. The full-Chromium verification used the same test
build, timings, camera and thresholds. Artifacts on the audit workstation are under
`test-results/task145/lead-final-results` and `test-results/task145/hardware-moving-results`.
