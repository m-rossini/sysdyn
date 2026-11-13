import Chart, { type Plugin } from 'chart.js/auto';
import {
  autoLayout,
  builtinConcepts,
  parseJSON,
  parseYAML,
  simulate,
  toJSON,
  toYAML,
  validateConfig,
  type ConceptDef,
  type DiagramLayout,
  type LayoutNode,
  type SimulationResult,
  type SysDynConfig,
} from '@sysdyn/core';
import {
  NEW_MODEL_YAML,
  getBuiltinSeed,
  type ModelStore,
  type StoredModel,
} from './store';
import {
  bindHelp,
  download,
  escapeHtml,
  formatNumber,
  qIcon,
  toast,
} from './ui';

interface WorkspaceNav {
  missing: () => void;
}

type ElementKind = 'parameter' | 'stock' | 'flow' | 'auxiliary';

interface AnyEl {
  name: string;
  kind: ElementKind;
  concept?: string;
  equation?: string;
  initial?: number | string;
  value?: number;
  unit?: string;
  description?: string;
  from?: string;
  to?: string;
  inflows?: string[];
  outflows?: string[];
}

interface Metrics {
  stockRange: Map<string, { min: number; max: number }>;
  flowMax: Map<string, number>;
}

type SaveState = 'saved' | 'unsaved' | 'error';
type Tab = 'dashboard' | 'edit';

const RESERVED = new Set([
  't', 'time', 'dt', 'pi', 'e', 'true', 'false', 'null', 'undefined',
  'step', 'pulse', 'ramp', 'delay', 'smooth', 'rand', 'delay1', 'delay3', 'trend',
  'STEP', 'PULSE', 'RAMP', 'DELAY', 'SMOOTH', 'DELAY1', 'DELAY3', 'TREND', 'RAND',
  'min', 'max', 'abs', 'sqrt', 'exp', 'log', 'log10', 'sin', 'cos', 'tan', 'pow', 'mod',
  'floor', 'ceil', 'round', 'if', 'and', 'or', 'not', 'sign',
]);

const CHART_COLORS = ['#4f46e5', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#0f766e', '#b45309'];
const SVG_NS = 'http://www.w3.org/2000/svg';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function parseAny(text: string): SysDynConfig {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('The model source is empty.');
  return trimmed.startsWith('{') ? parseJSON(trimmed) : parseYAML(trimmed);
}

function svgNode<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
}

function equationVariables(equation: string): string[] {
  const ids = Array.from(equation.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)).map(match => match[0]);
  return Array.from(new Set(ids.filter(id => !RESERVED.has(id))));
}

function buildMetrics(result: SimulationResult): Metrics {
  const stockRange = new Map<string, { min: number; max: number }>();
  const flowMax = new Map<string, number>();

  for (const stock of result.config.model.stocks ?? []) {
    let min = Infinity;
    let max = -Infinity;
    for (const point of result.series) {
      const value = Number(point.values[stock.name] ?? 0);
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }
    if (max === min) max = min + 1;
    stockRange.set(stock.name, { min, max });
  }

  for (const flow of result.config.model.flows ?? []) {
    let max = 0;
    for (const point of result.series) {
      const value = Math.abs(Number(point.values[flow.name] ?? 0));
      if (value > max) max = value;
    }
    flowMax.set(flow.name, max || 1);
  }

  return { stockRange, flowMax };
}

export function renderWorkspace(
  root: HTMLElement,
  store: ModelStore,
  id: string,
  nav: WorkspaceNav,
): () => void {
  let model = store.get(id);
  if (!model) {
    nav.missing();
    return () => undefined;
  }

  const container = document.createElement('div');
  container.className = 'workspace';
  container.innerHTML = `<div class="ws-bar">
  <div class="ws-bar-left">
    <a class="back-link" href="#/models">← Models</a>
    <div class="ws-titles">
      <h1 class="ws-title" id="wsTitle"></h1>
      <div class="ws-sub" id="wsSub"></div>
    </div>
  </div>
  <div class="ws-bar-right">
    <span class="save-status saved" id="saveStatus">Saved</span>
    <button class="btn btn-sm" id="exportYamlBtn">Export YAML</button>
    <button class="btn btn-sm" id="exportJsonBtn">Export JSON</button>
    <div class="menu-wrap">
      <button class="btn btn-sm btn-icon" id="modelMenuBtn" aria-haspopup="true" aria-expanded="false" aria-label="Model menu">⋯</button>
      <div class="menu" id="modelMenu" hidden>
        <button type="button" data-action="duplicate">Duplicate</button>
        <button type="button" data-action="reset" id="resetSampleBtn" hidden>Reset to sample</button>
        <button type="button" data-action="delete" class="danger">Delete</button>
      </div>
    </div>
  </div>
</div>

<div class="tabs" role="tablist">
  <button type="button" class="tab active" data-tab="dashboard" role="tab" aria-selected="true">Dashboard</button>
  <button type="button" class="tab" data-tab="edit" role="tab" aria-selected="false">Edit</button>
  <span class="tab-hint muted" id="tabHint"></span>
</div>

<section class="tab-panel" id="panel-dashboard">
  <div class="kpis" id="kpis"></div>
  <div class="notice" id="dashNotice" hidden></div>
  <div class="dash-grid">
    <div class="dash-main">
      <div class="panel playback-panel">
        <div class="playback">
          <div class="controls playback-controls">
            <button type="button" class="btn btn-primary play-btn" id="playPause" aria-label="Play">▶ Play</button>
            <button type="button" class="btn btn-sm" id="resetBtn">Reset</button>
            <button type="button" class="btn btn-sm" id="stepBack">Step −</button>
            <button type="button" class="btn btn-sm" id="stepForward">Step +</button>
            <label class="speed">Speed
              <select id="speedSelect">
                <option value="0.5">0.5×</option>
                <option value="1" selected>1×</option>
                <option value="1.5">1.5×</option>
                <option value="2">2×</option>
              </select>
            </label>
            <span class="spacer"></span>
            ${qIcon('Play/Pause animates through simulated time. Reset returns to t=0. Step moves one simulation point. The scrubber jumps to any time, and speed scales playback (0.5×–2×).')}
          </div>
          <div class="scrub-row">
            <input id="scrubber" type="range" min="0" max="0" value="0" step="1" aria-label="Simulation time" />
            <div class="time-readout">
              <strong id="timeLabel">t = 0</strong>
              <span id="timeMeta" class="muted"></span>
            </div>
          </div>
        </div>
      </div>

      <div class="panel diagram-panel">
        <div class="panel-head">
          <h3>Stock &amp; flow diagram ${qIcon('Stocks are tanks whose fill tracks the current value; flows are valves whose outline thickness tracks magnitude. Blue arrows are material flows, dashed grey arrows are information links (equations that read another variable). Click a node to inspect it and highlight its links.')}</h3>
          <span class="legend" aria-label="Diagram legend">
            <span class="legend-item"><span class="legend-swatch legend-flow"></span>flow</span>
            <span class="legend-item"><span class="legend-swatch legend-info"></span>information</span>
          </span>
        </div>
        <div class="diagram-wrap"><svg id="diagram" role="img" aria-label="Stock and flow diagram"></svg></div>
      </div>
    </div>

    <aside class="dash-side">
      <div class="panel elements-panel">
        <div class="panel-head"><h3>Elements ${qIcon('Every parameter, stock, flow, and auxiliary in the model. Click one for details.')}</h3></div>
        <div class="elements" id="elements"></div>
      </div>
      <div class="panel detail-panel">
        <div class="panel-head"><h3>Selected / concept ${qIcon('Integrated references for system dynamics concepts and the selected model element.')}</h3></div>
        <div class="detail help" id="detail"></div>
      </div>
    </aside>
  </div>

  <div class="panel chart-full">
      <div class="panel-head">
        <div><h3>Time series ${qIcon('Tick the series below the chart to show or hide them (up to 12). The red dashed cursor follows the current scrubber time.')}</h3></div>
      </div>
      <div class="chart-wrap"><canvas id="chart"></canvas></div>
      <div class="vars vars-inline" id="vars"></div>
  </div>
</section>

<section class="tab-panel" id="panel-edit" hidden>
  <div class="edit-grid">
    <div class="panel edit-main">
      <div class="panel-head">
        <h3>Model source (YAML / JSON)</h3>
        <span class="muted">YAML is stored as the canonical source · autosaves after 600 ms</span>
      </div>
      <textarea id="configText" class="yaml-input" spellcheck="false" aria-label="Model source"></textarea>
      <div class="controls edit-actions">
        <button type="button" class="btn btn-primary" id="runBtn">Parse &amp; Run</button>
        <button type="button" class="btn" id="loadSampleBtn" hidden>Load sample</button>
        <button type="button" class="btn" id="saveYamlBtn">Save YAML</button>
        <button type="button" class="btn" id="saveJsonBtn">Save JSON</button>
        <label class="btn file-btn">Load file<input id="fileInput" type="file" accept=".yaml,.yml,.json" hidden /></label>
      </div>
      <div id="status" class="status-box">Loading model…</div>
    </div>

    <div class="panel edit-side">
      <div class="panel-head"><h3>Guided builder ${qIcon('Build a model without writing raw YAML. Fields append elements to the source and time inputs update the simulation window.')}</h3></div>
      <div class="builder">
        <div class="builder-group">
          <strong>Time ${qIcon('Simulation window: start and stop define the horizon, dt is the integration step (smaller is more accurate and slower).')}</strong>
          <div class="controls">
            <label class="field">start <input id="b_start" type="number" step="1" /></label>
            <label class="field">stop <input id="b_stop" type="number" step="1" /></label>
            <label class="field">dt <input id="b_dt" type="number" step="0.1" min="0.001" /></label>
          </div>
        </div>
        <div class="builder-group">
          <strong>Add parameter ${qIcon('Constant value used in equations (for example rates or targets).')}</strong>
          <div class="controls">
            <input id="b_p_name" placeholder="name" />
            <input id="b_p_value" placeholder="value" type="number" />
            <button type="button" class="btn btn-sm" id="b_add_param">Add</button>
          </div>
        </div>
        <div class="builder-group">
          <strong>Add stock ${qIcon('An accumulation. It changes by inflows minus outflows over time.')}</strong>
          <div class="controls">
            <input id="b_s_name" placeholder="name" />
            <input id="b_s_init" placeholder="initial" type="number" />
            <button type="button" class="btn btn-sm" id="b_add_stock">Add</button>
          </div>
        </div>
        <div class="builder-group">
          <strong>Add flow ${qIcon('A rate equation moving material into or out of stocks. Reference stock names and math.js expressions/primitives.')}</strong>
          <div class="controls">
            <input id="b_f_name" placeholder="name" />
            <input id="b_f_eq" placeholder="equation (e.g. rate * stock)" />
          </div>
          <div class="controls">
            <input id="b_f_from" placeholder="from stock (optional)" />
            <input id="b_f_to" placeholder="to stock (optional)" />
            <button type="button" class="btn btn-sm" id="b_add_flow">Add</button>
          </div>
        </div>
        <div class="builder-group">
          <strong>Add auxiliary ${qIcon('An intermediate calculated variable that simplifies equations.')}</strong>
          <div class="controls">
            <input id="b_a_name" placeholder="name" />
            <input id="b_a_eq" placeholder="equation" />
            <button type="button" class="btn btn-sm" id="b_add_aux">Add</button>
          </div>
        </div>
        <div class="controls">
          <button type="button" class="btn" id="b_apply">Apply builder &amp; run</button>
          ${qIcon('Merges the builder time inputs and appended elements into the current source, then runs the simulation.')}
        </div>
      </div>
      <div class="authoring-help help">
        <div><strong>Structure:</strong> <code>model.time {start, stop, dt}</code>, <code>parameters</code>, <code>stocks</code>, <code>flows</code>, <code>auxiliaries</code>.</div>
        <div><strong>Math:</strong> <code>+ − * / ^</code>, <code>min()</code> <code>max()</code> <code>exp()</code> <code>log()</code> <code>sqrt()</code>.</div>
        <div><strong>Primitives:</strong> <code>step(h,t)</code>, <code>pulse(vol,first,interval)</code>, <code>ramp(slope,start,end)</code>, <code>delay(input,dtm,init)</code>, <code>smooth(input,avg,init)</code>, <code>rand(min,max)</code>.</div>
      </div>
    </div>
  </div>
</section>`;
  root.appendChild(container);

  function pick<T extends Element>(selector: string): T {
    const element = container.querySelector<T>(selector);
    if (!element) throw new Error(`Workspace element not found: ${selector}`);
    return element;
  }

  const wsTitle = pick<HTMLElement>('#wsTitle');
  const wsSub = pick<HTMLElement>('#wsSub');
  const saveStatus = pick<HTMLElement>('#saveStatus');
  const menuBtn = pick<HTMLButtonElement>('#modelMenuBtn');
  const menu = pick<HTMLElement>('#modelMenu');
  const resetSampleBtn = pick<HTMLButtonElement>('#resetSampleBtn');
  const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('.tab'));
  const dashboardPanel = pick<HTMLElement>('#panel-dashboard');
  const editPanel = pick<HTMLElement>('#panel-edit');
  const kpisEl = pick<HTMLElement>('#kpis');
  const noticeEl = pick<HTMLElement>('#dashNotice');
  const playBtn = pick<HTMLButtonElement>('#playPause');
  const resetBtn = pick<HTMLButtonElement>('#resetBtn');
  const stepBackBtn = pick<HTMLButtonElement>('#stepBack');
  const stepForwardBtn = pick<HTMLButtonElement>('#stepForward');
  const speedSelect = pick<HTMLSelectElement>('#speedSelect');
  const scrubber = pick<HTMLInputElement>('#scrubber');
  const timeLabel = pick<HTMLElement>('#timeLabel');
  const timeMeta = pick<HTMLElement>('#timeMeta');
  const diagramSvg = pick<SVGSVGElement>('#diagram');
  const chartCanvas = pick<HTMLCanvasElement>('#chart');
  const varsEl = pick<HTMLElement>('#vars');
  const elementsEl = pick<HTMLElement>('#elements');
  const detailEl = pick<HTMLElement>('#detail');
  const exportYamlBtn = pick<HTMLButtonElement>('#exportYamlBtn');
  const exportJsonBtn = pick<HTMLButtonElement>('#exportJsonBtn');
  const textarea = pick<HTMLTextAreaElement>('#configText');
  const runBtn = pick<HTMLButtonElement>('#runBtn');
  const loadSampleBtn = pick<HTMLButtonElement>('#loadSampleBtn');
  const saveYamlBtn = pick<HTMLButtonElement>('#saveYamlBtn');
  const saveJsonBtn = pick<HTMLButtonElement>('#saveJsonBtn');
  const fileInput = pick<HTMLInputElement>('#fileInput');
  const statusEl = pick<HTMLElement>('#status');
  const tabHint = pick<HTMLElement>('#tabHint');

  let sim: SimulationResult | null = null;
  let layout: DiagramLayout | null = null;
  let metrics: Metrics | null = null;
  let chart: Chart | null = null;
  let idx = 0;
  let playing = false;
  let speed = 1;
  let lastTs = 0;
  let acc = 0;
  let rafId: number | null = null;
  let autosaveTimer: number | null = null;
  let saveState: SaveState = 'saved';
  let activeTab: Tab = 'dashboard';
  let selected: string | null = null;
  let selectedVars = new Set<string>();
  let kpiRefs: Array<{ name: string; value: HTMLElement; delta: HTMLElement }> = [];
  let suppressCleanupSave = false;

  textarea.value = model.yaml;

  const cursorPlugin: Plugin<'line'> = {
    id: 'sysdynTimeCursor',
    afterDraw(c) {
      const result = sim;
      if (!result) return;
      const { ctx, chartArea, scales } = c;
      const xScale = scales.x;
      if (!chartArea || !xScale) return;
      const x = xScale.getPixelForValue(idx);
      if (!Number.isFinite(x)) return;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ef4444';
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ef4444';
      ctx.font = '11px sans-serif';
      const label = `t=${result.series[idx]?.t ?? ''}`;
      const textWidth = ctx.measureText(label).width;
      const tx = Math.min(Math.max(x + 6, chartArea.left + 4), chartArea.right - textWidth - 4);
      ctx.fillText(label, tx, chartArea.top + 12);
      ctx.restore();
    },
  };

  function conceptById(conceptId?: string): ConceptDef | undefined {
    if (!conceptId) return undefined;
    const modelConcepts = sim?.config.model.concepts ?? [];
    return modelConcepts.find(concept => concept.id === conceptId)
      ?? builtinConcepts.find(concept => concept.id === conceptId);
  }

  function updateHeader(config?: SysDynConfig): void {
    if (!model) return;
    const title = config?.model.title?.trim() || model.title || model.id;
    wsTitle.textContent = title;
    const description = config?.model.description ?? model.description ?? '';
    wsSub.textContent = description || 'No description';
    tabHint.textContent = `${model.id}${model.builtin ? ' · builtin' : ''}`;
    resetSampleBtn.hidden = !model.builtin;
    loadSampleBtn.hidden = !model.builtin;
  }

  function updateSaveStatus(): void {
    const labels: Record<SaveState, string> = {
      saved: 'Saved',
      unsaved: 'Unsaved changes',
      error: 'Save failed',
    };
    saveStatus.textContent = labels[saveState];
    saveStatus.className = `save-status ${saveState}`;
  }

  function setStatus(message: string, kind: 'ok' | 'warn' | 'error' | 'idle' = 'idle'): void {
    statusEl.textContent = message;
    statusEl.className = `status-box ${kind}`;
  }

  function showNotice(message: string): void {
    noticeEl.hidden = false;
    noticeEl.innerHTML = `<div class="notice-text"><strong>Parse error</strong><div>${escapeHtml(message)}</div></div>
      <button type="button" class="btn btn-sm" data-notice-action="edit">Fix in editor</button>`;
  }

  function hideNotice(): void {
    noticeEl.hidden = true;
    noticeEl.innerHTML = '';
  }

  function reportError(error: unknown): void {
    const message = errorMessage(error);
    setStatus(`Error: ${message}`, 'error');
    showNotice(message);
  }

  function allElements(): AnyEl[] {
    const result = sim;
    if (!result) return [];
    const modelDef = result.config.model;
    const items: AnyEl[] = [];
    for (const parameter of modelDef.parameters ?? []) {
      items.push({ ...parameter, kind: 'parameter', equation: String(parameter.value) });
    }
    for (const stock of modelDef.stocks ?? []) {
      const connections = [
        stock.inflows?.length ? `inflows=[${stock.inflows.join(', ')}]` : '',
        stock.outflows?.length ? `outflows=[${stock.outflows.join(', ')}]` : '',
      ].filter(Boolean).join(', ');
      items.push({
        ...stock,
        kind: 'stock',
        equation: `initial=${String(stock.initial)}${connections ? `, ${connections}` : ''}`,
      });
    }
    for (const flow of modelDef.flows ?? []) items.push({ ...flow, kind: 'flow' });
    for (const auxiliary of modelDef.auxiliaries ?? []) items.push({ ...auxiliary, kind: 'auxiliary' });
    return items;
  }

  function renderKpis(): void {
    const result = sim;
    kpiRefs = [];
    const stocks = result?.config.model.stocks ?? [];
    if (!stocks.length) {
      kpisEl.innerHTML = '<div class="kpi kpi-empty"><div class="muted">This model has no stocks to display.</div></div>';
      return;
    }
    kpisEl.innerHTML = stocks.map(stock => `<button type="button" class="kpi" data-stock="${escapeHtml(stock.name)}">
      <div class="kpi-label">${escapeHtml(stock.name)} ${qIcon(stock.description || `${stock.name} is a stock: an accumulation that changes through its inflows and outflows.`)}</div>
      <div class="kpi-value"><span class="kpi-number">—</span> <span class="kpi-unit">${escapeHtml(stock.unit ?? '')}</span></div>
      <div class="kpi-delta flat">—</div>
    </button>`).join('');

    kpisEl.querySelectorAll<HTMLElement>('.kpi').forEach(node => {
      const name = node.dataset.stock ?? '';
      const value = node.querySelector<HTMLElement>('.kpi-number');
      const delta = node.querySelector<HTMLElement>('.kpi-delta');
      if (value && delta) kpiRefs.push({ name, value, delta });
      node.addEventListener('click', event => {
        if (event.target instanceof Element && event.target.closest('.q')) return;
        selectElement(name);
      });
    });
  }

  function updateKpis(): void {
    const result = sim;
    if (!result) return;
    const point = result.series[idx];
    const first = result.series[0];
    if (!point) return;
    for (const ref of kpiRefs) {
      const value = Number(point.values[ref.name] ?? 0);
      const initial = Number(first?.values[ref.name] ?? value);
      ref.value.textContent = formatNumber(value);
      const delta = value - initial;
      const pct = initial !== 0 ? (delta / Math.abs(initial)) * 100 : null;
      const arrow = delta > 0.0005 ? '▲' : delta < -0.0005 ? '▼' : '•';
      ref.delta.textContent = `${arrow} ${formatNumber(Math.abs(delta))}${pct === null ? '' : ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`} vs t=0`;
      ref.delta.className = `kpi-delta ${delta > 0.0005 ? 'up' : delta < -0.0005 ? 'down' : 'flat'}`;
    }
  }

  function renderVarPicker(): void {
    const result = sim;
    if (!result) {
      varsEl.innerHTML = '<div class="muted">No simulation loaded.</div>';
      return;
    }
    const candidates = result.variables.filter(variable => variable !== 't' && variable !== 'time');
    if (!candidates.length) {
      varsEl.innerHTML = '<div class="muted">No plottable variables.</div>';
      return;
    }
    const modelDef = result.config.model;
    const groups: Array<{ title: string; names: string[] }> = [
      { title: 'Stocks', names: (modelDef.stocks ?? []).map(item => item.name) },
      { title: 'Flows', names: (modelDef.flows ?? []).map(item => item.name) },
      { title: 'Auxiliaries', names: (modelDef.auxiliaries ?? []).map(item => item.name) },
      { title: 'Parameters', names: (modelDef.parameters ?? []).map(item => item.name) },
    ]
      .map(group => ({ ...group, names: group.names.filter(name => candidates.includes(name)) }))
      .filter(group => group.names.length > 0);
    // Anything plottable but not in a group (should be rare) goes last.
    const grouped = new Set(groups.flatMap(group => group.names));
    const rest = candidates.filter(name => !grouped.has(name));
    if (rest.length) groups.push({ title: 'Other', names: rest });

    const scrollTop = varsEl.scrollTop;
    varsEl.innerHTML = `
      <div class="vars-head">
        <span class="muted" id="varsCount"></span>
        <span class="vars-actions">
          <button type="button" class="link-btn" data-vars-action="all">All</button>
          <button type="button" class="link-btn" data-vars-action="stocks">Stocks</button>
          <button type="button" class="link-btn" data-vars-action="none">None</button>
        </span>
      </div>
      ${groups.map(group => `
        <div class="var-group">
          <div class="var-group-title">${escapeHtml(group.title)}</div>
          ${group.names.map(variable => `
            <label class="var-row" data-var-row="${escapeHtml(variable)}">
              <input type="checkbox" data-var="${escapeHtml(variable)}" ${selectedVars.has(variable) ? 'checked' : ''}/>
              <span class="var-dot" data-var-dot="${escapeHtml(variable)}"></span>
              <span class="var-name">${escapeHtml(variable)}</span>
            </label>`).join('')}
        </div>`).join('')}`;
    varsEl.scrollTop = scrollTop;

    varsEl.querySelectorAll<HTMLButtonElement>('[data-vars-action]').forEach(button => {
      button.addEventListener('click', () => {
        const action = button.dataset.varsAction;
        if (action === 'all') selectedVars = new Set(candidates);
        else if (action === 'none') selectedVars = new Set();
        else if (action === 'stocks') {
          selectedVars = new Set((modelDef.stocks ?? []).map(item => item.name).filter(name => candidates.includes(name)));
        } else return;
        renderVarPicker();
        rebuildChart();
      });
    });
    varsEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-var]').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        const name = checkbox.dataset.var;
        if (!name) return;
        if (checkbox.checked) selectedVars.add(name);
        else selectedVars.delete(name);
        refreshVarPickerState();
        rebuildChart();
      });
    });
    refreshVarPickerState();
  }

  function refreshVarPickerState(): void {
    const result = sim;
    if (!result) return;
    const countEl = varsEl.querySelector('#varsCount');
    if (countEl) countEl.textContent = `${selectedVars.size} of ${result.variables.filter(v => v !== 't' && v !== 'time').length} shown`;
    const show = Array.from(selectedVars).filter(variable => result.variables.includes(variable));
    varsEl.querySelectorAll<HTMLElement>('[data-var-dot]').forEach(dot => {
      const name = dot.dataset.varDot ?? '';
      const index = show.indexOf(name);
      dot.style.background = index >= 0 ? CHART_COLORS[index % CHART_COLORS.length] : 'transparent';
      dot.style.borderColor = index >= 0 ? CHART_COLORS[index % CHART_COLORS.length] : '#cbd5e1';
    });
  }

  function defaultSelection(result: SimulationResult): Set<string> {
    // Default to stocks only so the chart starts readable; users add the
    // flows/auxiliaries they want via the Variables picker.
    const stocks = (result.config.model.stocks ?? []).map(stock => stock.name)
      .filter(name => result.variables.includes(name));
    if (stocks.length) return new Set(stocks.slice(0, 4));
    return new Set(result.variables.filter(variable => variable !== 't' && variable !== 'time').slice(0, 4));
  }

  function rebuildChart(): void {
    if (chart) {
      chart.destroy();
      chart = null;
    }
    const result = sim;
    if (!result) return;
    const labels = result.series.map(point => point.t);
    const show = Array.from(selectedVars)
      .filter(variable => result.variables.includes(variable))
      .slice(0, 12);
    const datasets = show.map((variable, index) => ({
      label: variable,
      data: result.series.map(point => point.values[variable] ?? 0),
      borderColor: CHART_COLORS[index % CHART_COLORS.length],
      backgroundColor: 'transparent',
      tension: 0.15,
      pointRadius: 0,
      borderWidth: 2,
    }));
    chart = new Chart(chartCanvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { boxWidth: 12, usePointStyle: true } },
          tooltip: { intersect: false },
        },
        scales: {
          x: { title: { display: true, text: 'time' }, ticks: { maxTicksLimit: 12 } },
          y: { title: { display: false } },
        },
      },
      plugins: [cursorPlugin],
    });
  }

  function renderElementsPanel(): void {
    const items = allElements();
    if (!items.length) {
      elementsEl.innerHTML = '<div class="muted">No model elements.</div>';
      return;
    }
    const result = sim;
    elementsEl.innerHTML = items.map(element => {
      const concept = conceptById(element.concept);
      const tip = concept ? `${concept.name}: ${concept.summary}` : element.kind;
      const equation = element.equation ?? '';
      const value = result?.series[idx]?.values[element.name];
      return `<div class="elem${selected === element.name ? ' selected' : ''}" data-name="${escapeHtml(element.name)}">
        <div class="elem-header">
          <strong>${escapeHtml(element.name)}</strong>
          <span><span class="badge">${element.kind}</span>${qIcon(tip)}</span>
        </div>
        ${equation ? `<div class="eq">${escapeHtml(equation)} ${qIcon('Expression evaluated by math.js using model variables and primitives (step, pulse, ramp, delay, smooth, rand).')}</div>` : ''}
        <div class="help">value @ t=${result?.series[idx]?.t ?? 0}: <span data-elem-value="${escapeHtml(element.name)}">${value !== undefined ? formatNumber(Number(value)) : 'n/a'}</span> ${escapeHtml(element.unit ?? '')}</div>
      </div>`;
    }).join('');

    elementsEl.querySelectorAll<HTMLElement>('.elem').forEach(node => {
      node.addEventListener('click', event => {
        if (event.target instanceof Element && event.target.closest('.q')) return;
        selectElement(node.dataset.name ?? null);
      });
    });
  }

  function updateElementValues(): void {
    const result = sim;
    if (!result) return;
    const point = result.series[idx];
    elementsEl.querySelectorAll<HTMLElement>('[data-elem-value]').forEach(node => {
      const name = node.dataset.elemValue;
      if (!name) return;
      const value = point?.values[name];
      node.textContent = value !== undefined ? formatNumber(Number(value)) : 'n/a';
    });
    elementsEl.querySelectorAll<HTMLElement>('.elem').forEach(node => {
      node.classList.toggle('selected', node.dataset.name === selected);
    });
  }

  function renderDetail(name: string | null): void {
    const result = sim;
    if (!result || !name) {
      detailEl.innerHTML = 'Select a stock, flow, parameter, or auxiliary in the diagram or element list to inspect its equation, current value, and concept help.';
      return;
    }
    const modelDef = result.config.model;
    const point = result.series[idx];
    const value = point?.values[name];
    const stock = (modelDef.stocks ?? []).find(item => item.name === name);
    const flow = (modelDef.flows ?? []).find(item => item.name === name);
    const auxiliary = (modelDef.auxiliaries ?? []).find(item => item.name === name);
    const parameter = (modelDef.parameters ?? []).find(item => item.name === name);
    if (!stock && !flow && !auxiliary && !parameter) {
      detailEl.innerHTML = `<div><strong>${escapeHtml(name)}</strong> is not part of the current model.</div>`;
      return;
    }
    const kind: ElementKind = stock ? 'stock' : flow ? 'flow' : auxiliary ? 'auxiliary' : 'parameter';
    const concept = conceptById(stock?.concept ?? flow?.concept ?? auxiliary?.concept ?? parameter?.concept ?? kind)
      ?? conceptById(kind);

    let specific = '';
    if (stock) {
      const inflowHtml = stock.inflows?.length
        ? `<ul>${stock.inflows.map(flowName => {
          const def = (modelDef.flows ?? []).find(item => item.name === flowName);
          const flowValue = point?.values[flowName];
          return `<li><strong>${escapeHtml(flowName)}</strong> (inflow) = ${flowValue !== undefined ? formatNumber(Number(flowValue), 4) : 'n/a'} ${escapeHtml(def?.unit ?? '')}<div class="eq">${escapeHtml(def?.equation ?? '(no equation)')}</div></li>`;
        }).join('')}</ul>`
        : '<div class="muted">No inflows.</div>';
      const outflowHtml = stock.outflows?.length
        ? `<ul>${stock.outflows.map(flowName => {
          const def = (modelDef.flows ?? []).find(item => item.name === flowName);
          const flowValue = point?.values[flowName];
          return `<li><strong>${escapeHtml(flowName)}</strong> (outflow) = ${flowValue !== undefined ? formatNumber(Number(flowValue), 4) : 'n/a'} ${escapeHtml(def?.unit ?? '')}<div class="eq">${escapeHtml(def?.equation ?? '(no equation)')}</div></li>`;
        }).join('')}</ul>`
        : '<div class="muted">No outflows.</div>';
      specific = `
        <div><strong>What this stock represents:</strong> ${escapeHtml(stock.description || `${stock.name} is an accumulation (stock). It stores quantity over time and changes based on inflows minus outflows.`)}</div>
        <div><strong>Initial:</strong> ${escapeHtml(String(stock.initial))} ${escapeHtml(stock.unit ?? '')}</div>
        <div><strong>Current level:</strong> ${value !== undefined ? formatNumber(Number(value), 4) : 'n/a'} ${escapeHtml(stock.unit ?? '')} @ t=${point?.t ?? 0}</div>
        <div><strong>Inflows</strong> ${qIcon('Flows that increase this stock.')}</div>${inflowHtml}
        <div><strong>Outflows</strong> ${qIcon('Flows that decrease this stock.')}</div>${outflowHtml}
        <div class="help">Net change rate now = (sum inflows − sum outflows) applied over dt=${result.config.model.time.dt}.</div>`;
    } else if (flow) {
      const variables = equationVariables(flow.equation);
      const variablesHtml = variables.length
        ? `<ul>${variables.map(variable => {
          const variableValue = point?.values[variable];
          return `<li><code>${escapeHtml(variable)}</code> = ${variableValue !== undefined ? formatNumber(Number(variableValue), 4) : 'n/a'}</li>`;
        }).join('')}</ul>`
        : '<div class="muted">No variable references detected (constant/expression-only).</div>';
      specific = `
        <div><strong>What this flow does:</strong> ${escapeHtml(flow.description || `${flow.name} is a flow rate that moves quantity per unit time.`)}</div>
        <div><strong>From:</strong> ${escapeHtml(flow.from || 'source/cloud')}</div>
        <div><strong>To:</strong> ${escapeHtml(flow.to || 'sink/cloud')}</div>
        <div><strong>Current rate:</strong> ${value !== undefined ? formatNumber(Number(value), 4) : 'n/a'} ${escapeHtml(flow.unit ?? '')} @ t=${point?.t ?? 0}</div>
        <div><strong>Math (equation)</strong> ${qIcon('Flow rate equation evaluated by the engine (math.js + system dynamics primitives).')}</div>
        <div class="eq">${escapeHtml(flow.equation)}</div>
        <div><strong>Variables in this flow</strong> ${qIcon('Variables referenced by the equation and their current values at the selected time.')}</div>
        ${variablesHtml}`;
    } else if (auxiliary) {
      const variables = equationVariables(auxiliary.equation);
      const variablesHtml = variables.length
        ? `<ul>${variables.map(variable => {
          const variableValue = point?.values[variable];
          return `<li><code>${escapeHtml(variable)}</code> = ${variableValue !== undefined ? formatNumber(Number(variableValue), 4) : 'n/a'}</li>`;
        }).join('')}</ul>`
        : '';
      specific = `
        <div><strong>Auxiliary:</strong> ${escapeHtml(auxiliary.description || 'Intermediate calculation used by flows and stocks.')}</div>
        <div><strong>Equation:</strong></div><div class="eq">${escapeHtml(auxiliary.equation)}</div>
        <div><strong>Current value:</strong> ${value !== undefined ? formatNumber(Number(value), 4) : 'n/a'} ${escapeHtml(auxiliary.unit ?? '')}</div>
        ${variablesHtml ? `<div><strong>Variables:</strong></div>${variablesHtml}` : ''}`;
    } else if (parameter) {
      specific = `
        <div><strong>Parameter:</strong> ${escapeHtml(parameter.description || 'Constant/scenario input used in equations.')}</div>
        <div><strong>Value:</strong> ${escapeHtml(String(parameter.value))} ${escapeHtml(parameter.unit ?? '')}</div>`;
    }

    // Explicit causal neighbourhood: what this element reads and what reads it.
    const reads = flow
      ? equationVariables(flow.equation)
      : auxiliary
        ? equationVariables(auxiliary.equation)
        : [];
    const readers = [...(modelDef.auxiliaries ?? []), ...(modelDef.flows ?? [])]
      .filter(def => def.name !== name && equationVariables(def.equation).includes(name))
      .map(def => def.name);
    const linkList = (items: string[]) => (items.length
      ? `<span class="link-list">${items
        .map(item => `<button type="button" class="link-chip" data-link="${escapeHtml(item)}">${escapeHtml(item)}</button>`)
        .join('')}</span>`
      : '<span class="muted">none</span>');
    const connections = `
      <div class="connections">
        <div><strong>Information links</strong> ${qIcon('Dashed arrows in the diagram. “Reads from” are the variables in this equation; “Read by” are the equations that use this element.')}</div>
        <div><strong>Reads from:</strong> ${linkList(reads)}</div>
        <div><strong>Read by:</strong> ${linkList(readers)}</div>
      </div>`;

    const references = concept?.references?.length
      ? `<ul>${concept.references.map(reference => `<li>${escapeHtml(reference)}</li>`).join('')}</ul>`
      : '<div class="muted">No references listed.</div>';
    const examples = concept?.examples?.length
      ? `<div><strong>Examples:</strong> ${concept.examples.map(example => escapeHtml(example)).join(', ')}</div>`
      : '';
    detailEl.innerHTML = `
      <div><strong>${escapeHtml(name)}</strong> <span class="badge">${kind}</span> ${qIcon('Click diagram nodes or list items to inspect behavior, equations, and connections.')}</div>
      ${specific}
      ${connections}
      ${concept ? `<hr/><div><strong>Concept reference: ${escapeHtml(concept.name)}</strong> ${qIcon(concept.summary)}</div><div>${escapeHtml(concept.summary)}</div>${concept.whenToUse ? `<div><strong>When to use:</strong> ${escapeHtml(concept.whenToUse)}</div>` : ''}${examples}${concept.mathNotes ? `<div><strong>Math notes:</strong> ${escapeHtml(concept.mathNotes)}</div>` : ''}<div><strong>References:</strong></div>${references}` : ''}`;
  }

  function selectElement(name: string | null): void {
    selected = name;
    renderDetail(name);
    updateElementValues();
    renderDiagram();
  }

  function stockRange(name: string): { min: number; max: number } {
    return metrics?.stockRange.get(name) ?? { min: 0, max: 1 };
  }

  function flowMax(name: string): number {
    return metrics?.flowMax.get(name) ?? 1;
  }

  function renderDiagram(): void {
    const result = sim;
    const currentLayout = layout;
    if (!result || !currentLayout) return;
    diagramSvg.setAttribute('viewBox', `0 0 ${currentLayout.width} ${currentLayout.height}`);
    while (diagramSvg.firstChild) diagramSvg.removeChild(diagramSvg.firstChild);

    const defs = svgNode('defs');
    const makeMarker = (id: string, color: string, size: number) => {
      const marker = svgNode('marker');
      marker.setAttribute('id', id);
      marker.setAttribute('markerWidth', String(size + 2));
      marker.setAttribute('markerHeight', String(size));
      marker.setAttribute('refX', String(size + 1));
      marker.setAttribute('refY', String(size / 2));
      marker.setAttribute('orient', 'auto');
      // Fixed pixel size: the flow lines get thick, so stroke-relative
      // markers would balloon into oversized wedges.
      marker.setAttribute('markerUnits', 'userSpaceOnUse');
      const arrow = svgNode('path');
      arrow.setAttribute('d', `M0,0 L0,${size} L${size + 1},${size / 2} z`);
      arrow.setAttribute('fill', color);
      marker.appendChild(arrow);
      defs.appendChild(marker);
    };
    makeMarker('arrow-flow', '#16a34a', 10);
    makeMarker('arrow-influence', '#94a3b8', 8);
    diagramSvg.appendChild(defs);

    const nodeById = new Map(currentLayout.nodes.map(node => [node.id, node]));
    const centerOf = (node: LayoutNode) => ({
      x: node.x + node.width / 2,
      y: node.y + node.height / 2,
    });
    // Anchor an edge on the border of a node, pointing at (tx, ty).
    const borderPoint = (node: LayoutNode, target: { x: number; y: number }) => {
      const center = centerOf(node);
      const dx = target.x - center.x;
      const dy = target.y - center.y;
      if (dx === 0 && dy === 0) return center;
      const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : node.width / 2 / Math.abs(dx);
      const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : node.height / 2 / Math.abs(dy);
      const scale = Math.min(scaleX, scaleY);
      return { x: center.x + dx * scale, y: center.y + dy * scale };
    };
    const curveFor = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.abs(dx) < 1.5 || Math.abs(dy) < 1.5) {
        return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
      }
      if (Math.abs(dy) >= Math.abs(dx)) {
        const k = dy * 0.45;
        return `M ${a.x} ${a.y} C ${a.x} ${a.y + k}, ${b.x} ${b.y - k}, ${b.x} ${b.y}`;
      }
      const k = dx * 0.45;
      return `M ${a.x} ${a.y} C ${a.x + k} ${a.y}, ${b.x - k} ${b.y}, ${b.x} ${b.y}`;
    };

    // --- information-link anchors -----------------------------------------
    // Information links leave a node on the side facing the target and are
    // spread along that side, so multiple links never pile onto one point or
    // cut diagonally through neighbouring boxes.
    type Side = 'top' | 'bottom' | 'left' | 'right';
    interface SideItem { key: string; node: LayoutNode; other: LayoutNode; side: Side }
    const exitGroups = new Map<string, SideItem[]>();
    const entryGroups = new Map<string, SideItem[]>();
    const sideFor = (from: LayoutNode, to: LayoutNode): { exit: Side; entry: Side } => {
      const dx = centerOf(to).x - centerOf(from).x;
      const dy = centerOf(to).y - centerOf(from).y;
      if (Math.abs(dx) > Math.abs(dy) * 1.6) {
        return dx >= 0 ? { exit: 'right', entry: 'left' } : { exit: 'left', entry: 'right' };
      }
      return dy >= 0 ? { exit: 'bottom', entry: 'top' } : { exit: 'top', entry: 'bottom' };
    };
    const sideKey = (id: string, side: Side) => `${id}:${side}`;
    const influenceEdges = currentLayout.edges.filter(edge => edge.type === 'influence');
    for (const edge of influenceEdges) {
      const fromNode = nodeById.get(edge.from);
      const toNode = nodeById.get(edge.to);
      if (!fromNode || !toNode) continue;
      const { exit, entry } = sideFor(fromNode, toNode);
      const key = `${edge.from}->${edge.to}`;
      const exitItem: SideItem = { key, node: fromNode, other: toNode, side: exit };
      const entryItem: SideItem = { key, node: toNode, other: fromNode, side: entry };
      const exitList = exitGroups.get(sideKey(fromNode.id, exit));
      if (exitList) exitList.push(exitItem); else exitGroups.set(sideKey(fromNode.id, exit), [exitItem]);
      const entryList = entryGroups.get(sideKey(toNode.id, entry));
      if (entryList) entryList.push(entryItem); else entryGroups.set(sideKey(toNode.id, entry), [entryItem]);
    }

    const pointOnSide = (node: LayoutNode, side: Side, index: number, total: number) => {
      const fraction = (index + 1) / (total + 1);
      if (side === 'top') return { x: node.x + node.width * fraction, y: node.y };
      if (side === 'bottom') return { x: node.x + node.width * fraction, y: node.y + node.height };
      if (side === 'left') return { x: node.x, y: node.y + node.height * fraction };
      return { x: node.x + node.width, y: node.y + node.height * fraction };
    };
    const spreadAlong = (item: SideItem) =>
      item.side === 'top' || item.side === 'bottom' ? centerOf(item.other).x : centerOf(item.other).y;

    const influenceAnchors = new Map<string, { a: { x: number; y: number }; b: { x: number; y: number }; vertical: boolean }>();
    const recordSpreads = (groups: Map<string, SideItem[]>, role: 'a' | 'b') => {
      for (const items of groups.values()) {
        const sorted = [...items].sort((left, right) => spreadAlong(left) - spreadAlong(right));
        sorted.forEach((item, index) => {
          const point = pointOnSide(item.node, item.side, index, sorted.length);
          const current = influenceAnchors.get(item.key) ?? { a: point, b: point, vertical: true };
          current[role] = point;
          current.vertical = item.side === 'top' || item.side === 'bottom';
          influenceAnchors.set(item.key, current);
        });
      }
    };
    recordSpreads(exitGroups, 'a');
    recordSpreads(entryGroups, 'b');

    const ordered = [...currentLayout.edges].sort((left, right) =>
      left.type === right.type ? 0 : left.type === 'influence' ? -1 : 1,
    );
    for (const edge of ordered) {
      const fromNode = nodeById.get(edge.from);
      const toNode = nodeById.get(edge.to);
      if (!fromNode || !toNode) continue;
      const influence = influenceAnchors.get(`${edge.from}->${edge.to}`);
      const a = influence?.a ?? borderPoint(fromNode, centerOf(toNode));
      const b = influence?.b ?? borderPoint(toNode, centerOf(fromNode));
      const path = svgNode('path');
      if (influence) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const k = influence.vertical
          ? Math.max(16, Math.abs(dy) * 0.5)
          : Math.max(16, Math.abs(dx) * 0.5);
        const d = influence.vertical
          ? `M ${a.x} ${a.y} C ${a.x} ${a.y + Math.sign(dy) * k}, ${b.x} ${b.y - Math.sign(dy) * k}, ${b.x} ${b.y}`
          : `M ${a.x} ${a.y} C ${a.x + Math.sign(dx) * k} ${a.y}, ${b.x - Math.sign(dx) * k} ${b.y}, ${b.x} ${b.y}`;
        path.setAttribute('d', d);
      } else {
        path.setAttribute('d', curveFor(a, b));
      }
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');

      const isFlow = edge.type === 'flow';
      const touchesSelection = !selected || edge.from === selected || edge.to === selected;
      let strokeWidth = isFlow ? 2 : 1.6;
      let opacity = isFlow ? 1 : 0.85;
      let stroke = isFlow ? '#16a34a' : '#71809a';

      if (isFlow) {
        const flowNode = fromNode.type === 'flow' ? fromNode : toNode.type === 'flow' ? toNode : null;
        if (flowNode) {
          const current = Math.abs(Number(result.series[idx]?.values[flowNode.id] ?? 0));
          strokeWidth = 1.5 + 4.5 * Math.min(1, current / flowMax(flowNode.id));
        }
      } else if (selected && touchesSelection) {
        stroke = '#6366f1';
      }
      if (!touchesSelection) {
        opacity *= 0.22;
        strokeWidth = Math.min(strokeWidth, 1.4);
      } else if (selected) {
        strokeWidth += 0.8;
      }

      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', String(strokeWidth));
      path.setAttribute('opacity', String(opacity));
      if (!isFlow) path.setAttribute('stroke-dasharray', '4 4');
      path.setAttribute('marker-end', isFlow ? 'url(#arrow-flow)' : 'url(#arrow-influence)');

      const edgeTitle = svgNode('title');
      edgeTitle.textContent = `${edge.from} → ${edge.to} (${isFlow ? 'flow' : 'information link'})`;
      path.appendChild(edgeTitle);
      diagramSvg.appendChild(path);
    }

    for (const node of currentLayout.nodes) {
      const group = svgNode('g');
      group.dataset.nodeId = node.id;
      group.dataset.nodeType = node.type;
      const isCloud = node.type === 'cloud';
      const value = result.series[idx]?.values[node.id];
      if (!isCloud) {
        group.style.cursor = 'pointer';
        group.addEventListener('click', () => selectElement(node.id));
      }

      if (isCloud) {
        const ellipse = svgNode('ellipse');
        ellipse.setAttribute('cx', String(node.x + node.width / 2));
        ellipse.setAttribute('cy', String(node.y + node.height / 2));
        ellipse.setAttribute('rx', String(node.width / 2));
        ellipse.setAttribute('ry', String(node.height / 2));
        ellipse.setAttribute('fill', '#f8fafc');
        ellipse.setAttribute('stroke', '#64748b');
        ellipse.setAttribute('stroke-dasharray', '4 3');
        group.appendChild(ellipse);
        const label = svgNode('text');
        label.setAttribute('x', String(node.x + node.width / 2));
        label.setAttribute('y', String(node.y + node.height / 2 + 4));
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '10');
        label.setAttribute('fill', '#64748b');
        label.textContent = 'cloud';
        group.appendChild(label);
        diagramSvg.appendChild(group);
        continue;
      }

      if (node.type === 'stock') {
        const x = node.x;
        const y = node.y;
        const width = node.width;
        const height = node.height;
        const range = stockRange(node.id);
        const current = Number(value ?? 0);
        const denominator = (Math.max(range.max, 0) - Math.min(0, range.min)) || 1;
        const fraction = Math.max(0, Math.min(1, (current - Math.min(0, range.min)) / denominator));
        const pad = 5;
        const innerHeight = height - pad * 2;
        const fillHeight = innerHeight * fraction;
        const gradientId = `water-${node.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        if (!diagramSvg.querySelector(`#${gradientId}`)) {
          const gradient = svgNode('linearGradient');
          gradient.setAttribute('id', gradientId);
          gradient.setAttribute('x1', '0');
          gradient.setAttribute('x2', '0');
          gradient.setAttribute('y1', '0');
          gradient.setAttribute('y2', '1');
          const stop1 = svgNode('stop');
          stop1.setAttribute('offset', '0%');
          stop1.setAttribute('stop-color', '#7dd3fc');
          const stop2 = svgNode('stop');
          stop2.setAttribute('offset', '100%');
          stop2.setAttribute('stop-color', '#2563eb');
          gradient.appendChild(stop1);
          gradient.appendChild(stop2);
          defs.appendChild(gradient);
        }
        const outline = svgNode('rect');
        outline.setAttribute('x', String(x));
        outline.setAttribute('y', String(y));
        outline.setAttribute('width', String(width));
        outline.setAttribute('height', String(height));
        outline.setAttribute('rx', '14');
        outline.setAttribute('fill', '#f8fbff');
        outline.setAttribute('stroke', selected === node.id ? '#dc2626' : '#334155');
        outline.setAttribute('stroke-width', selected === node.id ? '3' : '2');
        group.appendChild(outline);
        if (fillHeight > 0.5) {
          const fill = svgNode('rect');
          fill.setAttribute('x', String(x + pad));
          fill.setAttribute('y', String(y + height - pad - fillHeight));
          fill.setAttribute('width', String(width - pad * 2));
          fill.setAttribute('height', String(Math.max(0, fillHeight)));
          fill.setAttribute('rx', '10');
          fill.setAttribute('fill', `url(#${gradientId})`);
          fill.setAttribute('opacity', '0.9');
          group.appendChild(fill);
        }
        for (let i = 1; i < 4; i += 1) {
          const tickY = y + pad + (innerHeight * i) / 4;
          const tick = svgNode('line');
          tick.setAttribute('x1', String(x + 8));
          tick.setAttribute('y1', String(tickY));
          tick.setAttribute('x2', String(x + width - 8));
          tick.setAttribute('y2', String(tickY));
          tick.setAttribute('stroke', '#cbd5e1');
          tick.setAttribute('stroke-width', '1');
          tick.setAttribute('opacity', '0.6');
          group.appendChild(tick);
        }
      } else {
        const rect = svgNode('rect');
        rect.setAttribute('x', String(node.x));
        rect.setAttribute('y', String(node.y));
        rect.setAttribute('width', String(node.width));
        rect.setAttribute('height', String(node.height));
        rect.setAttribute('rx', node.type === 'flow' ? '18' : '12');
        rect.setAttribute('fill', node.type === 'flow' ? '#dcfce7' : '#f3f4f6');
        rect.setAttribute('stroke', selected === node.id ? '#dc2626' : '#334155');
        rect.setAttribute('stroke-width', selected === node.id ? '3' : '1.5');
        group.appendChild(rect);
      }

      const element = allElements().find(item => item.name === node.id);
      const concept = conceptById(element?.concept) ?? conceptById(node.type);
      const title = svgNode('title');
      title.textContent = `${node.id} (${node.type})${concept ? `\n${concept.name}: ${concept.summary}` : ''}`;
      const firstShape = group.querySelector('rect,ellipse,polygon');
      (firstShape ?? group.firstChild)?.appendChild(title);

      const label = svgNode('text');
      label.setAttribute('x', String(node.x + node.width / 2));
      label.setAttribute('y', String(node.y + node.height / 2 - 2));
      label.setAttribute('text-anchor', 'middle');
      const isLong = node.id.length > 14;
      label.setAttribute('font-size', isLong ? '10' : '11');
      label.setAttribute('font-weight', selected === node.id ? '700' : '600');
      label.setAttribute('fill', '#0f172a');
      label.textContent = node.id;
      // Keep long names inside their box so they don't collide with arrows.
      if (node.id.length * 6.1 > node.width - 10) {
        label.setAttribute('textLength', String(node.width - 10));
        label.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      }
      group.appendChild(label);

      const valueLabel = svgNode('text');
      valueLabel.setAttribute('x', String(node.x + node.width / 2));
      valueLabel.setAttribute('y', String(node.y + node.height / 2 + 11));
      valueLabel.setAttribute('text-anchor', 'middle');
      valueLabel.setAttribute('font-size', '10');
      valueLabel.setAttribute('fill', '#111827');
      valueLabel.textContent = value !== undefined ? formatNumber(Number(value)) : '';
      group.appendChild(valueLabel);

      diagramSvg.appendChild(group);
    }
  }

  function syncPlayButton(): void {
    playBtn.textContent = playing ? '❚❚ Pause' : '▶ Play';
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  function updateFrame(): void {
    const result = sim;
    if (!result) return;
    const point = result.series[idx];
    if (!point) return;
    scrubber.max = String(result.series.length - 1);
    scrubber.value = String(idx);
    timeLabel.textContent = `t = ${point.t}`;
    const unit = result.config.model.time.unit ? ` ${result.config.model.time.unit}` : '';
    timeMeta.textContent = `step ${idx + 1}/${result.series.length} · dt ${result.config.model.time.dt}${unit}`;
    updateKpis();
    updateElementValues();
    renderDiagram();
    if (selected) renderDetail(selected);
    if (chart) {
      try {
        chart.update('none');
      } catch {
        // The chart may be mid-rebuild while the tab is hidden.
      }
    }
  }

  function loop(timestamp: number): void {
    rafId = null;
    const result = sim;
    if (!playing || !result) {
      lastTs = 0;
      return;
    }
    if (!lastTs) lastTs = timestamp;
    const delta = Math.min(0.1, (timestamp - lastTs) / 1000);
    lastTs = timestamp;
    acc += delta * speed;
    const stepDuration = 0.18;
    let advanced = false;
    while (acc >= stepDuration && idx < result.series.length - 1) {
      idx += 1;
      acc -= stepDuration;
      advanced = true;
    }
    if (idx >= result.series.length - 1) {
      playing = false;
      syncPlayButton();
    }
    if (advanced) updateFrame();
    if (playing) rafId = requestAnimationFrame(loop);
  }

  function setPlaying(value: boolean): void {
    if (!sim) {
      playing = false;
      syncPlayButton();
      return;
    }
    if (value && idx >= sim.series.length - 1) {
      idx = 0;
      updateFrame();
    }
    playing = value;
    syncPlayButton();
    if (playing) {
      if (rafId === null) {
        lastTs = 0;
        rafId = requestAnimationFrame(loop);
      }
    } else {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      lastTs = 0;
    }
  }

  function updateTimeFields(config: SysDynConfig): void {
    pick<HTMLInputElement>('#b_start').value = String(config.model.time.start);
    pick<HTMLInputElement>('#b_stop').value = String(config.model.time.stop);
    pick<HTMLInputElement>('#b_dt').value = String(config.model.time.dt);
  }

  function applyConfig(config: SysDynConfig): { warnings: string[]; result: SimulationResult } {
    const issues = validateConfig(config);
    const errors = issues.filter(issue => issue.level === 'error');
    if (errors.length) {
      throw new Error(errors.map(issue => issue.message).join(' · '));
    }
    const result = simulate(config, { integrator: 'euler' });

    setPlaying(false);
    sim = result;
    layout = autoLayout(result.config.model);
    metrics = buildMetrics(result);
    idx = 0;
    acc = 0;
    selected = null;
    selectedVars = defaultSelection(result);

    renderKpis();
    renderVarPicker();
    rebuildChart();
    renderElementsPanel();
    renderDetail(null);
    updateTimeFields(result.config);
    updateHeader(result.config);
    hideNotice();
    updateFrame();
    syncPlayButton();

    return {
      warnings: [
        ...issues.filter(issue => issue.level === 'warning').map(issue => issue.message),
        ...(result.warnings ?? []),
      ],
      result,
    };
  }

  function autosaveNow(): void {
    if (autosaveTimer !== null) {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    if (!model) return;
    let yamlText = textarea.value;
    let title = model.title;
    let description = model.description;
    try {
      const config = parseAny(yamlText);
      title = config.model.title?.trim() || title;
      description = config.model.description ?? description;
      // YAML is the canonical stored form; convert JSON drafts on save.
      if (yamlText.trim().startsWith('{')) yamlText = toYAML(config);
    } catch {
      // Keep the last known metadata when the draft is not parseable yet.
    }
    const next: StoredModel = {
      ...model,
      yaml: yamlText,
      title,
      description,
      updatedAt: new Date().toISOString(),
    };
    try {
      store.save(next);
      model = next;
      saveState = 'saved';
      updateSaveStatus();
      updateHeader();
    } catch (error) {
      saveState = 'error';
      updateSaveStatus();
      setStatus(`Could not save: ${errorMessage(error)}`, 'error');
    }
  }

  function scheduleAutosave(): void {
    if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      autosaveTimer = null;
      autosaveNow();
    }, 600);
  }

  function markDirty(): void {
    saveState = 'unsaved';
    updateSaveStatus();
    scheduleAutosave();
  }

  function parseAndRun(persist: boolean): void {
    const text = textarea.value;
    try {
      const config = parseAny(text);
      const { warnings, result } = applyConfig(config);
      const summary = `OK: ${config.model.title ?? config.model.id ?? 'model'} — ${result.series.length} points, ${result.variables.length} variables.`;
      setStatus(
        warnings.length ? `${summary} Warnings: ${warnings.join(' · ')}` : summary,
        warnings.length ? 'warn' : 'ok',
      );
      if (persist) autosaveNow();
    } catch (error) {
      reportError(error);
    }
  }

  function setTab(tab: Tab): void {
    activeTab = tab;
    for (const button of tabs) {
      const isActive = button.dataset.tab === tab;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    dashboardPanel.hidden = tab !== 'dashboard';
    editPanel.hidden = tab !== 'edit';
    if (tab === 'dashboard') {
      if (chart) {
        requestAnimationFrame(() => {
          try {
            chart?.resize();
            chart?.update('none');
          } catch {
            // Chart may have been destroyed by a re-parse.
          }
        });
      }
      updateFrame();
    } else {
      textarea.focus();
    }
  }

  function currentConfigOrStarter(): SysDynConfig {
    const text = textarea.value.trim();
    return text ? parseAny(text) : parseAny(NEW_MODEL_YAML);
  }

  function updateConfig(mutator: (config: SysDynConfig) => void): void {
    try {
      const config = currentConfigOrStarter();
      mutator(config);
      textarea.value = toYAML(config);
      markDirty();
      setStatus('Builder updated the source. Autosaved as a draft — run Parse & Run to apply.', 'idle');
    } catch (error) {
      reportError(error);
    }
  }

  function byId(value: string): HTMLInputElement | null {
    return container.querySelector<HTMLInputElement>(`#${value}`);
  }

  function bindBuilder(): void {
    pick<HTMLButtonElement>('#b_add_param').addEventListener('click', () => {
      const name = byId('b_p_name')?.value.trim();
      const value = Number(byId('b_p_value')?.value);
      if (!name || !Number.isFinite(value)) return;
      updateConfig(config => {
        config.model.parameters = config.model.parameters ?? [];
        config.model.parameters.push({ name, value, concept: 'parameter' });
      });
    });
    pick<HTMLButtonElement>('#b_add_stock').addEventListener('click', () => {
      const name = byId('b_s_name')?.value.trim();
      const initial = Number(byId('b_s_init')?.value || '0');
      if (!name) return;
      updateConfig(config => {
        config.model.stocks = config.model.stocks ?? [];
        config.model.stocks.push({ name, initial, concept: 'stock', inflows: [], outflows: [] });
      });
    });
    pick<HTMLButtonElement>('#b_add_flow').addEventListener('click', () => {
      const name = byId('b_f_name')?.value.trim();
      const equation = byId('b_f_eq')?.value.trim();
      const from = byId('b_f_from')?.value.trim();
      const to = byId('b_f_to')?.value.trim();
      if (!name || !equation) return;
      updateConfig(config => {
        config.model.flows = config.model.flows ?? [];
        config.model.flows.push({
          name,
          equation,
          from: from || undefined,
          to: to || undefined,
          concept: 'flow',
        });
        if (from) {
          const stock = (config.model.stocks ?? []).find(item => item.name === from);
          if (stock) stock.outflows = Array.from(new Set([...(stock.outflows ?? []), name]));
        }
        if (to) {
          const stock = (config.model.stocks ?? []).find(item => item.name === to);
          if (stock) stock.inflows = Array.from(new Set([...(stock.inflows ?? []), name]));
        }
      });
    });
    pick<HTMLButtonElement>('#b_add_aux').addEventListener('click', () => {
      const name = byId('b_a_name')?.value.trim();
      const equation = byId('b_a_eq')?.value.trim();
      if (!name || !equation) return;
      updateConfig(config => {
        config.model.auxiliaries = config.model.auxiliaries ?? [];
        config.model.auxiliaries.push({ name, equation, concept: 'auxiliary' });
      });
    });
    pick<HTMLButtonElement>('#b_apply').addEventListener('click', () => {
      const start = Number(byId('b_start')?.value);
      const stop = Number(byId('b_stop')?.value);
      const dt = Number(byId('b_dt')?.value);
      try {
        const config = currentConfigOrStarter();
        config.model.time = {
          ...config.model.time,
          start: Number.isFinite(start) ? start : config.model.time.start,
          stop: Number.isFinite(stop) ? stop : config.model.time.stop,
          dt: Number.isFinite(dt) && dt > 0 ? dt : config.model.time.dt,
        };
        textarea.value = toYAML(config);
        markDirty();
        parseAndRun(true);
        setTab('dashboard');
      } catch (error) {
        reportError(error);
      }
    });
  }

  function loadSample(): void {
    const seed = getBuiltinSeed(model?.id ?? id);
    if (!seed) {
      toast('No builtin sample is available for this model.', 'error');
      return;
    }
    textarea.value = seed.yaml;
    parseAndRun(true);
    toast('Loaded the builtin sample.', 'success');
  }

  function resetToSample(): void {
    if (!model?.builtin) return;
    const seed = getBuiltinSeed(model.id);
    if (!seed) {
      toast('No builtin sample is available for this model.', 'error');
      return;
    }
    const confirmed = window.confirm(`Reset “${model.title}” to the builtin sample? Local edits will be lost.`);
    if (!confirmed) return;
    textarea.value = seed.yaml;
    parseAndRun(true);
    toast('Reset to the builtin sample.', 'success');
  }

  function duplicateModel(): void {
    if (!model) return;
    const copy = store.duplicate(model.id);
    if (!copy) {
      toast('Could not duplicate this model.', 'error');
      return;
    }
    toast(`Duplicated as “${copy.title}”.`, 'success');
    window.dispatchEvent(new Event('sysdyn:models-changed'));
    window.location.hash = `#/models/${encodeURIComponent(copy.id)}`;
  }

  function deleteModel(): void {
    if (!model) return;
    const confirmed = window.confirm(`Delete “${model.title}”? This cannot be undone.`);
    if (!confirmed) return;
    suppressCleanupSave = true;
    store.remove(model.id);
    toast(`Deleted “${model.title}”.`, 'info');
    window.dispatchEvent(new Event('sysdyn:models-changed'));
    window.location.hash = '#/models';
  }

  function exportYaml(): void {
    if (!model) return;
    let text = textarea.value;
    try {
      if (text.trim().startsWith('{')) text = toYAML(parseJSON(text));
    } catch {
      // Export the raw source so the user can inspect a broken draft.
    }
    download(`${model.id}.yaml`, text, 'text/yaml');
  }

  function exportJson(): void {
    if (!model) return;
    try {
      const config = parseAny(textarea.value);
      download(`${model.id}.json`, toJSON(config), 'application/json');
    } catch (error) {
      toast(`Cannot export JSON: ${errorMessage(error)}`, 'error');
    }
  }

  function closeMenu(): void {
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  function onDocumentClick(event: MouseEvent): void {
    if (menu.hidden) return;
    const target = event.target;
    if (target instanceof Node && menu.contains(target)) return;
    if (target instanceof Node && menuBtn.contains(target)) return;
    closeMenu();
  }

  menuBtn.addEventListener('click', () => {
    const nextHidden = !menu.hidden;
    menu.hidden = nextHidden;
    menuBtn.setAttribute('aria-expanded', nextHidden ? 'false' : 'true');
  });
  menu.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (!actionEl) return;
    closeMenu();
    switch (actionEl.dataset.action) {
      case 'duplicate':
        duplicateModel();
        break;
      case 'reset':
        resetToSample();
        break;
      case 'delete':
        deleteModel();
        break;
      default:
        break;
    }
  });

  for (const button of tabs) {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab === 'edit' ? 'edit' : 'dashboard';
      setTab(tab);
    });
  }

  noticeEl.addEventListener('click', event => {
    const target = event.target;
    if (target instanceof Element && target.closest('[data-notice-action="edit"]')) setTab('edit');
  });

  playBtn.addEventListener('click', () => setPlaying(!playing));
  resetBtn.addEventListener('click', () => {
    setPlaying(false);
    if (!sim) return;
    idx = 0;
    acc = 0;
    updateFrame();
  });
  stepBackBtn.addEventListener('click', () => {
    setPlaying(false);
    if (!sim) return;
    idx = Math.max(0, idx - 1);
    updateFrame();
  });
  stepForwardBtn.addEventListener('click', () => {
    setPlaying(false);
    if (!sim) return;
    idx = Math.min(sim.series.length - 1, idx + 1);
    updateFrame();
  });
  speedSelect.addEventListener('change', () => {
    speed = Number(speedSelect.value) || 1;
  });
  scrubber.addEventListener('input', () => {
    if (!sim) return;
    setPlaying(false);
    idx = Math.max(0, Math.min(sim.series.length - 1, Number(scrubber.value)));
    updateFrame();
  });

  textarea.addEventListener('input', markDirty);
  detailEl.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const chip = target.closest<HTMLElement>('.link-chip');
    const link = chip?.dataset.link;
    if (link) selectElement(link);
  });
  runBtn.addEventListener('click', () => parseAndRun(true));
  loadSampleBtn.addEventListener('click', loadSample);
  saveYamlBtn.addEventListener('click', exportYaml);
  saveJsonBtn.addEventListener('click', exportJson);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      textarea.value = await file.text();
      markDirty();
      parseAndRun(true);
    } catch (error) {
      reportError(error);
    } finally {
      fileInput.value = '';
    }
  });

  exportYamlBtn.addEventListener('click', exportYaml);
  exportJsonBtn.addEventListener('click', exportJson);

  document.addEventListener('click', onDocumentClick);
  bindBuilder();
  const cleanupHelp = bindHelp(container);

  updateHeader();
  updateSaveStatus();
  textarea.value = model.yaml;

  const initialConfig = (() => {
    try {
      return parseAny(model.yaml);
    } catch {
      return null;
    }
  })();

  if (initialConfig) {
    try {
      const { warnings, result } = applyConfig(initialConfig);
      const summary = `OK: ${initialConfig.model.title ?? initialConfig.model.id ?? 'model'} — ${result.series.length} points, ${result.variables.length} variables.`;
      setStatus(
        warnings.length ? `${summary} Warnings: ${warnings.join(' · ')}` : summary,
        warnings.length ? 'warn' : 'ok',
      );
    } catch (error) {
      reportError(error);
      setTab('edit');
    }
  } else {
    const message = 'The saved model source could not be parsed.';
    setStatus(`Error: ${message}`, 'error');
    showNotice(message);
    setTab('edit');
  }

  return () => {
    if (!suppressCleanupSave && saveState === 'unsaved') {
      autosaveNow();
    }
    if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
    playing = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    if (chart) {
      chart.destroy();
      chart = null;
    }
    cleanupHelp();
    document.removeEventListener('click', onDocumentClick);
    container.remove();
  };
}
