import { describe, it, expect } from 'vitest';
import { simulate, parseYAML } from '../src/index.js';

describe('dependency ordering', () => {
  it('evaluates auxiliaries/flows in dependency order, not declaration order', () => {
    const config = parseYAML(`
version: "1"
model:
  time: { start: 0, stop: 1, dt: 1 }
  auxiliaries:
    - { name: b, equation: "a + 1" }
    - { name: a, equation: "2" }
  flows:
    - { name: f2, equation: "f1 * 2", to: s }
    - { name: f1, equation: "b", to: s }
  stocks:
    - { name: s, initial: 0, inflows: [f1, f2] }
`);
    const r = simulate(config);
    const p = r.series[0].values;
    expect(p.a).toBe(2);
    expect(p.b).toBe(3);
    expect(p.f1).toBe(3);
    expect(p.f2).toBe(6);
  });

  it('detects cycles', () => {
    const config = parseYAML(`
version: "1"
model:
  time: { start: 0, stop: 1, dt: 1 }
  auxiliaries:
    - { name: a, equation: "b + 1" }
    - { name: b, equation: "a + 1" }
`);
    expect(() => simulate(config)).toThrow(/cyclic/i);
  });
});
