import { describe, it, expect } from 'vitest';
import { autoLayout } from '../src/index.js';

describe('layout', () => {
  it('creates nodes and flow edges including clouds for open flows', () => {
    const layout = autoLayout({
      time: { start: 0, stop: 1, dt: 1 },
      stocks: [{ name: 'A', initial: 1 }],
      flows: [
        { name: 'in', equation: '1', to: 'A' },
        { name: 'out', equation: '1', from: 'A' },
      ],
      auxiliaries: [{ name: 'x', equation: '1' }],
      parameters: [{ name: 'p', value: 1 }],
    } as any);
    expect(layout.nodes.some(n => n.id === 'A' && n.type === 'stock')).toBe(true);
    expect(layout.nodes.some(n => n.type === 'cloud')).toBe(true);
    expect(layout.edges.some(e => e.to === 'A' || e.from === 'A')).toBe(true);
    // no overlap
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i], b = layout.nodes[j];
        const overlap = !(a.x + a.width + 8 <= b.x || b.x + b.width + 8 <= a.x || a.y + a.height + 8 <= b.y || b.y + b.height + 8 <= a.y);
        expect(overlap).toBe(false);
      }
    }
  });
});
