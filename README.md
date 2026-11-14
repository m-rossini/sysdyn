# sysdyn

A generic, configurable system dynamics engine plus a web app for presenting and managing a library of models.

## Structure

- `packages/sysdyn-core` — DOM-free TypeScript library: config parsing/validation (YAML/JSON), math.js expressions, SD primitives, simulation engine (Euler/RK4), dependency ordering, semantic validation, auto-layout, and concept help metadata.
- `packages/sysdyn-demo` — standalone web app (Vite + vanilla TS + Chart.js): model library, per-model workspace with a dashboard (playback, diagram, time series) and an editor (YAML + guided builder).
- `models/` — canonical model library as human-editable YAML. Seeded into the web app on first run.

### Built-in models

| Model | File | What it shows |
| --- | --- | --- |
| Inventory with Reorder Pulse (`inventory`) | `models/inventory.yaml` | Stock/flow with a periodic `pulse` replenishment and a `step` demand increase. |
| High-Performance Team (`hp-teams`) | `models/hp-teams.yaml` | Nine stocks: delivery system (backlog, WIP, delivered, capability, energy, tech debt) plus the people layer — staff with J-curve hiring, slow-build/fast-collapse trust, team cohesion. See `ROADMAP.md` for the v1–v4 ladder. |

## Web app

The app is a small framework, not a single hardcoded demo:

- `#/models` — **model library**: cards with metadata, search, new/import/duplicate/export/delete.
- `#/models/<id>` — **workspace**: `Dashboard` (default) and `Edit` tabs.

The dashboard provides stock KPI cards, a single Play/Pause toggle, Reset to `t = 0`, step controls, 0.5×–2× playback, a scrubber, the auto-laid-out stock-and-flow diagram (tank fill and flow thickness track the current values; dashed arrows are information links, and selecting an element highlights its links), and a time-series chart with a current-time cursor. The `?` icons expose concept help for stocks, flows, auxiliaries, parameters and equations.

The edit tab holds the YAML source (canonical, autosaved after 600 ms), `Parse & Run`, the guided builder, YAML/JSON export and file import.

Models live in `localStorage` under `sysdyn.models.v1` behind a `ModelStore` interface (`packages/sysdyn-demo/src/store.ts`), so a backend store can replace the local one without touching the views. Built-ins are seeded from a raw YAML glob (`models/*.yaml`): dropping a new file into `models/` publishes a new library entry with no code changes, and seeding never overwrites user edits.

## Quick start (container-only, via Make)

```bash
make test-core   # run core tests in container
make demo        # foreground dev app at http://localhost:5173
make demo-image  # foreground app from baked image
make up          # start app via compose (detached)
make down        # stop/remove compose app containers
```

Use `PORT=5174 make up` (or `demo`/`demo-image`) if 5173 is already allocated. All build/test/run operations are executed in containers.

## Model config

Models are YAML (or JSON) with `model.time`, `parameters`, `stocks`, `flows`, and `auxiliaries`. Equations use [math.js](https://mathjs.org/) syntax and engine primitives such as `step`, `pulse`, `ramp`, `delay`, `smooth`, `delay1`, `delay3`, `trend`, and `rand`. Auxiliaries and flows are evaluated in dependency order; reference cycles and unknown variables are reported as validation errors.

```yaml
version: "1"
model:
  id: example
  title: Example
  time: { start: 0, stop: 40, dt: 0.5, unit: week }
  parameters:
    - { name: rate, value: 2, unit: units/week, concept: parameter }
  stocks:
    - { name: tank, initial: 10, unit: units, inflows: [inflow], outflows: [outflow], concept: stock }
  flows:
    - { name: inflow, equation: "rate * step(1, 10)", to: tank, unit: units/week, concept: flow }
    - { name: outflow, equation: "tank * 0.05", from: tank, unit: units/week, concept: flow }
```

## Using the library

```ts
import { parseYAML, simulate, autoLayout, toYAML, validateConfig } from '@sysdyn/core';

const config = parseYAML(yamlText);          // or parseJSON / loadConfigFromText
const issues = validateConfig(config);       // semantic errors and warnings
const result = simulate(config, { integrator: 'euler' });
const layout = autoLayout(result.config.model);
```

## Notes

- The app runs as a Vite dev server inside the container (`0.0.0.0:5173`), exposed via port mapping/compose.
- Use `make down` to stop the compose-managed stack. If a non-compose container occupies the port, stop it with your container runtime (e.g. `docker stop <name>` / `docker rm -f <name>`).
