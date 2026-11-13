import type { DiagramLayout, LayoutEdge, LayoutNode, ModelDef } from './types.js';

interface Rect { x: number; y: number; w: number; h: number }

function overlaps(a: Rect, b: Rect, pad = 14) {
  return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
}

function pushApart(nodes: LayoutNode[]) {
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const A = nodes[i], B = nodes[j];
        const ra = { x: A.x, y: A.y, w: A.width, h: A.height };
        const rb = { x: B.x, y: B.y, w: B.width, h: B.height };
        if (overlaps(ra, rb)) {
          const dx = (A.x + A.width / 2) - (B.x + B.width / 2);
          const dy = (A.y + A.height / 2) - (B.y + B.height / 2);
          if (Math.abs(dx) < Math.abs(dy) || Math.abs(dy) < 1) {
            B.y += (dy <= 0 ? 1 : -1) * (A.height / 2 + B.height / 2 + 18);
          } else {
            B.x += (dx <= 0 ? 1 : -1) * (A.width / 2 + B.width / 2 + 18);
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

export function autoLayout(model: ModelDef): DiagramLayout {
  const stocks = model.stocks ?? [];
  const flows = model.flows ?? [];
  const auxs = model.auxiliaries ?? [];
  const params = model.parameters ?? [];

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  const stockW = 130, stockH = 64;
  const flowW = 90, flowH = 34;
  const smallW = 100, smallH = 36;

  // Stocks in a row
  const stockPos = new Map<string, { x: number; y: number }>();
  stocks.forEach((s, i) => {
    const x = 80 + i * 280;
    const y = 220;
    stockPos.set(s.name, { x, y });
    nodes.push({ id: s.name, type: 'stock', x, y, width: stockW, height: stockH });
  });

  // Flows positioned relative to connected stocks
  const flowCountBetween = new Map<string, number>();
  flows.forEach((f) => {
    let x = 120 + nodes.length * 40;
    let y = 235;
    if (f.from && f.to && stockPos.has(f.from) && stockPos.has(f.to)) {
      const a = stockPos.get(f.from)!; const b = stockPos.get(f.to)!;
      const key = [f.from, f.to].sort().join('->');
      const n = (flowCountBetween.get(key) ?? 0);
      flowCountBetween.set(key, n + 1);
      x = (a.x + stockW + b.x) / 2 - flowW / 2;
      y = 235 + n * 50;
    } else if (f.from && stockPos.has(f.from)) {
      const a = stockPos.get(f.from)!; x = a.x + stockW + 40; y = 235;
      // source cloud
      if (!nodes.find(n => n.id === `cloud_src_${f.name}`)) {
        nodes.push({ id: `cloud_src_${f.name}`, type: 'cloud', x: a.x - 90, y: 235, width: 50, height: 30 });
      }
      edges.push({ from: `cloud_src_${f.name}`, to: f.name, type: 'flow' });
    } else if (f.to && stockPos.has(f.to)) {
      const b = stockPos.get(f.to)!; x = b.x - flowW - 40; y = 235;
      if (!nodes.find(n => n.id === `cloud_sink_${f.name}`)) {
        nodes.push({ id: `cloud_sink_${f.name}`, type: 'cloud', x: b.x + stockW + 40, y: 235, width: 50, height: 30 });
      }
      edges.push({ from: f.name, to: `cloud_sink_${f.name}`, type: 'flow' });
    } else {
      const idx = flows.indexOf(f);
      x = 100 + (idx % 4) * 170; y = 320 + Math.floor(idx / 4) * 60;
    }
    nodes.push({ id: f.name, type: 'flow', x, y, width: flowW, height: flowH });
    if (f.from) edges.push({ from: f.from, to: f.name, type: 'flow' });
    if (f.to) edges.push({ from: f.name, to: f.to, type: 'flow' });
  });

  // Auxiliaries/parameters above
  const tops = [
    ...params.map(p => ({ name: p.name, type: 'parameter' as const })),
    ...auxs.map(a => ({ name: a.name, type: 'auxiliary' as const })),
  ];
  tops.forEach((a, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    nodes.push({ id: a.name, type: a.type, x: 60 + col * 170, y: 30 + row * 55, width: smallW, height: smallH });
  });

  pushApart(nodes);

  // ensure non-negative coords
  const minX = Math.min(...nodes.map(n => n.x), 0);
  const minY = Math.min(...nodes.map(n => n.y), 0);
  if (minX < 20 || minY < 20) {
    for (const n of nodes) { n.x += (20 - minX); n.y += (20 - minY); }
  }

  const width = Math.max(900, ...nodes.map(n => n.x + n.width + 40));
  const height = Math.max(420, ...nodes.map(n => n.y + n.height + 40));
  return { nodes, edges, width, height };
}
