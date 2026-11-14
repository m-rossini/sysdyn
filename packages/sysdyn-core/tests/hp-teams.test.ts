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

  it('has the expected v3 structure and all four feedback loops', () => {
    const config = loadModel();
    expect(config.model.stocks).toHaveLength(6);
    expect(config.model.flows).toHaveLength(9);
    expect(config.model.auxiliaries).toHaveLength(7);
    expect(config.model.parameters).toHaveLength(12);

    // Pull loop: start_work fills in_progress, finish_work drains it.
    expect(stock(config, 'in_progress').inflows).toContain('start_work');
    expect(stock(config, 'in_progress').outflows).toContain('finish_work');
    expect(stock(config, 'backlog').outflows).toContain('start_work');
    expect(dependenciesOf(config, 'start_work')).toContain('backlog');
    expect(dependenciesOf(config, 'start_work')).toContain('in_progress');
    expect(dependenciesOf(config, 'finish_work')).toContain('effective_throughput');

    // Congestion loop: excess WIP slows finishing.
    expect(dependenciesOf(config, 'congestion')).toContain('in_progress');
    expect(dependenciesOf(config, 'effective_throughput')).toContain('congestion');

    // Debt loop:
    // pressure -> debt_accrual -> tech_debt -> rework_share ->
    // effective_throughput -> finish_work -> (queue) -> pressure
    expect(stock(config, 'tech_debt').inflows).toContain('debt_accrual');
    expect(stock(config, 'tech_debt').outflows).toContain('debt_paydown');
    expect(dependenciesOf(config, 'debt_accrual')).toContain('finish_work');
    expect(dependenciesOf(config, 'debt_accrual')).toContain('schedule_pressure');
    expect(dependenciesOf(config, 'schedule_pressure')).toContain('backlog');
    expect(dependenciesOf(config, 'schedule_pressure')).toContain('finish_work');
    expect(dependenciesOf(config, 'rework_share')).toContain('tech_debt');
    expect(dependenciesOf(config, 'effective_throughput')).toContain('rework_share');
    expect(dependenciesOf(config, 'debt_paydown')).toContain('tech_debt');

    // Reinforcing loop:
    // finish_work -> learning -> capability -> capacity -> effective_throughput -> finish_work
    expect(stock(config, 'capability').inflows).toContain('learning');
    expect(stock(config, 'capability').inflows).toContain('training');
    expect(dependenciesOf(config, 'learning')).toContain('finish_work');
    expect(dependenciesOf(config, 'learning')).toContain('capability');
    expect(dependenciesOf(config, 'training')).toContain('training_share');
    expect(dependenciesOf(config, 'training')).toContain('training_effectiveness');
    expect(dependenciesOf(config, 'capacity')).toContain('training_share');
    expect(dependenciesOf(config, 'capacity')).toContain('capability');
    expect(dependenciesOf(config, 'effective_throughput')).toContain('capacity');
    expect(dependenciesOf(config, 'finish_work')).toContain('effective_throughput');

    // Balancing loop:
    // finish_work -> burnout -> energy -> energy_factor -> effective_throughput
    expect(stock(config, 'energy').outflows).toContain('burnout');
    expect(dependenciesOf(config, 'burnout')).toContain('finish_work');
    expect(dependenciesOf(config, 'energy_factor')).toContain('energy');
    expect(dependenciesOf(config, 'effective_throughput')).toContain('energy_factor');
  });

  it('produces sensible dynamics across the horizon', () => {
    const config = loadModel();
    const result = simulate(config);
    const first = result.series[0].values;
    const last = finalValues(result);

    // Delivered work never decreases (flat while the empty pipeline fills),
    // and grows net across the horizon.
    for (let i = 1; i < result.series.length; i++) {
      expect(result.series[i].values.delivered).toBeGreaterThanOrEqual(
        result.series[i - 1].values.delivered,
      );
    }
    expect(last.delivered).toBeGreaterThan(first.delivered);

    // Capability improves and the WIP buffer fills.
    expect(last.capability).toBeGreaterThan(first.capability);
    expect(last.in_progress).toBeGreaterThan(first.in_progress);

    // Finishing ramps up as the pipeline fills and capability grows.
    expect(last.finish_work).toBeGreaterThan(first.finish_work);

    // Backlog, WIP and debt never cross zero, energy stays on its 0-100
    // scale, and congestion/rework stay valid (0, 1] penalties.
    let minCongestion = Infinity;
    for (const point of result.series) {
      expect(point.values.backlog).toBeGreaterThanOrEqual(-1e-9);
      expect(point.values.in_progress).toBeGreaterThanOrEqual(-1e-9);
      expect(point.values.tech_debt).toBeGreaterThanOrEqual(-1e-9);
      expect(point.values.energy).toBeGreaterThanOrEqual(0);
      expect(point.values.energy).toBeLessThanOrEqual(100);
      expect(point.values.congestion).toBeGreaterThan(0);
      expect(point.values.congestion).toBeLessThanOrEqual(1);
      expect(point.values.rework_share).toBeGreaterThanOrEqual(0);
      expect(point.values.rework_share).toBeLessThan(1);
      minCongestion = Math.min(minCongestion, point.values.congestion);
    }

    // Debt stays managed (no runaway) while remaining visible.
    expect(last.tech_debt).toBeLessThan(60);
    expect(last.rework_share).toBeLessThan(0.5);

    // The congestion mechanism engages (WIP pushes past the limit mid-run)
    // and WIP settles near the limit, inside the throttle band.
    expect(minCongestion).toBeLessThan(1);
    expect(last.in_progress).toBeGreaterThan(15);
    expect(last.in_progress).toBeLessThan(25);
  });

  it('rewards moderate training but punishes over-investment', () => {
    const baseline = simulate(loadModel());

    const none = loadModel();
    none.model.parameters!.find(p => p.name === 'training_share')!.value = 0;
    const noneResult = simulate(none);

    const heavy = loadModel();
    heavy.model.parameters!.find(p => p.name === 'training_share')!.value = 0.3;
    const heavyResult = simulate(heavy);

    // 10% training time beats both 0% and 30% on cumulative delivery:
    // the optimum is interior (slow down to speed up, but not too much).
    expect(finalValues(baseline).delivered).toBeGreaterThan(finalValues(noneResult).delivered);
    expect(finalValues(baseline).delivered).toBeGreaterThan(finalValues(heavyResult).delivered);
    // ...and on end capability versus no training.
    expect(finalValues(baseline).capability).toBeGreaterThan(finalValues(noneResult).capability);
  });

  it('punishes overload: surging arrivals slow finishing', () => {
    const baseline = simulate(loadModel());

    const surge = loadModel();
    surge.model.parameters!.find(p => p.name === 'incoming_rate')!.value = 14;
    const surgeResult = simulate(surge);

    const baseEnd = finalValues(baseline);
    const surgeEnd = finalValues(surgeResult);

    // More arrivals pile into WIP, congestion deepens, finishing degrades,
    // and the debt loop spins up: higher pressure accrues more debt, which
    // consumes capacity as rework.
    expect(surgeEnd.in_progress).toBeGreaterThan(baseEnd.in_progress);
    expect(surgeEnd.congestion).toBeLessThan(baseEnd.congestion);
    expect(surgeEnd.finish_work).toBeLessThan(baseEnd.finish_work);
    expect(surgeEnd.backlog).toBeGreaterThan(baseEnd.backlog);
    expect(surgeEnd.tech_debt).toBeGreaterThan(baseEnd.tech_debt);
    expect(surgeEnd.rework_share).toBeGreaterThan(baseEnd.rework_share);
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
