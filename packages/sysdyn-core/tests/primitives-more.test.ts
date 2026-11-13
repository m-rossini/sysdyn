import { describe, it, expect } from 'vitest';
import { simulate, parseYAML } from '../src/index.js';

describe('more primitives', () => {
  it('ramp increases linearly and can stop', () => {
    const config = parseYAML(`
version: "1"
model:
  time: { start: 0, stop: 5, dt: 1 }
  auxiliaries:
    - { name: r1, equation: "ramp(2, 1)" }
    - { name: r2, equation: "ramp(2, 1, 3)" }
`);
    const r = simulate(config);
    const v = (i: number) => r.series[i].values;
    expect(v(0).r1).toBe(0);
    expect(v(1).r1).toBe(0);
    expect(v(2).r1).toBe(2);
    expect(v(4).r1).toBe(6);
    expect(v(4).r2).toBe(4); // capped at endTime 3
    expect(v(5).r2).toBe(4);
  });

  it('delay1 and delay3 respond and lag', () => {
    const config = parseYAML(`
version: "1"
model:
  time: { start: 0, stop: 20, dt: 1 }
  auxiliaries:
    - { name: inp, equation: "step(10, 2)" }
    - { name: d1, equation: "delay1(inp, 4, 0)" }
    - { name: d3, equation: "delay3(inp, 4, 0)" }
`);
    const r = simulate(config);
    const last = r.series[r.series.length - 1].values;
    expect(last.d1).toBeGreaterThan(7);
    expect(last.d3).toBeGreaterThan(7);
    // at mid time, third-order typically differs from first-order
    const mid = r.series[8].values;
    expect(mid.d1).not.toBe(mid.d3);
  });

  it('pulse with zero interval fires once', () => {
    const config = parseYAML(`
version: "1"
model:
  time: { start: 0, stop: 5, dt: 1 }
  stocks:
    - { name: s, initial: 0, inflows: [f] }
  flows:
    - { name: f, equation: "pulse(5, 2, 0)", to: s }
`);
    const r = simulate(config);
    const vals = r.series.map(p => p.values.s);
    expect(vals).toEqual([0,0,0,5,5,5]);
  });
});
