import yaml from 'js-yaml';
import { z } from 'zod';
import type { SysDynConfig } from './types.js';

const timeSchema = z.object({
  start: z.number(),
  stop: z.number(),
  dt: z.number().positive(),
  unit: z.string().optional(),
});

const parameterSchema = z.object({
  name: z.string(),
  value: z.number(),
  unit: z.string().optional(),
  description: z.string().optional(),
  concept: z.string().optional(),
});

const stockSchema = z.object({
  name: z.string(),
  initial: z.union([z.number(), z.string()]),
  unit: z.string().optional(),
  inflows: z.array(z.string()).optional(),
  outflows: z.array(z.string()).optional(),
  description: z.string().optional(),
  concept: z.string().optional(),
});

const flowSchema = z.object({
  name: z.string(),
  equation: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  unit: z.string().optional(),
  description: z.string().optional(),
  concept: z.string().optional(),
});

const auxSchema = z.object({
  name: z.string(),
  equation: z.string(),
  unit: z.string().optional(),
  description: z.string().optional(),
  concept: z.string().optional(),
});

const conceptSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  whenToUse: z.string().optional(),
  examples: z.array(z.string()).optional(),
  references: z.array(z.string()).optional(),
  mathNotes: z.string().optional(),
});

const modelSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  time: timeSchema,
  parameters: z.array(parameterSchema).optional(),
  stocks: z.array(stockSchema).optional(),
  flows: z.array(flowSchema).optional(),
  auxiliaries: z.array(auxSchema).optional(),
  concepts: z.array(conceptSchema).optional(),
});

export const configSchema = z.object({
  version: z.string().optional(),
  model: modelSchema,
});

export function parseConfig(input: unknown): SysDynConfig {
  return configSchema.parse(input) as SysDynConfig;
}

export { validateConfig } from './analysis.js';

export function parseJSON(text: string): SysDynConfig {
  return parseConfig(JSON.parse(text));
}

export function parseYAML(text: string): SysDynConfig {
  const data = yaml.load(text);
  return parseConfig(data);
}

export function toJSON(config: SysDynConfig, pretty = true): string {
  return JSON.stringify(config, null, pretty ? 2 : 0);
}

export function toYAML(config: SysDynConfig): string {
  return yaml.dump(config, { noRefs: true, lineWidth: 120 });
}

export function loadConfigFromText(text: string, format?: 'json' | 'yaml'): SysDynConfig {
  const fmt = format ?? (text.trim().startsWith('{') ? 'json' : 'yaml');
  return fmt === 'json' ? parseJSON(text) : parseYAML(text);
}
