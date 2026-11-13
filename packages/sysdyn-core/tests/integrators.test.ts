import { describe, it, expect } from 'vitest';
import { simulate, parseYAML } from '../src/index.js';

describe('integrators', () => {
  it('euler integrates linear growth', () => {
    const config = parseYAML(`
version: "1"
model:
  time: { start: 0, stop: 10, dt: 1 }
  stocks:
    - { name: s, initial: 0, inflows: [f] }
  flows:
    - { name: f, equation: "2", to: s }
`);
    const r = simulate(config, { integrator: 'euler' });
    expect(r.integrator).toBe('euler');
    expect(r.series[r.series.length - 1].values.s).toBeCloseTo(20, 6);
  });

  it('rk4 is more accurate than euler for exponential decay', () => {
    const model = {
      version: '1',
      model: {
        time: { start: 0, stop: 5, dt: 1 },
        stocks: [{ name: 's', initial: 1, outflows: ['f'] }],
        flows: [{ name: 'f', equation: 's', from: 's' }],
      }
    } as any;
    const e = simulate(model, { integrator: 'euler' });
    const r = simulate(model, { integrator: 'rk4' });
    const exact = Math.exp(-5);
    const eEnd = e.series[e.series.length - 1].values.s;
    const rEnd = r.series[r.series.length - 1].values.s;
    expect(Math.abs(rEnd - exact)).toBeLessThan(Math.abs(eEnd - exact));
  });

  it('downgrades rk4 to euler for stateful primitives and warns', () => {
    const config = parseYAML(`
version: "1"
model:
  time: { start: 0, stop: 5, dt: 1 }
  auxiliaries:
    - { name: a, equation: "smooth(10, 2, 0)" }
`);
    const r = simulate(config, { integrator: 'rk4' });
    expect(r.integrator).toBe('euler');
    expect(r.warnings?.some(w => /downgraded/i.test(w))).toBe(true);
  });
});
