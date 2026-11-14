import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseYAML,
  validateConfig,
  simulate,
  extractDependencies,
} from '../src/index.js';
import type { SysDynConfig, SimulationResult } from '../src/index.js';

const MODEL_PATH = fileURLToPath(new URL('../../../models/hp-teams.yaml', import.meta.url));

function loadModel(): SysDynConfig {
  return parseYAML(readFileSync(MODEL_PATH, 'utf8'));
}

function finalValues(result: SimulationResult): Record<string, number> {
  return result.series[result.series.length - 1].values;
}

function definition(config: SysDynConfig, name: string) {
  const model = config.model;
  return [...(model.auxiliaries ?? []), ...(model.flows ?? [])].find(d => d.name === name);
}

function dependenciesOf(config: SysDynConfig, name: string): Set<string> {
  const def = definition(config, name);
  if (!def) throw new Error(`No auxiliary or flow named "${name}"`);
  return new Set(extractDependencies(def.equation));
}

function stock(config: SysDynConfig, name: string) {
  const found = (config.model.stocks ?? []).find(s => s.name === name);
  if (!found) throw new Error(`No stock named "${name}"`);
  return found;
}

describe('hp-teams model', () => {
  it('parses and validates with zero errors and zero warnings', () => {
    const config = loadModel();
    expect(config.model.id).toBe('hp-teams');
    expect(config.model.title).toContain('High-Performance Team');

    const issues = validateConfig(config);
    expect(issues.filter(i => i.level === 'error')).toEqual([]);
    expect(issues.filter(i => i.level === 'warning')).toEqual([]);
    expect(issues).toEqual([]);
  });

  it('simulates the full horizon with finite values', () => {
    const config = loadModel();
    const { start, stop, dt } = config.model.time;
    const result = simulate(config);
    expect(result.series.length).toBe(Math.floor((stop - start) / dt) + 1);
    expect(result.series[0].t).toBe(start);
    expect(result.series[result.series.length - 1].t).toBe(stop);

    const end = finalValues(result);
    for (const [name, value] of Object.entries(end)) {
      expect(Number.isFinite(value), `${name} is not finite: ${value}`).toBe(true);
    }
  });

  it('has the expected v0 structure and both feedback loops', () => {
    const config = loadModel();
    expect(config.model.stocks).toHaveLength(4);
    expect(config.model.flows).toHaveLength(5);
    expect(config.model.auxiliaries).toHaveLength(4);
    expect(config.model.parameters).toHaveLength(5);

    // Reinforcing loop:
    // throughput -> learning -> capability -> capacity -> effective_throughput -> throughput
    expect(stock(config, 'capability').inflows).toContain('learning');
    expect(dependenciesOf(config, 'learning')).toContain('throughput');
    expect(dependenciesOf(config, 'learning')).toContain('capability');
    expect(dependenciesOf(config, 'capacity')).toContain('capability');
    expect(dependenciesOf(config, 'effective_throughput')).toContain('capacity');
    expect(dependenciesOf(config, 'throughput')).toContain('effective_throughput');

    // Balancing loop:
    // throughput -> burnout -> energy -> energy_factor -> effective_throughput
    expect(stock(config, 'energy').outflows).toContain('burnout');
    expect(dependenciesOf(config, 'burnout')).toContain('throughput');
    expect(dependenciesOf(config, 'energy_factor')).toContain('energy');
    expect(dependenciesOf(config, 'effective_throughput')).toContain('energy_factor');
  });

  it('produces sensible dynamics across the horizon', () => {
    const config = loadModel();
    const result = simulate(config);
    const first = result.series[0].values;
    const last = finalValues(result);

    // Delivered work grows strictly at every recorded point.
    for (let i = 1; i < result.series.length; i++) {
      expect(result.series[i].values.delivered).toBeGreaterThan(
        result.series[i - 1].values.delivered,
      );
    }

    // Capability improves and backlog drains.
    expect(last.capability).toBeGreaterThan(first.capability);
    expect(last.backlog).toBeLessThan(first.backlog);

    // Backlog never crosses zero and energy stays on its 0-100 scale.
    for (const point of result.series) {
      expect(point.values.backlog).toBeGreaterThanOrEqual(-1e-9);
      expect(point.values.energy).toBeGreaterThanOrEqual(0);
      expect(point.values.energy).toBeLessThanOrEqual(100);
    }
  });

  it('responds to incoming_rate and base_capacity as expected', () => {
    const baseline = simulate(loadModel());

    const moreIncoming = loadModel();
    moreIncoming.model.parameters!.find(p => p.name === 'incoming_rate')!.value = 10;
    const moreIncomingResult = simulate(moreIncoming);

    const moreCapacity = loadModel();
    moreCapacity.model.parameters!.find(p => p.name === 'base_capacity')!.value = 40;
    const moreCapacityResult = simulate(moreCapacity);

    expect(finalValues(moreIncomingResult).backlog).toBeGreaterThan(
      finalValues(baseline).backlog,
    );
    expect(finalValues(moreCapacityResult).delivered).toBeGreaterThan(
      finalValues(baseline).delivered,
    );
  });

  it('is deterministic across runs', () => {
    const config = loadModel();
    const a = finalValues(simulate(config));
    const b = finalValues(simulate(config));
    expect(a).toEqual(b);
  });
});
