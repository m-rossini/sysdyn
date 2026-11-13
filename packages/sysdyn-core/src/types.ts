export type PrimitiveName =
  | 'delay'
  | 'smooth'
  | 'pulse'
  | 'step'
  | 'rand'
  | 'delay1'
  | 'delay3'
  | 'trend'
  | 'ramp';

export interface TimeConfig {
  start: number;
  stop: number;
  dt: number;
  unit?: string;
}

export interface ParameterDef {
  name: string;
  value: number;
  unit?: string;
  description?: string;
  concept?: string;
}

export interface StockDef {
  name: string;
  initial: number | string;
  unit?: string;
  inflows?: string[];
  outflows?: string[];
  description?: string;
  concept?: string;
}

export interface FlowDef {
  name: string;
  equation: string;
  from?: string;
  to?: string;
  unit?: string;
  description?: string;
  concept?: string;
}

export interface AuxiliaryDef {
  name: string;
  equation: string;
  unit?: string;
  description?: string;
  concept?: string;
}

export interface ConceptDef {
  id: string;
  name: string;
  summary: string;
  whenToUse?: string;
  examples?: string[];
  references?: string[];
  mathNotes?: string;
}

export interface ModelDef {
  id?: string;
  title?: string;
  description?: string;
  time: TimeConfig;
  parameters?: ParameterDef[];
  stocks?: StockDef[];
  flows?: FlowDef[];
  auxiliaries?: AuxiliaryDef[];
  concepts?: ConceptDef[];
}

export interface SysDynConfig {
  model: ModelDef;
  version?: string;
}

export interface SimulationPoint {
  t: number;
  values: Record<string, number>;
}

export interface SimulationResult {
  config: SysDynConfig;
  series: SimulationPoint[];
  variables: string[];
  integrator?: 'euler' | 'rk4';
  warnings?: string[];
}

export interface LayoutNode {
  id: string;
  type: 'stock' | 'flow' | 'auxiliary' | 'parameter' | 'cloud';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
  type: 'flow' | 'influence';
}

export interface DiagramLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}
