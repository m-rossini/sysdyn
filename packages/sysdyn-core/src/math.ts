import { create, all, type MathJsStatic } from 'mathjs';

const math = create(all, {});

export interface EvalContext {
  t: number;
  dt: number;
  [name: string]: number | ((...args: number[]) => number);
}

export function createMathScope(base: Record<string, number | ((...args: number[]) => number)> = {}) {
  return { ...base };
}

export function compileExpression(expr: string) {
  const node = math.parse(expr);
  const code = node.compile();
  return {
    evaluate(scope: EvalContext): number {
      const v = code.evaluate(scope as any);
      if (typeof v === 'number') return v;
      if (v && typeof v.toNumber === 'function') return v.toNumber();
      if (typeof v === 'boolean') return v ? 1 : 0;
      throw new Error(`Expression "${expr}" did not evaluate to a number`);
    },
  };
}

export function safeEvaluate(expr: string, scope: EvalContext): number {
  return compileExpression(expr).evaluate(scope);
}

export { math };
