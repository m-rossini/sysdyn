import { parseJSON, parseYAML, toJSON, toYAML, type SysDynConfig } from '@sysdyn/core';

export interface StoredModel {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  yaml: string;
  createdAt: string;
  updatedAt: string;
  builtin?: boolean;
}

export interface ModelStore {
  list(): StoredModel[];
  get(id: string): StoredModel | undefined;
  save(m: StoredModel): void;
  remove(id: string): void;
  duplicate(id: string): StoredModel | undefined;
  importText(text: string, filename?: string): StoredModel;
}

const STORAGE_KEY = 'sysdyn.models.v1';
const STORAGE_VERSION = 1;

interface PersistedShape {
  version: number;
  models: StoredModel[];
}

/** Raw YAML shipped with the repository, keyed by the id declared in the file. */
export const builtinSeeds: StoredModel[] = [];

const seedFiles = import.meta.glob('../../../models/*.yaml', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as unknown as Record<string, string>;

function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function stripExtension(filename: string): string {
  return filename.replace(/\.(ya?ml|json)$/i, '');
}

export function parseAny(text: string): SysDynConfig {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('The model source is empty.');
  return trimmed.startsWith('{') ? parseJSON(trimmed) : parseYAML(trimmed);
}

function titleFromId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeStoredModel(value: unknown): StoredModel | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !v.id.trim()) return null;
  if (typeof v.yaml !== 'string') return null;
  const fallback = nowIso();
  return {
    id: v.id.trim(),
    title: typeof v.title === 'string' && v.title.trim() ? v.title : v.id.trim(),
    description: typeof v.description === 'string' ? v.description : undefined,
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === 'string') : undefined,
    yaml: v.yaml,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : fallback,
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : fallback,
    builtin: v.builtin === true,
  };
}

function buildBuiltinSeeds(): StoredModel[] {
  const seeds: StoredModel[] = [];
  const seen = new Set<string>();
  for (const [path, text] of Object.entries(seedFiles)) {
    const filename = path.split('/').pop() ?? path;
    const fallbackId = slugify(stripExtension(filename)) || 'model';
    let id = fallbackId;
    let title = titleFromId(fallbackId);
    let description: string | undefined;
    try {
      const config = parseYAML(text);
      if (config.model.id && config.model.id.trim()) id = config.model.id.trim();
      title = config.model.title?.trim() || titleFromId(id);
      description = config.model.description;
    } catch {
      // A malformed builtin still gets seeded so it can be opened and fixed.
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const stamp = nowIso();
    seeds.push({
      id,
      title,
      description,
      tags: [],
      yaml: text,
      createdAt: stamp,
      updatedAt: stamp,
      builtin: true,
    });
  }
  // Stable order so the library is not reshuffled by filesystem iteration order.
  seeds.sort((a, b) => a.title.localeCompare(b.title));
  return seeds;
}

builtinSeeds.push(...buildBuiltinSeeds());

export function getBuiltinSeed(id: string): StoredModel | undefined {
  return builtinSeeds.find(m => m.id === id);
}

export const NEW_MODEL_YAML = `version: "1"
model:
  id: new-model
  title: New model
  description: A minimal stock-and-flow starter. Edit the source or use the guided builder.
  time:
    start: 0
    stop: 20
    dt: 0.5
  parameters:
    - name: rate
      value: 2
      unit: units/week
      concept: parameter
  stocks:
    - name: stock
      initial: 10
      unit: units
      inflows: [inflow]
      outflows: [outflow]
      concept: stock
  flows:
    - name: inflow
      equation: "rate"
      to: stock
      unit: units/week
      concept: flow
    - name: outflow
      equation: "stock * 0.05"
      from: stock
      unit: units/week
      concept: flow
  auxiliaries: []
`;

function safeLocalStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    const probe = '__sysdyn_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export class LocalModelStore implements ModelStore {
  private models: StoredModel[] = [];
  private readonly storage: Storage | null;

  constructor(storage: Storage | null = safeLocalStorage()) {
    this.storage = storage;
    this.load();
  }

  private load(): void {
    let dirty = false;
    const raw = this.storage?.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const shape = parsed as Partial<PersistedShape>;
          if (shape.version === STORAGE_VERSION && Array.isArray(shape.models)) {
            this.models = shape.models
              .map(normalizeStoredModel)
              .filter((m): m is StoredModel => m !== null);
          } else {
            dirty = true;
          }
        } else {
          dirty = true;
        }
      } catch {
        dirty = true;
      }
    }

    // Idempotent seed merge: add missing builtins, never overwrite stored models.
    const known = new Set(this.models.map(m => m.id));
    const stamp = nowIso();
    for (const seed of builtinSeeds) {
      if (known.has(seed.id)) continue;
      this.models.push({ ...seed, createdAt: stamp, updatedAt: stamp });
      known.add(seed.id);
      dirty = true;
    }

    if (dirty) this.persist();
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const payload: PersistedShape = { version: STORAGE_VERSION, models: this.models };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota errors / private mode: keep the in-memory store usable.
    }
  }

  private uniqueId(base: string): string {
    const root = slugify(base) || 'model';
    if (!this.get(root)) return root;
    let n = 2;
    while (this.get(`${root}-${n}`)) n += 1;
    return `${root}-${n}`;
  }

  list(): StoredModel[] {
    return [...this.models];
  }

  get(id: string): StoredModel | undefined {
    return this.models.find(m => m.id === id);
  }

  save(m: StoredModel): void {
    const index = this.models.findIndex(x => x.id === m.id);
    if (index >= 0) this.models[index] = m;
    else this.models.push(m);
    this.persist();
  }

  remove(id: string): void {
    const before = this.models.length;
    this.models = this.models.filter(m => m.id !== id);
    if (this.models.length !== before) this.persist();
  }

  duplicate(id: string): StoredModel | undefined {
    const source = this.get(id);
    if (!source) return undefined;
    const newId = this.uniqueId(`${source.id}-copy`);
    const title = `${source.title} (copy)`;
    const stamp = nowIso();
    const copy: StoredModel = {
      ...source,
      id: newId,
      title,
      tags: source.tags ? [...source.tags] : undefined,
      createdAt: stamp,
      updatedAt: stamp,
      builtin: false,
    };
    try {
      const config = parseAny(source.yaml);
      config.model.id = newId;
      config.model.title = title;
      copy.yaml = toYAML(config);
    } catch {
      // Keep the broken source verbatim; the copy can still be edited.
    }
    this.models.push(copy);
    this.persist();
    return copy;
  }

  importText(text: string, filename?: string): StoredModel {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('The imported file is empty.');
    const config = trimmed.startsWith('{') ? parseJSON(trimmed) : parseYAML(trimmed);
    const fromFile = filename ? slugify(stripExtension(filename)) : '';
    const base = config.model.id?.trim() || fromFile || slugify(config.model.title ?? '') || 'model';
    const id = this.uniqueId(base);
    config.model.id = id;
    if (!config.model.title?.trim()) config.model.title = titleFromId(id);
    const stamp = nowIso();
    const model: StoredModel = {
      id,
      title: config.model.title,
      description: config.model.description,
      yaml: toYAML(config),
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.models.push(model);
    this.persist();
    return model;
  }
}

/** Convenience for the "Export JSON" action: canonical JSON for the stored YAML. */
export function modelToJSON(yaml: string): string {
  return toJSON(parseAny(yaml));
}
