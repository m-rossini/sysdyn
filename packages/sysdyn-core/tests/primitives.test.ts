import { describe, it, expect } from 'vitest';
import { simulate, parseYAML } from '../src/index.js';

describe('primitives hardening', () => {
  it('step activates at and after step time', () => {
    const config = parseYAML(`
version: "1"
model:
  time: { start: 0, stop: 4, dt: 1 }
  stocks:
    - { name: s, initial: 0, inflows: [f] }
  flows:
    - { name: f, equation: "step(5, 2)", to: s }
`);
    const r = simulate(config);
    const vals = r.series.map(p => p.values.s);
    expect(vals[0]).toBe(0);
    expect(vals[1]).toBe(0);
    expect(vals[2]).toBe(0);
    expect(vals[3]).toBe(5);
    expect(vals[4]).toBe(10);
  });

  it('pulse injects volume at first pulse time and repeats with interval', () => {
    const config = parseYAML(`
version: "1"
model:
  time: { start: 0, stop: 6, dt: 1 }
  stocks:
    - { name: s, initial: 0, inflows: [f] }
  flows:
    - { name: f, equation: "pulse(3, 1, 2)", to: s }
`);
    const r = simulate(config);
    const vals = r.series.map(p => p.values.s);
    // pulses at t=1,3,5 add 3 at those steps (integrated over dt)
    expect(vals[0]).toBe(0);
    expect(vals[1]).toBe(0);
    expect(vals[2]).toBe(3);
    expect(vals[3]).toBe(3);
    expect(vals[4]).toBe(6);
    expect(vals[5]).toBe(6);
    expect(vals[6]).toBe(9);
  });

  it('smooth converges toward input', () => {
    const config = parseYAML(`
version: "1"
model:
  time: { start: 0, stop: 20, dt: 1 }
  auxiliaries:
    - { name: target, equation: "10" }
    - { name: sm, equation: "smooth(target, 4, 0)" }
`);
    const r = simulate(config);
    const last = r.series[r.series.length - 1].values.sm;
    expect(last).toBeGreaterThan(8);
    expect(last).toBeLessThanOrEqual(10.0001);
  });

  it('delay lags input', () => {
    const config = parseYAML(`
version: "1"
model:
  time: { start: 0, stop: 6, dt: 1 }
  auxiliaries:
    - { name: inp, equation: "step(10, 1)" }
    - { name: out, equation: "delay(inp, 2, 0)" }
`);
    const r = simulate(config);
    const out = r.series.map(p => p.values.out);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(10);
  });

  it('multiple stateful primitive instances do not collide', () => {
    const config = parseYAML(`
version: "1"
model:
  time: { start: 0, stop: 10, dt: 1 }
  auxiliaries:
    - { name: a, equation: "smooth(10, 2, 0)" }
    - { name: b, equation: "smooth(100, 2, 0)" }
    - { name: d1, equation: "delay(step(1,1), 2, 0)" }
    - { name: d2, equation: "delay(step(5,1), 3, 0)" }
`);
    const r = simulate(config);
    const last = r.series[r.series.length - 1].values;
    expect(last.a).toBeGreaterThan(5);
    expect(last.a).toBeLessThan(15);
    expect(last.b).toBeGreaterThan(50);
    expect(last.b).toBeLessThan(101);
    expect(last.b).toBeGreaterThan(last.a);
    expect(last.d2).not.toBe(last.d1);
  });
});
