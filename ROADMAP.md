# High-Performance Team — model roadmap

The `hp-teams` model grows one version at a time. Each version lives on its
own branch (`hp-teams-v1`, `hp-teams-v2`, …) so versions can be compared
side by side; `main` holds the latest finished version.

## v1 — parameters that climb (`hp-teams-v1`, merged to main)

Same 4 stocks (backlog, delivered, capability, energy). Fixes the flat v0:
incoming_rate 4→8, learning_rate 0.08→0.25, burnout_rate 0.2→0.25,
recovery_rate 0.05→0.04, focus denominator 40→20.
Measured: throughput 5.8→9.0, capacity 12→24, energy 60→48, backlog 80→72.

## v2 — WIP buffer + formal learning (`hp-teams-v2`)

- New stock `in_progress` between backlog and delivered. `start_work` pulls
  backlog into progress (throttled near 1.6× `wip_limit`); `finish_work`
  delivers from it. New `congestion` auxiliary penalizes finishing when WIP
  exceeds the limit — pushing more work in slows delivery (Little's law).
- New `training` flow into capability: formal learning investment
  (trainings, conferences, books, labs) via `training_share` (time diverted
  from delivery, lowers capacity) × `training_effectiveness` (quality of
  access). Slow-down-to-speed-up has an interior optimum (~10% beats 0%
  and 30% on cumulative delivery).
- Overload behavior: arrivals at 14 → WIP ~29, congestion 0.81, finishing
  below baseline while backlog explodes. The v2 lesson: starting more
  finishes less.

## v3 — technical debt (planned, `hp-teams-v3`)

New stock `tech_debt`: shortcuts under pressure accrue debt, debt consumes
capacity as rework, less capacity raises pressure. The failure mode of a
"high-performing" team. A cohesion term in the rework share is reserved
for v4.

## v4 — the people release (planned, `hp-teams-v4`)

Three slow stocks interacting:
- `staff` — hiring/attrition. Capability becomes a per-person average.
  The J-curve needs all three mechanisms: dilution (average drops),
  ramp delay (`smooth` on effective newcomers), mentoring load (seniors
  lose throughput teaching, so output dips before overshooting).
- `trust` — leadership confidence. Slow-build/fast-collapse asymmetric
  stock: kept commitments add a little, misses subtract a lot, visible
  burnout drains it. Gates `training_share` (low trust → "just deliver")
  and taxes capacity via autonomy overhead (reports, approvals).
- `cohesion` — social capital. Built by delivering together, burned by
  churn and pressure-conflict. Couplings: handoff loss → rework share,
  `training_effectiveness *= cohesion/100`, faster onboarding ramp.
  SD models the *level* of cohesion, not who-trusts-whom (that's ABM
  territory: key-person risk, silos).

Split is deliberate: v3 = the code rots, v4 = the team rots — or thrives.
