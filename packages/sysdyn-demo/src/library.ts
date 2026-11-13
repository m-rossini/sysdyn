import { parseAny, NEW_MODEL_YAML, type ModelStore, type StoredModel } from './store';
import type { SysDynConfig } from '@sysdyn/core';
import { download, escapeHtml, timeAgo, toast } from './ui';

interface CardInfo {
  model: StoredModel;
  config?: SysDynConfig;
  error?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function inspect(model: StoredModel): CardInfo {
  try {
    return { model, config: parseAny(model.yaml) };
  } catch (error) {
    return { model, error: errorMessage(error) };
  }
}

function cardHtml(info: CardInfo): string {
  const { model, config, error } = info;
  const id = escapeHtml(model.id);
  const title = escapeHtml(model.title);
  const description = model.description?.trim();
  const stockCount = config?.model.stocks?.length ?? 0;
  const flowCount = config?.model.flows?.length ?? 0;
  const tags = model.tags ?? [];
  const horizon = config
    ? `${config.model.time.start}–${config.model.time.stop}${config.model.time.unit ? ` ${config.model.time.unit}` : ''}`
    : '—';

  return `<article class="model-card${error ? ' model-card-error' : ''}" data-id="${id}">
    <div class="card-head">
      <div class="card-title-row">
        <h2 class="card-title"><a href="#/models/${encodeURIComponent(model.id)}">${title}</a></h2>
        ${model.builtin ? '<span class="badge badge-builtin">Builtin</span>' : ''}
        ${error ? `<span class="badge badge-error" title="${escapeHtml(error)}">Parse error</span>` : ''}
      </div>
      <p class="card-desc">${description ? escapeHtml(description) : '<span class="muted">No description.</span>'}</p>
    </div>
    ${tags.length ? `<div class="tags">${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
    <div class="card-meta">
      <span>${stockCount} stock${stockCount === 1 ? '' : 's'} · ${flowCount} flow${flowCount === 1 ? '' : 's'}</span>
      <span>horizon ${escapeHtml(horizon)}</span>
    </div>
    ${error ? `<div class="card-error-msg">${escapeHtml(error)}</div>` : ''}
    <div class="card-foot">
      <span class="muted">Updated ${timeAgo(model.updatedAt)}</span>
      <div class="card-actions">
        <button class="btn btn-sm btn-primary" data-action="open">Open</button>
        <button class="btn btn-sm" data-action="duplicate">Duplicate</button>
        <button class="btn btn-sm" data-action="export">Export YAML</button>
        <button class="btn btn-sm btn-danger-ghost" data-action="delete">Delete</button>
      </div>
    </div>
  </article>`;
}

export function renderLibrary(root: HTMLElement, store: ModelStore): () => void {
  root.innerHTML = `<div class="page library-page">
    <section class="page-head">
      <div class="page-head-text">
        <h1>Model library</h1>
        <p class="page-sub">Stock-and-flow models stored locally. Open one to run the simulation, inspect the diagram, and edit the YAML source.</p>
      </div>
      <div class="toolbar">
        <label class="search">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input id="modelSearch" type="search" placeholder="Search title, description, tag…" autocomplete="off" />
        </label>
        <button class="btn btn-primary" id="newModelBtn">+ New model</button>
        <button class="btn" id="importBtn">Import</button>
        <input id="importInput" type="file" accept=".yaml,.yml,.json" multiple hidden />
      </div>
    </section>
    <div class="grid-meta">
      <span id="countLabel" class="muted"></span>
      <span class="muted">Stored in this browser · YAML is the source of truth</span>
    </div>
    <div id="cardGrid" class="card-grid"></div>
  </div>`;

  const search = root.querySelector<HTMLInputElement>('#modelSearch');
  const grid = root.querySelector<HTMLDivElement>('#cardGrid');
  const countLabel = root.querySelector<HTMLSpanElement>('#countLabel');
  const importInput = root.querySelector<HTMLInputElement>('#importInput');
  const newBtn = root.querySelector<HTMLButtonElement>('#newModelBtn');
  const importBtn = root.querySelector<HTMLButtonElement>('#importBtn');
  if (!search || !grid || !countLabel || !importInput || !newBtn || !importBtn) {
    return () => undefined;
  }
  // Narrowed aliases keep the closures below free of non-null assertions.
  const gridEl = grid;
  const countEl = countLabel;

  function visibleModels(): StoredModel[] {
    return store.list().sort((a, b) => {
      if (Boolean(a.builtin) !== Boolean(b.builtin)) return a.builtin ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }

  function matches(model: StoredModel, query: string): boolean {
    if (!query) return true;
    const haystack = [model.title, model.description ?? '', ...(model.tags ?? []), model.id]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  }

  function renderCards(): void {
    const query = search?.value.trim().toLowerCase() ?? '';
    const all = visibleModels();
    const filtered = all.filter(model => matches(model, query));
    countEl.textContent = `${filtered.length} of ${all.length} model${all.length === 1 ? '' : 's'}`;

    if (all.length === 0) {
      gridEl.innerHTML = `<div class="empty-state">
        <div class="empty-icon" aria-hidden="true">◍</div>
        <h2>No models yet</h2>
        <p>Create a starter model or import a YAML/JSON model file. Models are stored in this browser.</p>
        <div class="controls">
          <button class="btn btn-primary" data-action="new">+ New model</button>
          <button class="btn" data-action="import">Import model</button>
        </div>
      </div>`;
      return;
    }

    if (filtered.length === 0) {
      gridEl.innerHTML = `<div class="empty-state">
        <h2>No matches</h2>
        <p>No model matches “${escapeHtml(search?.value.trim() ?? '')}”. Try a different search.</p>
      </div>`;
      return;
    }

    gridEl.innerHTML = filtered.map(model => cardHtml(inspect(model))).join('');
  }

  function notifyModelsChanged(): void {
    window.dispatchEvent(new Event('sysdyn:models-changed'));
  }

  function openModel(id: string): void {
    window.location.hash = `#/models/${encodeURIComponent(id)}`;
  }

  function onGridClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === 'new') {
      createModel();
      return;
    }
    if (action === 'import') {
      importInput?.click();
      return;
    }
    const card = actionEl.closest<HTMLElement>('.model-card');
    const id = card?.dataset.id;
    if (!id) return;
    const model = store.get(id);
    if (!model) {
      toast('That model is no longer available.', 'error');
      renderCards();
      return;
    }

    switch (action) {
      case 'open':
        openModel(id);
        break;
      case 'duplicate': {
        const copy = store.duplicate(id);
        if (copy) {
          toast(`Duplicated as “${copy.title}”.`, 'success');
          renderCards();
          notifyModelsChanged();
        } else {
          toast('Could not duplicate that model.', 'error');
        }
        break;
      }
      case 'export':
        download(`${model.id}.yaml`, model.yaml, 'text/yaml');
        toast(`Exported ${model.id}.yaml.`, 'success');
        break;
      case 'delete': {
        const confirmed = window.confirm(`Delete “${model.title}”? This cannot be undone.`);
        if (!confirmed) return;
        store.remove(id);
        toast(`Deleted “${model.title}”.`, 'info');
        renderCards();
        notifyModelsChanged();
        break;
      }
      default:
        break;
    }
  }

  function createModel(): void {
    try {
      const model = store.importText(NEW_MODEL_YAML, 'new-model.yaml');
      toast('Created a starter model.', 'success');
      openModel(model.id);
    } catch (error) {
      toast(`Could not create a model: ${errorMessage(error)}`, 'error');
    }
  }

  async function onImportChange(): Promise<void> {
    const files = Array.from(importInput?.files ?? []);
    if (!files.length) return;
    const imported: StoredModel[] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const text = await file.text();
        imported.push(store.importText(text, file.name));
      } catch (error) {
        failures.push(`${file.name}: ${errorMessage(error)}`);
      }
    }
    if (importInput) importInput.value = '';
    renderCards();
    notifyModelsChanged();
    if (imported.length) {
      toast(`Imported ${imported.length} model${imported.length === 1 ? '' : 's'}.`, 'success');
    }
    if (failures.length) {
      toast(`Import failed — ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ''}`, 'error', 7000);
    }
  }

  search.addEventListener('input', renderCards);
  newBtn.addEventListener('click', createModel);
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => void onImportChange());
  gridEl.addEventListener('click', onGridClick);
  renderCards();

  return () => {
    search.removeEventListener('input', renderCards);
    newBtn.removeEventListener('click', createModel);
    gridEl.removeEventListener('click', onGridClick);
  };
}
