import type { ConceptDef } from './types.js';

export const builtinConcepts: ConceptDef[] = [
  {
    id: 'stock',
    name: 'Stock (Level)',
    summary: 'An accumulation that changes over time through inflows and outflows.',
    whenToUse: 'Use for anything that builds up or drains: inventory, cash, population, trust, backlog.',
    examples: ['Inventory on hand', 'Installed base', 'Employee headcount'],
    references: ['Jay W. Forrester, Industrial Dynamics', 'John D. Sterman, Business Dynamics, Ch. 6'],
    mathNotes: 'stock(t+dt) = stock(t) + (inflows - outflows) * dt'
  },
  {
    id: 'flow',
    name: 'Flow (Rate)',
    summary: 'A rate of change that fills or drains a stock per unit time.',
    whenToUse: 'Use for activities that move material or information into/out of stocks.',
    examples: ['Sales per week', 'Hiring rate', 'Revenue per month'],
    references: ['Sterman, Business Dynamics, Ch. 6'],
    mathNotes: 'Flows are evaluated from current state and integrated over dt.'
  },
  {
    id: 'auxiliary',
    name: 'Auxiliary Variable',
    summary: 'An intermediate calculation used to clarify equations and structure.',
    whenToUse: 'Use to break complex flow equations into readable parts.',
    examples: ['Desired inventory', 'Pressure ratio', 'Utilization'],
  },
  {
    id: 'parameter',
    name: 'Parameter (Constant)',
    summary: 'A fixed value for a simulation run that can be changed between scenarios.',
    whenToUse: 'Use for assumptions, policy levers, or constants like delay time or target level.',
    examples: ['Reorder point', 'Average lifetime', 'Growth rate'],
  },
  {
    id: 'delay',
    name: 'Material Delay',
    summary: 'Delays the flow of material; output lags input by an average delay time while conserving material.',
    whenToUse: 'Use when items take time to move through a process (shipping, production, onboarding).',
    examples: ['Order fulfillment delay', 'Construction time'],
    mathNotes: 'Engine primitive: delay(input, delayTime, order, initial). Conserves mass.'
  },
  {
    id: 'information_delay',
    name: 'Information Delay',
    summary: 'Delays perception of information without conserving a physical flow.',
    whenToUse: 'Use for reporting lags, perception, or smoothed signals.',
    examples: ['Perceived sales trend', 'Reporting lag'],
    mathNotes: 'Often modeled with smooth()/delay information functions.'
  },
  {
    id: 'smooth',
    name: 'Smooth (Exponential Averaging)',
    summary: 'First-order exponential smoothing of an input over an averaging time.',
    whenToUse: 'Use to represent gradual adjustment of expectations or perceptions.',
    examples: ['Expected demand', 'Perceived quality'],
    mathNotes: 'smooth(input, averagingTime, initial) — equivalent to a first-order information delay.'
  },
  {
    id: 'pulse',
    name: 'Pulse',
    summary: 'Generates a pulse input at a specified time, with optional interval and volume.',
    whenToUse: 'Use to test system response to shocks or one-time events.',
    examples: ['Marketing campaign spike', 'One-time order'],
    mathNotes: 'pulse(volume, firstPulse, interval) returns volume/dt during pulse steps.'
  },
  {
    id: 'step',
    name: 'Step',
    summary: 'Changes value from 0 to a height at a specified step time.',
    whenToUse: 'Use for permanent policy changes or sustained shocks.',
    examples: ['Price increase at month 6', 'Capacity added'],
    mathNotes: 'step(height, stepTime).'
  },
  {
    id: 'ramp',
    name: 'Ramp',
    summary: 'Increases linearly starting at a time with a given slope.',
    whenToUse: 'Use for gradually increasing inputs like ramping demand.',
    mathNotes: 'ramp(slope, startTime, endTime).'
  },
  {
    id: 'equation',
    name: 'Equation (math.js)',
    summary: 'Expressions are evaluated with math.js using current variable values.',
    whenToUse: 'Use standard math: + - * / ^, parentheses, and functions like min, max, exp, log, sqrt.',
    examples: ['birth_rate * population', 'max(0, desired - actual)', 'smooth(demand, 4)'],
    mathNotes: 'Available: stocks, flows, auxiliaries, parameters, and t (time). Use engine primitives: delay, smooth, pulse, step, rand, ramp.',
    references: ['math.js expression syntax: https://mathjs.org/docs/expressions/syntax.html']
  },
];

export function resolveConcepts(extra: ConceptDef[] = []): Map<string, ConceptDef> {
  const map = new Map<string, ConceptDef>();
  for (const c of builtinConcepts) map.set(c.id, c);
  for (const c of extra) map.set(c.id, c);
  return map;
}
