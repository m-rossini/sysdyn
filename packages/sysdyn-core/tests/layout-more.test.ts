import { describe, it, expect } from 'vitest';
import { autoLayout } from '../src/index.js';

describe('layout', () => {
  const model = {
    time: { start: 0, stop: 1, dt: 1 },
    parameters: [{ name: 'p', value: 1 }],
    stocks: [
      { name: 'A', initial: 10, inflows: ['in'], outflows: ['transfer'] },
      { name: 'B', initial: 0, inflows: ['transfer'], outflows: ['out'] },
    ],
    flows: [
      { name: 'transfer', equation: 'p * A', from: 'A', to: 'B' },
      { name: 'in', equation: 'p', to: 'A' },
      { name: 'out', equation: 'A * 0.1', from: 'B' },
    ],
    auxiliaries: [
      { name: 'gap', equation: 'A - B' },
      { name: 'signal', equation: 'gap * p' },
    ],
  } as any;

  it('creates stock, flow and cloud nodes with structural flow edges', () => {
    const layout = autoLayout(model);

    expect(layout.nodes.some(n => n.id === 'A' && n.type === 'stock')).toBe(true);
    expect(layout.nodes.filter(n => n.type === 'cloud')).toHaveLength(2);

    const flowEdges = new Set(
      layout.edges.filter(e => e.type === 'flow').map(e => `${e.from}->${e.to}`),
    );
    expect(flowEdges.has('cloud:in:in->in')).toBe(true);
    expect(flowEdges.has('in->A')).toBe(true);
    expect(flowEdges.has('A->transfer')).toBe(true);
    expect(flowEdges.has('transfer->B')).toBe(true);
    expect(flowEdges.has('B->out')).toBe(true);
    expect(flowEdges.has('out->cloud:out:out')).toBe(true);
  });

  it('emits information links for equation dependencies', () => {
    const layout = autoLayout(model);
    const influences = layout.edges
      .filter(e => e.type === 'influence')
      .map(e => `${e.from}->${e.to}`);

    // Auxiliaries depend on stocks and parameters.
    expect(influences).toContain('A->gap');
    expect(influences).toContain('B->gap');
    expect(influences).toContain('gap->signal');
    expect(influences).toContain('p->signal');

    // A stock that already feeds one of its flows is not drawn twice.
    expect(influences).not.toContain('A->transfer');
    // Remaining equation dependencies on flows are still shown.
    expect(influences).toContain('p->transfer');
  });

  it('has no duplicate edges and only links existing nodes', () => {
    const layout = autoLayout(model);
    const keys = layout.edges.map(e => `${e.type}|${e.from}|${e.to}`);
    expect(new Set(keys).size).toBe(keys.length);

    const ids = new Set(layout.nodes.map(n => n.id));
    for (const edge of layout.edges) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
  });

  it('layers auxiliaries by dependency depth', () => {
    const layout = autoLayout(model);
    const gap = layout.nodes.find(n => n.id === 'gap')!;
    const signal = layout.nodes.find(n => n.id === 'signal')!;
    const param = layout.nodes.find(n => n.id === 'p')!;
    expect(param.y).toBeLessThan(gap.y);
    expect(gap.y).toBeLessThan(signal.y);
  });

  it('never overlaps nodes', () => {
    const layout = autoLayout(model);
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        const overlap = !(
          a.x + a.width + 8 <= b.x ||
          b.x + b.width + 8 <= a.x ||
          a.y + a.height + 8 <= b.y ||
          b.y + b.height + 8 <= a.y
        );
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });
});
