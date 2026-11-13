import type { DiagramLayout, LayoutEdge, LayoutNode, ModelDef } from './types.js';
import { extractDependencies } from './analysis.js';

const STOCK_W = 112;
const STOCK_H = 56;
const FLOW_W = 96;
const FLOW_H = 30;
const NODE_W = 108;
const NODE_H = 30;
const CLOUD_W = 44;
const CLOUD_H = 24;
const STOCK_PITCH = 240;
const ROW_PITCH = 48;
const MARGIN = 32;
const COL_GAP = 20;

function spreadOffset(index: number, total: number): number {
  if (total <= 1) return 0;
  return (index - (total - 1) / 2) * (FLOW_W + 18);
}

/**
 * Layout in five bands, top to bottom:
 *   parameters -> auxiliary layers (by dependency depth) ->
 *   inflow flows + clouds -> stocks -> outflow flows + clouds.
 *
 * Auxiliaries are layered by their dependency chains so the causal reading
 * order is top-down, and every equation dependency becomes an `influence`
 * edge (rendered as a dashed information link).
 */
export function autoLayout(model: ModelDef): DiagramLayout {
  const stocks = model.stocks ?? [];
  const flows = model.flows ?? [];
  const auxs = model.auxiliaries ?? [];
  const params = model.parameters ?? [];

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (from: string, to: string, type: LayoutEdge['type']) => {
    if (!from || !to || from === to) return;
    const key = `${type}|${from}|${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, type });
  };

  // --- auxiliary layering -------------------------------------------------
  const auxEq = new Map(auxs.map(a => [a.name, a.equation]));
  const auxDeps = new Map<string, string[]>();
  for (const a of auxs) {
    auxDeps.set(a.name, extractDependencies(a.equation).filter(dep => auxEq.has(dep)));
  }

  const depthCache = new Map<string, number>();
  const depthOf = (name: string, stack: Set<string>): number => {
    const cached = depthCache.get(name);
    if (cached !== undefined) return cached;
    if (stack.has(name)) return 0;
    stack.add(name);
    let depth = 0;
    for (const dep of auxDeps.get(name) ?? []) {
      depth = Math.max(depth, 1 + depthOf(dep, stack));
    }
    stack.delete(name);
    depthCache.set(name, depth);
    return depth;
  };

  const rows: Array<{ type: 'parameter' | 'auxiliary'; names: string[] }> = [];
  if (params.length) rows.push({ type: 'parameter', names: params.map(p => p.name) });
  const auxLayers: Array<{ type: 'auxiliary'; names: string[] }> = [];
  for (const a of auxs) {
    const layer = 1 + depthOf(a.name, new Set());
    while (auxLayers.length < layer) auxLayers.push({ type: 'auxiliary', names: [] });
    auxLayers[layer - 1].names.push(a.name);
  }
  rows.push(...auxLayers.filter(row => row.names.length));

  const rowWidth = (count: number) => (count ? count * NODE_W + (count - 1) * COL_GAP : 0);
  const stockRowWidth = stocks.length
    ? stocks.length * STOCK_W + (stocks.length - 1) * (STOCK_PITCH - STOCK_W)
    : 0;
  const widestRow = rows.reduce((max, row) => Math.max(max, rowWidth(row.names.length)), 0);
  const width = Math.max(900, stockRowWidth + 2 * MARGIN, widestRow + 2 * MARGIN);

  // --- vertical bands -----------------------------------------------------
  const cloudInY = MARGIN + rows.length * ROW_PITCH;
  const flowInY = cloudInY + CLOUD_H + 36;
  const stockY = flowInY + FLOW_H + 62;
  const flowOutY = stockY + STOCK_H + 62;
  const cloudOutY = flowOutY + FLOW_H + 36;
  const height = cloudOutY + CLOUD_H + MARGIN;

  // --- parameter / auxiliary rows ----------------------------------------
  rows.forEach((row, index) => {
    const total = rowWidth(row.names.length);
    const startX = Math.max(MARGIN, (width - total) / 2);
    row.names.forEach((name, column) => {
      nodes.push({
        id: name,
        type: row.type,
        x: startX + column * (NODE_W + COL_GAP),
        y: MARGIN + index * ROW_PITCH,
        width: NODE_W,
        height: NODE_H,
      });
    });
  });

  // --- stocks -------------------------------------------------------------
  const stockStartX = Math.max(MARGIN, (width - stockRowWidth) / 2);
  const stockPos = new Map<string, { x: number; y: number; index: number }>();
  stocks.forEach((stock, index) => {
    const x = stockStartX + index * STOCK_PITCH;
    stockPos.set(stock.name, { x, y: stockY, index });
    nodes.push({ id: stock.name, type: 'stock', x, y: stockY, width: STOCK_W, height: STOCK_H });
  });

  // --- flows --------------------------------------------------------------
  const inTotals = new Map<string, number>();
  const outTotals = new Map<string, number>();
  const transferTotals = new Map<string, number>();
  for (const flow of flows) {
    const fromStock = flow.from ? stockPos.get(flow.from) : undefined;
    const toStock = flow.to ? stockPos.get(flow.to) : undefined;
    if (flow.to && toStock && !fromStock) inTotals.set(flow.to, (inTotals.get(flow.to) ?? 0) + 1);
    if (flow.from && fromStock && !toStock) outTotals.set(flow.from, (outTotals.get(flow.from) ?? 0) + 1);
    if (fromStock && toStock) {
      const key = [flow.from, flow.to].sort().join('|');
      transferTotals.set(key, (transferTotals.get(key) ?? 0) + 1);
    }
  }

  const inSeen = new Map<string, number>();
  const outSeen = new Map<string, number>();
  const transferSeen = new Map<string, number>();
  let cloudOnlyIndex = 0;

  for (const flow of flows) {
    const fromStock = flow.from ? stockPos.get(flow.from) : undefined;
    const toStock = flow.to ? stockPos.get(flow.to) : undefined;

    if (fromStock && toStock) {
      // Stock -> stock transfer: sit in the gap between adjacent stocks.
      const key = [flow.from, flow.to].sort().join('|');
      const seen = transferSeen.get(key) ?? 0;
      transferSeen.set(key, seen + 1);
      const left = fromStock.x <= toStock.x ? fromStock : toStock;
      const adjacent = Math.abs(fromStock.index - toStock.index) === 1;
      let x: number;
      let y: number;
      if (adjacent && seen === 0) {
        x = left.x + STOCK_W + (STOCK_PITCH - STOCK_W - FLOW_W) / 2;
        y = stockY + (STOCK_H - FLOW_H) / 2;
      } else {
        x = (fromStock.x + toStock.x) / 2 + (STOCK_W - FLOW_W) / 2 + seen * (FLOW_W + 16);
        y = flowInY;
      }
      nodes.push({ id: flow.name, type: 'flow', x, y, width: FLOW_W, height: FLOW_H });
      addEdge(flow.from!, flow.name, 'flow');
      addEdge(flow.name, flow.to!, 'flow');
      continue;
    }

    if (toStock && !fromStock) {
      // Inflow from a cloud above the stock.
      const total = inTotals.get(flow.to!) ?? 1;
      const seen = inSeen.get(flow.to!) ?? 0;
      inSeen.set(flow.to!, seen + 1);
      const centerX = toStock.x + STOCK_W / 2 + spreadOffset(seen, total);
      const cloudId = `cloud:in:${flow.name}`;
      nodes.push({ id: flow.name, type: 'flow', x: centerX - FLOW_W / 2, y: flowInY, width: FLOW_W, height: FLOW_H });
      nodes.push({ id: cloudId, type: 'cloud', x: centerX - CLOUD_W / 2, y: cloudInY, width: CLOUD_W, height: CLOUD_H });
      addEdge(cloudId, flow.name, 'flow');
      addEdge(flow.name, flow.to!, 'flow');
      continue;
    }

    if (fromStock && !toStock) {
      // Outflow to a cloud below the stock.
      const total = outTotals.get(flow.from!) ?? 1;
      const seen = outSeen.get(flow.from!) ?? 0;
      outSeen.set(flow.from!, seen + 1);
      const centerX = fromStock.x + STOCK_W / 2 + spreadOffset(seen, total);
      const cloudId = `cloud:out:${flow.name}`;
      nodes.push({ id: flow.name, type: 'flow', x: centerX - FLOW_W / 2, y: flowOutY, width: FLOW_W, height: FLOW_H });
      nodes.push({ id: cloudId, type: 'cloud', x: centerX - CLOUD_W / 2, y: cloudOutY, width: CLOUD_W, height: CLOUD_H });
      addEdge(flow.from!, flow.name, 'flow');
      addEdge(flow.name, cloudId, 'flow');
      continue;
    }

    // Cloud-to-cloud flow (no stock endpoints).
    const x = MARGIN + cloudOnlyIndex * (FLOW_W + 40);
    cloudOnlyIndex += 1;
    const sourceId = `cloud:src:${flow.name}`;
    const sinkId = `cloud:sink:${flow.name}`;
    nodes.push({ id: sourceId, type: 'cloud', x, y: flowOutY, width: CLOUD_W, height: CLOUD_H });
    nodes.push({ id: flow.name, type: 'flow', x: x + CLOUD_W + 16, y: flowOutY, width: FLOW_W, height: FLOW_H });
    nodes.push({ id: sinkId, type: 'cloud', x: x + CLOUD_W + 16 + FLOW_W + 16, y: flowOutY, width: CLOUD_W, height: CLOUD_H });
    addEdge(sourceId, flow.name, 'flow');
    addEdge(flow.name, sinkId, 'flow');
  }

  // --- information links --------------------------------------------------
  const known = new Set(nodes.map(node => node.id));
  const structural = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.type !== 'flow') continue;
    let targets = structural.get(edge.from);
    if (!targets) structural.set(edge.from, (targets = new Set()));
    targets.add(edge.to);
  }
  const flowByName = new Map(flows.map(flow => [flow.name, flow]));

  for (const def of [...auxs, ...flows]) {
    const flowDef = flowByName.get(def.name);
    for (const dep of extractDependencies(def.equation)) {
      if (!known.has(dep)) continue;
      // A stock feeding one of its own flows is already drawn as a flow edge.
      const flowEdge = flowDef && (flowDef.from === dep || flowDef.to === dep);
      if (flowEdge && structural.get(dep)?.has(def.name)) continue;
      addEdge(dep, def.name, 'influence');
    }
  }

  return { nodes, edges, width, height };
}
