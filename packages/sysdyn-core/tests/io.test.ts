import { describe, it, expect } from 'vitest';
import { parseJSON, parseYAML, loadConfigFromText, toJSON, toYAML, validateConfig, simulate } from '../src/index.js';

const base = {
  version: '1',
  model: {
    time: { start: 0, stop: 10, dt: 1 },
    parameters: [{ name: 'a', value: 1 }],
    stocks: [{ name: 's', initial: 0, inflows: ['f'] }],
    flows: [{ name: 'f', equation: 'a', to: 's' }],
  }
};

describe('io and validation', () => {
  it('parses JSON/YAML and roundtrips', () => {
    const j = JSON.stringify(base);
    const c1 = parseJSON(j);
    expect(c1.model.stocks![0].name).toBe('s');
    const y = toYAML(c1);
    const c2 = parseYAML(y);
    expect(c2.model.flows![0].equation).toBe('a');
    const c3 = loadConfigFromText(j);
    const c4 = loadConfigFromText(y);
    expect(c3.model.time.stop).toBe(10);
    expect(c4.model.time.dt).toBe(1);
    expect(JSON.parse(toJSON(c1)).model.time.start).toBe(0);
  });

  it('detects invalid time and duplicates', () => {
    const badDt = validateConfig({ model: { time: { start: 0, stop: 10, dt: 0 } } } as any);
    expect(badDt.some(i => i.level === 'error')).toBe(true);
    const dup = validateConfig({
      model: {
        time: { start: 0, stop: 1, dt: 1 },
        stocks: [{ name: 'x', initial: 1 }],
        flows: [{ name: 'x', equation: '1' }],
      }
    } as any);
    expect(dup.some(i => /Duplicate name/.test(i.message))).toBe(true);
  });

  it('detects unknown flow endpoints and unknown variables', () => {
    const issues = validateConfig({
      model: {
        time: { start: 0, stop: 1, dt: 1 },
        flows: [{ name: 'f', equation: 'missing', to: 'nope' }],
      }
    } as any);
    expect(issues.some(i => /unknown to stock/.test(i.message))).toBe(true);
    expect(issues.some(i => /references unknown variable/.test(i.message))).toBe(true);
  });

  it('simulate throws on semantic errors when validating', () => {
    expect(() => simulate({ model: { time: { start: 0, stop: 1, dt: 1 }, flows: [{ name: 'f', equation: 'x' }] } } as any)).toThrow();
  });
});
