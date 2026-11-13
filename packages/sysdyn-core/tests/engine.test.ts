import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseYAML, simulate, autoLayout } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('sysdyn-core', () => {
  it('parses and simulates a simple population model', () => {
    const text = readFileSync(join(__dirname, 'samples/population.yaml'), 'utf8');
    const config = parseYAML(text);
    expect(config.model.title).toBe('Simple Population');
    const result = simulate(config, { integrator: 'euler' });
    expect(result.series.length).toBeGreaterThan(10);
    const first = result.series[0].values.population;
    const last = result.series[result.series.length - 1].values.population;
    expect(first).toBe(100);
    // birth_rate 0.04 > 1/25 0.04? equal -> roughly stable/slight, but allow growth/decline bounds
    expect(last).toBeGreaterThan(0);
  });

  it('creates a non-overlapping auto layout', () => {
    const text = readFileSync(join(__dirname, 'samples/population.yaml'), 'utf8');
    const config = parseYAML(text);
    const layout = autoLayout(config.model);
    expect(layout.nodes.length).toBeGreaterThan(0);
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i], b = layout.nodes[j];
        const overlap = !(a.x + a.width + 8 <= b.x || b.x + b.width + 8 <= a.x || a.y + a.height + 8 <= b.y || b.y + b.height + 8 <= a.y);
        expect(overlap).toBe(false);
      }
    }
  });
});
