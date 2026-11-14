import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseYAML, simulate, validateConfig } from '../src/index.js';

const MODELS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'models');
const FILES = readdirSync(MODELS_DIR).filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).sort();

describe('models ladder', () => {
  it('discovers at least the inventory and hp-teams versions', () => {
    expect(FILES).toContain('inventory.yaml');
    expect(FILES).toContain('hp-teams.yaml');
  });

  for (const file of FILES) {
    it(`${file} parses clean and simulates finite end to end`, () => {
      const config = parseYAML(readFileSync(join(MODELS_DIR, file), 'utf8'));
      const errors = validateConfig(config).filter(i => i.level === 'error');
      expect(errors).toEqual([]);
      const result = simulate(config);
      expect(result.series.length).toBeGreaterThan(1);
      const end = result.series[result.series.length - 1].values;
      for (const [name, value] of Object.entries(end)) {
        expect(Number.isFinite(value), `${file}: ${name} is not finite: ${value}`).toBe(true);
      }
    });
  }
});
