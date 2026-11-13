import type { ModelDef, SysDynConfig, SimulationResult, SimulationPoint } from './types.js';
import { compileExpression } from './math.js';
import { instrumentStatefulCalls } from './expr.js';
import { createPrimitiveState, makePrimitiveFunctions, beginStep, commitStep } from './primitives.js';
import { validateConfig, extractDependencies, topoSort } from './analysis.js';

export type Integrator = 'euler' | 'rk4';

export interface SimOptions {
  integrator?: Integrator;
  validate?: boolean;
}

const STATEFUL_RE = /\b(delay|smooth|delay1|delay3|trend)\s*\(/i;

function hasStatefulPrimitives(model: ModelDef): boolean {
  const texts = [
    ...(model.flows ?? []).map(f => f.equation),
    ...(model.auxiliaries ?? []).map(a => a.equation),
    ...(model.stocks ?? []).map(s => String(s.initial ?? '')),
  ];
  return texts.some(t => STATEFUL_RE.test(t));
}

export function simulate(config: SysDynConfig, options: SimOptions = {}): SimulationResult {
  const model = config.model;
  const { start, stop, dt } = model.time;
  const warnings: string[] = [];
  let integrator = options.integrator ?? 'euler';

  if (options.validate !== false) {
    const issues = validateConfig(config);
    const errors = issues.filter(i => i.level === 'error');
    for (const w of issues.filter(i => i.level === 'warning')) warnings.push(w.message);
    if (errors.length) throw new Error(`Invalid model: ${errors.map(e => e.message).join('; ')}`);
  }

  if (!(dt > 0)) throw new Error('time.dt must be > 0');
  if (stop < start) throw new Error('time.stop must be >= time.start');
  if (integrator === 'rk4' && hasStatefulPrimitives(model)) {
    integrator = 'euler';
    warnings.push('RK4 integrator downgraded to Euler because model uses stateful primitives (delay/smooth/trend).');
  }

  const stocks = model.stocks ?? [];
  const flows = model.flows ?? [];
  const auxs = model.auxiliaries ?? [];
  const params = model.parameters ?? [];

  const stockNames = stocks.map(s => s.name);
  const paramNames = params.map(p => p.name);
  const variables = [...paramNames, ...stockNames, ...auxs.map(a => a.name), ...flows.map(f => f.name)];

  const auxByName = new Map(auxs.map(a => [a.name, a]));
  const flowByName = new Map(flows.map(f => [f.name, f]));
  const computableEqs = new Map<string, string>();
  for (const a of auxs) computableEqs.set(a.name, a.equation);
  for (const f of flows) computableEqs.set(f.name, f.equation);
  const depsAll = new Map<string, string[]>();
  for (const [name, eq] of computableEqs) depsAll.set(name, extractDependencies(eq));
  const globalOrderResult = topoSort(computableEqs.keys(), depsAll);
  if (globalOrderResult.cycle.length) {
    throw new Error(`Invalid model: cyclic dependency detected among ${globalOrderResult.cycle.join(', ')}`);
  }
  const globalOrder = globalOrderResult.order;
  const compiled = new Map<string, { kind: 'aux' | 'flow'; name: string; eval: { evaluate(scope: any): number } }>();
  for (const a of auxs) compiled.set(a.name, { kind: 'aux', name: a.name, eval: compileExpression(instrumentStatefulCalls(a.equation, `aux_${a.name}`)) });
  for (const f of flows) compiled.set(f.name, { kind: 'flow', name: f.name, eval: compileExpression(instrumentStatefulCalls(f.equation, `flow_${f.name}`)) });

  const primitiveState = createPrimitiveState();
  const tRef = { t: start, dt };
  const primitives = makePrimitiveFunctions(primitiveState, tRef);

  const state: Record<string, number> = {};
  for (const p of params) state[p.name] = p.value;
  for (const s of stocks) {
    const initExpr = s.initial;
    if (typeof initExpr === 'number') state[s.name] = initExpr;
    else {
      try { state[s.name] = compileExpression(instrumentStatefulCalls(String(initExpr), `init_${s.name}`)).evaluate({ ...primitives, ...state, t: start, dt, time: start } as any); }
      catch (e: any) {
        const n = Number(initExpr);
        if (Number.isFinite(n)) state[s.name] = n;
        else throw new Error(`Stock "${s.name}" has invalid initial value: ${initExpr}`);
      }
    }
  }

  const series: SimulationPoint[] = [];

  function evaluateAll(current: Record<string, number>, t: number, stepIndex: number): { derivs: Record<string, number>; snapshot: Record<string, number> } {
    beginStep(primitiveState, stepIndex);
    tRef.t = t;
    const scope: any = { ...primitives, ...current, t, dt, time: t };
    const snapshot: Record<string, number> = { ...current };
    for (const name of globalOrder) {
      const c = compiled.get(name);
      if (!c) continue;
      const v = c.eval.evaluate(scope);
      scope[name] = v;
      snapshot[name] = v;
    }
    const derivs: Record<string, number> = {};
    for (const s of stocks) derivs[s.name] = 0;
    for (const f of flows) {
      const v = snapshot[f.name] ?? 0;
      if (f.to) derivs[f.to] = (derivs[f.to] ?? 0) + v;
      if (f.from) derivs[f.from] = (derivs[f.from] ?? 0) - v;
    }
    commitStep(primitiveState);
    return { derivs, snapshot };
  }

  let t = start;
  let stepIndex = 0;
  {
    const { snapshot } = evaluateAll({ ...state }, t, stepIndex);
    series.push({ t, values: { ...snapshot } });
  }

  const steps = Math.round((stop - start) / dt);
  for (let i = 0; i < steps; i++) {
    if (integrator === 'euler') {
      const { derivs } = evaluateAll({ ...state }, t, stepIndex);
      const nextState = { ...state };
      for (const s of stocks) {
        nextState[s.name] = (state[s.name] ?? 0) + (derivs[s.name] ?? 0) * dt;
      }
      // copy non-stock state carriers remain params; stocks updated
      for (const n of stockNames) state[n] = nextState[n];
      t = +(start + (i + 1) * dt).toPrecision(12);
      stepIndex = i + 1;
      const end = evaluateAll({ ...state }, t, stepIndex);
      series.push({ t: Math.min(t, stop), values: { ...end.snapshot } });
    } else {
      // RK4 without stateful primitives
      const evalAt = (st: Record<string, number>, time: number) => {
        tRef.t = time;
        const scope: any = { ...primitives, ...st, t: time, dt, time };
        for (const name of globalOrder) {
          const c = compiled.get(name);
          if (!c) continue;
          scope[name] = c.eval.evaluate(scope);
        }
        const d: Record<string, number> = {};
        for (const s of stocks) d[s.name] = 0;
        for (const f of flows) {
          const v = scope[f.name] ?? 0;
          if (f.to) d[f.to] = (d[f.to] ?? 0) + v;
          if (f.from) d[f.from] = (d[f.from] ?? 0) - v;
        }
        return d;
      };
      const s0 = { ...state };
      const k1 = evalAt(s0, t);
      const s1: Record<string, number> = { ...s0 }; for (const n of stockNames) s1[n] = s0[n] + (k1[n] ?? 0) * dt / 2;
      const k2 = evalAt(s1, t + dt / 2);
      const s2: Record<string, number> = { ...s0 }; for (const n of stockNames) s2[n] = s0[n] + (k2[n] ?? 0) * dt / 2;
      const k3 = evalAt(s2, t + dt / 2);
      const s3: Record<string, number> = { ...s0 }; for (const n of stockNames) s3[n] = s0[n] + (k3[n] ?? 0) * dt;
      const k4 = evalAt(s3, t + dt);
      for (const n of stockNames) {
        state[n] = s0[n] + (dt / 6) * ((k1[n] ?? 0) + 2 * (k2[n] ?? 0) + 2 * (k3[n] ?? 0) + (k4[n] ?? 0));
      }
      t = +(start + (i + 1) * dt).toPrecision(12);
      stepIndex = i + 1;
      const end = evaluateAll({ ...state }, t, stepIndex);
      series.push({ t: Math.min(t, stop), values: { ...end.snapshot } });
    }
  }

  return { config, series, variables, integrator, warnings: warnings.length ? warnings : undefined };
}
