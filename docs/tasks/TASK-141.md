# TASK-141 — Diagnose the T54 Munich parking-motion failure

Reproduce the failing Munich case in `tests/e2e/T54-parking-motion.spec.ts` on current main.
Use `task/141-t54-diagnosis`, ports 5341/5441, and isolated test output. Trace the first divergence
between the controlled scenario and what the engine and browser actually show. Identify the
facility, trip and simulation time where applicable. Distinguish a stale test assumption from
a product defect using a focused countercheck. Report the command, assertion, evidence, relevant
source locations and smallest corrective change. Keep experimental instrumentation local and
leave production code and expectations intact. The lead records the diagnosis and allocates
any follow-up once its file surface is known.
