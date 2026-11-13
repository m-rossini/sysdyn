import { parse } from 'mathjs';

// Inject stable unique keys into stateful primitive calls so multiple instances don't collide.
const STATEFUL = new Set(['delay', 'DELAY', 'delay1', 'DELAY1', 'delay3', 'DELAY3', 'smooth', 'SMOOTH', 'trend', 'TREND']);

export function instrumentStatefulCalls(expr: string, keyPrefix = 'k'): string {
  try {
    const node = parse(expr);
    let i = 0;
    const transformed = node.transform((n: any) => {
      if (n.isFunctionNode && STATEFUL.has(n.fn?.name ?? n.name)) {
        const fnName = n.fn?.name ?? n.name;
        const lower = String(fnName).toLowerCase();
        const args = n.args.map((a: any) => a.toString());
        if ((lower === 'smooth' || lower.startsWith('delay') || lower === 'trend') && args.length < 4) {
          while (args.length < 3) args.push('undefined');
          args.push(`"__${lower}_${keyPrefix}_${i++}"`);
          return parse(`${fnName}(${args.join(', ')})`);
        }
        i++;
      }
      return n;
    });
    return transformed.toString();
  } catch {
    return expr;
  }
}
