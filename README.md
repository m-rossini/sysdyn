# sysdyn

A generic, configurable system dynamics engine and demo UI.

## Structure

- `packages/sysdyn-core` — DOM-free TypeScript library: config parsing/validation (YAML/JSON), math.js expressions, SD primitives, simulation engine (Euler/RK4), auto-layout, and concept help metadata.
- `packages/sysdyn-demo` — standalone web demo (Vite + vanilla TS + Chart.js) for loading configs, stepping simulation (0.5x–2x), and visualizing stock-flow diagram + time series.
- `config/examples` — sample model configurations.

## Quick start (container-only, via Make)

```bash
make test-core   # run core tests in container
make demo        # foreground dev demo at http://localhost:5173
make demo-image  # foreground demo from baked image
make up          # start demo via compose (detached)
make down        # stop/remove compose demo containers
```

Use `PORT=5174 make up` (or `demo`/`demo-image`) if 5173 is already allocated. All build/test/run operations are executed in containers.

## Config

Models are defined as YAML or JSON with `model.time`, `parameters`, `stocks`, `flows`, and `auxiliaries`. Equations use [math.js](https://mathjs.org/) syntax and engine primitives like `step`, `pulse`, `ramp`, `delay`, `smooth`, and `rand`.

## Notes

- Demo runs as a Vite dev server inside the container (`0.0.0.0:5173`) and is exposed via port mapping/compose.
- Use `make down` to stop the compose-managed demo stack. If a non-compose container is occupying the port, stop it with your container runtime (e.g. `docker stop <name>` / `docker rm -f <name>`).
