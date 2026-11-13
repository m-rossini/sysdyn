import { parse } from 'mathjs';
import type { ModelDef, SysDynConfig } from './types.js';

const BUILTINS = new Set([
  't','time','dt','pi','e','PI','E','true','false','null','undefined',
  'step','pulse','ramp','delay','smooth','rand','delay1','delay3','trend',
  'STEP','PULSE','RAMP','DELAY','SMOOTH','DELAY1','DELAY3','TREND','RAND',
  'min','max','abs','sqrt','exp','log','log10','sin','cos','tan','pow','mod','floor','ceil','round',
  'if','and','or','not','sign','pow',
]);

export function extractDependencies(expr: string): string[] {
  try {
    const node = parse(expr);
    const deps = new Set<string>();
    node.traverse((n: any, _path: string, parent: any) => {
      if (n.isSymbolNode) {
        const name = n.name;
        // Skip function names in function calls
        if (parent && parent.isFunctionNode && parent.fn === n) return;
        // mathjs may represent function name differently
        if (parent && parent.isFunctionNode && parent.name === name && parent.args?.length >= 0) {
          // could be function symbol; but safer: include only if not builtin function in call position
        }
        if (!BUILTINS.has(name)) deps.add(name);
      }
    });
    // remove function names that appear as fn of FunctionNode
    node.traverse((n: any) => {
      if (n.isFunctionNode) {
        const fnName = n.fn?.name ?? n.name;
        if (fnName) deps.delete(fnName);
      }
    });
    return Array.from(deps);
  } catch {
    return [];
  }
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

export function validateConfig(config: SysDynConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const model = config.model;
  const { start, stop, dt } = model.time || ({} as any);
  if (!(dt > 0)) issues.push({ level: 'error', message: 'model.time.dt must be > 0' });
  if (!(stop >= start)) issues.push({ level: 'error', message: 'model.time.stop must be >= model.time.start' });

  const params = model.parameters ?? [];
  const stocks = model.stocks ?? [];
  const flows = model.flows ?? [];
  const auxs = model.auxiliaries ?? [];

  const allNames = new Map<string, string>();
  const addName = (name: string, kind: string) => {
    if (!name) { issues.push({ level: 'error', message: `${kind} has empty name` }); return; }
    if (allNames.has(name)) issues.push({ level: 'error', message: `Duplicate name "${name}" (${allNames.get(name)} and ${kind})` });
    else allNames.set(name, kind);
  };
  for (const p of params) addName(p.name, 'parameter');
  for (const s of stocks) addName(s.name, 'stock');
  for (const f of flows) addName(f.name, 'flow');
  for (const a of auxs) addName(a.name, 'auxiliary');

  const stockSet = new Set(stocks.map(s => s.name));
  const flowSet = new Set(flows.map(f => f.name));

  for (const f of flows) {
    if (f.from && !stockSet.has(f.from)) issues.push({ level: 'error', message: `Flow "${f.name}" references unknown from stock "${f.from}"` });
    if (f.to && !stockSet.has(f.to)) issues.push({ level: 'error', message: `Flow "${f.name}" references unknown to stock "${f.to}"` });
    if (!f.from && !f.to) issues.push({ level: 'warning', message: `Flow "${f.name}" has no from/to (cloud-to-cloud)` });
    try { parse(f.equation); } catch (e: any) { issues.push({ level: 'error', message: `Flow "${f.name}" has invalid equation: ${e.message ?? e}` }); }
  }
  for (const a of auxs) {
    try { parse(a.equation); } catch (e: any) { issues.push({ level: 'error', message: `Auxiliary "${a.name}" has invalid equation: ${e.message ?? e}` }); }
  }
  for (const s of stocks) {
    for (const inf of s.inflows ?? []) {
      if (!flowSet.has(inf)) issues.push({ level: 'error', message: `Stock "${s.name}" inflow "${inf}" is not a known flow` });
      else {
        const fd = flows.find(f => f.name === inf);
        if (fd && fd.to && fd.to !== s.name) issues.push({ level: 'warning', message: `Stock "${s.name}" lists inflow "${inf}" but flow.to is "${fd.to}"` });
        if (fd && !fd.to) issues.push({ level: 'warning', message: `Stock "${s.name}" lists inflow "${inf}" but flow.to is not set` });
      }
    }
    for (const outf of s.outflows ?? []) {
      if (!flowSet.has(outf)) issues.push({ level: 'error', message: `Stock "${s.name}" outflow "${outf}" is not a known flow` });
      else {
        const fd = flows.find(f => f.name === outf);
        if (fd && fd.from && fd.from !== s.name) issues.push({ level: 'warning', message: `Stock "${s.name}" lists outflow "${outf}" but flow.from is "${fd.from}"` });
        if (fd && !fd.from) issues.push({ level: 'warning', message: `Stock "${s.name}" lists outflow "${outf}" but flow.from is not set` });
      }
    }
  }
  // flows implied by from/to should appear in stock lists (warning)
  for (const f of flows) {
    if (f.to) {
      const st = stocks.find(s => s.name === f.to);
      if (st && !(st.inflows ?? []).includes(f.name)) issues.push({ level: 'warning', message: `Flow "${f.name}" flows into stock "${f.to}" but is not listed in its inflows` });
    }
    if (f.from) {
      const st = stocks.find(s => s.name === f.from);
      if (st && !(st.outflows ?? []).includes(f.name)) issues.push({ level: 'warning', message: `Flow "${f.name}" flows out of stock "${f.from}" but is not listed in its outflows` });
    }
  }

  // dependency graph for aux+flows
  const computables = new Map<string, string>();
  for (const a of auxs) computables.set(a.name, a.equation);
  for (const f of flows) computables.set(f.name, f.equation);
  const available = new Set<string>([...params.map(p => p.name), ...stocks.map(s => s.name), 't', 'time', 'dt']);
  const depsMap = new Map<string, string[]>();
  for (const [name, eq] of computables) {
    const deps = extractDependencies(eq).filter(d => d !== name);
    depsMap.set(name, deps);
    for (const d of deps) {
      if (!available.has(d) && !computables.has(d)) {
        issues.push({ level: 'error', message: `Equation for "${name}" references unknown variable "${d}"` });
      }
    }
  }
  // cycle detection via topo sort attempt
  const order = topoSort(computables.keys(), depsMap);
  if (order.cycle.length) {
    issues.push({ level: 'error', message: `Cyclic dependency detected among: ${order.cycle.join(', ')}` });
  }
  // forward references in declared order (info/warning when not naturally ordered) - but we will auto-order
  return issues;
}

export function topoSort(names: Iterable<string>, depsMap: Map<string, string[]>): { order: string[]; cycle: string[] } {
  const nameSet = new Set(names);
  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const n of nameSet) { indeg.set(n, 0); out.set(n, []); }
  for (const n of nameSet) {
    for (const d of depsMap.get(n) ?? []) {
      if (nameSet.has(d)) {
        indeg.set(n, (indeg.get(n) ?? 0) + 1);
        out.get(d)!.push(n);
      }
    }
  }
  const q: string[] = [];
  for (const [n, d] of indeg) if (d === 0) q.push(n);
  q.sort();
  const order: string[] = [];
  while (q.length) {
    const n = q.shift()!;
    order.push(n);
    for (const m of out.get(n) ?? []) {
      indeg.set(m, (indeg.get(m) ?? 1) - 1);
      if (indeg.get(m) === 0) { q.push(m); q.sort(); }
    }
  }
  const cycle = Array.from(nameSet).filter(n => !order.includes(n));
  return { order, cycle };
}

export function getEvaluationOrder(model: ModelDef): { aux: string[]; flows: string[]; issues: ValidationIssue[] } {
  const auxs = model.auxiliaries ?? [];
  const flows = model.flows ?? [];
  const computables = new Map<string, string>();
  for (const a of auxs) computables.set(a.name, a.equation);
  for (const f of flows) computables.set(f.name, f.equation);
  const depsMap = new Map<string, string[]>();
  for (const [name, eq] of computables) depsMap.set(name, extractDependencies(eq));
  const { order, cycle } = topoSort(computables.keys(), depsMap);
  const issues: ValidationIssue[] = [];
  if (cycle.length) issues.push({ level: 'error', message: `Cyclic dependency detected among: ${cycle.join(', ')}` });
  const auxSet = new Set(auxs.map(a => a.name));
  const flowSet = new Set(flows.map(f => f.name));
  const auxOrder = order.filter(n => auxSet.has(n));
  const flowOrder = order.filter(n => flowSet.has(n));
  // append any missing (cycles) in declared order to allow error reporting elsewhere
  for (const a of auxs) if (!auxOrder.includes(a.name)) auxOrder.push(a.name);
  for (const f of flows) if (!flowOrder.includes(f.name)) flowOrder.push(f.name);
  return { aux: auxOrder, flows: flowOrder, issues };
}
