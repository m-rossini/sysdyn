import Chart from 'chart.js/auto';
import {
  parseYAML,
  parseJSON,
  toJSON,
  toYAML,
  simulate,
  autoLayout,
  builtinConcepts,
  type SysDynConfig,
  type ConceptDef,
} from '@sysdyn/core';

const sample = `version: "1"
model:
  id: inventory-demo
  title: Inventory with Reorder Pulse
  description: Demonstrates stock/flow, pulse, and step primitives.
  time:
    start: 0
    stop: 40
    dt: 0.5
  parameters:
    - name: base_demand
      value: 4
      unit: units/week
      concept: parameter
  stocks:
    - name: inventory
      initial: 30
      unit: units
      inflows: [replenishment]
      outflows: [sales]
      concept: stock
  flows:
    - name: sales
      equation: "base_demand + step(2, 10)"
      from: inventory
      unit: units/week
      concept: flow
    - name: replenishment
      equation: "pulse(40, 5, 10)"
      to: inventory
      unit: units/week
      concept: flow
  auxiliaries:
    - name: weeks
      equation: "t"
      unit: week
      concept: auxiliary
`;

type AnyEl = { name: string; kind: string; concept?: string; equation?: string; initial?: number | string; value?: number; unit?: string; description?: string; from?: string; to?: string; inflows?: string[]; outflows?: string[] };

const els = {
  configText: document.getElementById('configText') as HTMLTextAreaElement,
  run: document.getElementById('run') as HTMLButtonElement,
  loadSample: document.getElementById('loadSample') as HTMLButtonElement,
  playPause: document.getElementById('playPause') as HTMLButtonElement,
  reset: document.getElementById('reset') as HTMLButtonElement,
  stepBack: document.getElementById('stepBack') as HTMLButtonElement,
  stepForward: document.getElementById('stepForward') as HTMLButtonElement,
  speed: document.getElementById('speed') as HTMLSelectElement,
  scrubber: document.getElementById('scrubber') as HTMLInputElement,
  timeLabel: document.getElementById('timeLabel') as HTMLDivElement,
  values: document.getElementById('values') as HTMLDivElement,
  diagram: document.getElementById('diagram') as unknown as SVGSVGElement,
  status: document.getElementById('status') as HTMLDivElement,
  saveJson: document.getElementById('saveJson') as HTMLButtonElement,
  file: document.getElementById('file') as HTMLInputElement,
  chart: document.getElementById('chart') as HTMLCanvasElement,
  vars: document.getElementById('vars') as HTMLDivElement,
  elements: document.getElementById('elements') as HTMLDivElement,
  detail: document.getElementById('detail') as HTMLDivElement,
};

let sim: ReturnType<typeof simulate> | null = null;
let chart: Chart | null = null;
let idx = 0;
let playing = false;
let lastTs = 0;
let acc = 0;
let selected: string | null = null;
let selectedVars: Set<string> = new Set();

function conceptById(id?: string): ConceptDef | undefined {
  if (!id) return undefined;
  const modelConcepts = sim?.config.model.concepts ?? [];
  return modelConcepts.find(c => c.id === id) || builtinConcepts.find(c => c.id === id);
}

function qIcon(title: string) {
  const safe = escapeHtml(title);
  return `<span class="q" role="button" tabindex="0" data-help="${safe}" title="${safe}" aria-label="Help">?</span>`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const RESERVED = new Set(['t','time','dt','pi','e','true','false','null','undefined','step','pulse','ramp','delay','smooth','rand','delay1','delay3','trend','STEP','PULSE','RAMP','DELAY','SMOOTH','DELAY1','DELAY3','TREND','min','max','abs','sqrt','exp','log','log10','sin','cos','tan','pow','mod','floor','ceil','round','if','and','or','not']);

function equationVariables(eq: string): string[] {
  const ids = Array.from(eq.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)).map(m => m[0]);
  return Array.from(new Set(ids.filter(id => !RESERVED.has(id))));
}

function stockRange(name: string): { min: number; max: number } {
  if (!sim) return { min: 0, max: 1 };
  let min = Infinity, max = -Infinity;
  for (const p of sim.series) {
    const v = Number(p.values[name] ?? 0);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (max === min) max = min + 1;
  return { min, max };
}

function flowMax(name: string): number {
  if (!sim) return 1;
  let max = 0;
  for (const p of sim.series) {
    const v = Math.abs(Number(p.values[name] ?? 0));
    if (v > max) max = v;
  }
  return max || 1;
}

function allElements(): AnyEl[] {
  if (!sim) return [];
  const m = sim.config.model;
  return [
    ...(m.parameters ?? []).map(p => ({ ...p, kind: 'parameter', equation: String(p.value) })),
    ...(m.stocks ?? []).map(s => ({ ...s, kind: 'stock', equation: `initial=${s.initial}${s.inflows?.length ? `, inflows=[${s.inflows.join(', ')}]` : ''}${s.outflows?.length ? `, outflows=[${s.outflows.join(', ')}]` : ''}` })),
    ...(m.flows ?? []).map(f => ({ ...f, kind: 'flow' })),
    ...(m.auxiliaries ?? []).map(a => ({ ...a, kind: 'auxiliary' })),
  ];
}

function renderElementsPanel() {
  if (!sim) { els.elements.innerHTML = ''; return; }
  const items = allElements();
  els.elements.innerHTML = items.map(el => {
    const c = conceptById(el.concept);
    const tip = c ? `${c.name}: ${c.summary}` : `${el.kind}`;
    const val = sim!.series[idx]?.values[el.name];
    const eq = el.equation ?? (el as any).equation ?? '';
    return `<div class="elem" data-name="${el.name}">
      <div class="elem-header"><strong>${el.name}</strong> <span><span class="badge">${el.kind}</span>${qIcon(tip)}</span></div>
      ${eq ? `<div class="eq">${eq} ${qIcon('Equation/expression evaluated by math.js using model variables and primitives (step, pulse, ramp, delay, smooth, rand).')}</div>` : ''}
      <div class="help">value @ t=${sim!.series[idx]?.t}: ${val !== undefined ? Number(val).toFixed(3) : 'n/a'} ${el.unit ?? ''}</div>
    </div>`;
  }).join('');
  els.elements.querySelectorAll('.elem').forEach(node => {
    node.addEventListener('click', () => selectElement((node as HTMLElement).dataset.name || null));
  });
}

function selectElement(name: string | null) {
  selected = name;
  if (!sim || !name) {
    els.detail.innerHTML = 'Select an element to see its equation, current value, and concept help.';
    renderDiagram();
    return;
  }
  const m = sim.config.model;
  const val = sim.series[idx]?.values[name];
  const stock = (m.stocks ?? []).find(s => s.name === name);
  const flow = (m.flows ?? []).find(f => f.name === name);
  const aux = (m.auxiliaries ?? []).find(a => a.name === name);
  const param = (m.parameters ?? []).find(p => p.name === name);
  const kind = stock ? 'stock' : flow ? 'flow' : aux ? 'auxiliary' : param ? 'parameter' : 'element';
  const conceptId = (stock?.concept || flow?.concept || aux?.concept || param?.concept || kind);
  const c = conceptById(conceptId) || conceptById(kind);

  let specific = '';
  if (stock) {
    const inflows = stock.inflows ?? [];
    const outflows = stock.outflows ?? [];
    const inflowHtml = inflows.length ? `<ul>${inflows.map(fn => {
      const fd = (m.flows ?? []).find(f => f.name === fn);
      const fv = sim!.series[idx]?.values[fn];
      return `<li><strong>${fn}</strong> (inflow) = ${fv !== undefined ? Number(fv).toFixed(4) : 'n/a'} ${fd?.unit ?? ''}<div class="eq">${escapeHtml(fd?.equation ?? '(no equation)')}</div></li>`;
    }).join('')}</ul>` : '<div class="muted">No inflows.</div>';
    const outflowHtml = outflows.length ? `<ul>${outflows.map(fn => {
      const fd = (m.flows ?? []).find(f => f.name === fn);
      const fv = sim!.series[idx]?.values[fn];
      return `<li><strong>${fn}</strong> (outflow) = ${fv !== undefined ? Number(fv).toFixed(4) : 'n/a'} ${fd?.unit ?? ''}<div class="eq">${escapeHtml(fd?.equation ?? '(no equation)')}</div></li>`;
    }).join('')}</ul>` : '<div class="muted">No outflows.</div>';
    specific = `
      <div><strong>What this stock represents:</strong> ${escapeHtml(stock.description || `${stock.name} is an accumulation (stock). It stores quantity over time and changes based on inflows minus outflows.`)}</div>
      <div><strong>Initial:</strong> ${stock.initial} ${stock.unit ?? ''}</div>
      <div><strong>Current level (volume):</strong> ${val !== undefined ? Number(val).toFixed(4) : 'n/a'} ${stock.unit ?? ''} @ t=${sim.series[idx]?.t}</div>
      <div><strong>Inflows</strong> ${qIcon('Flows that increase this stock.')}</div>${inflowHtml}
      <div><strong>Outflows</strong> ${qIcon('Flows that decrease this stock.')}</div>${outflowHtml}
      <div class="help">Net change rate now = (sum inflows - sum outflows) applied over dt=${sim.config.model.time.dt}.</div>
    `;
  } else if (flow) {
    const vars = equationVariables(flow.equation);
    const varsHtml = vars.length ? `<ul>${vars.map(vn => {
      const vv = sim!.series[idx]?.values[vn];
      return `<li><code>${vn}</code> = ${vv !== undefined ? Number(vv).toFixed(4) : 'n/a'}</li>`;
    }).join('')}</ul>` : '<div class="muted">No variable references detected (constant/expression-only).</div>';
    specific = `
      <div><strong>What this flow does:</strong> ${escapeHtml(flow.description || `${flow.name} is a flow rate that moves quantity per unit time.`)}</div>
      <div><strong>From:</strong> ${flow.from || 'source/cloud'}</div>
      <div><strong>To:</strong> ${flow.to || 'sink/cloud'}</div>
      <div><strong>Current rate:</strong> ${val !== undefined ? Number(val).toFixed(4) : 'n/a'} ${flow.unit ?? ''} @ t=${sim.series[idx]?.t}</div>
      <div><strong>Math (equation)</strong> ${qIcon('Flow rate equation evaluated by the engine (math.js + SD primitives).')}</div>
      <div class="eq">${escapeHtml(flow.equation)}</div>
      <div><strong>Variables in this flow</strong> ${qIcon('Variables referenced by the equation and their current values at the selected time.')}</div>
      ${varsHtml}
    `;
  } else if (aux) {
    const vars = equationVariables(aux.equation);
    const varsHtml = vars.length ? `<ul>${vars.map(vn => `<li><code>${vn}</code> = ${Number(sim!.series[idx]?.values[vn] ?? NaN).toFixed(4)}</li>`).join('')}</ul>` : '';
    specific = `
      <div><strong>Auxiliary:</strong> ${escapeHtml(aux.description || 'Intermediate calculation used by flows/stocks.')}</div>
      <div><strong>Equation:</strong></div><div class="eq">${escapeHtml(aux.equation)}</div>
      <div><strong>Current value:</strong> ${val !== undefined ? Number(val).toFixed(4) : 'n/a'} ${aux.unit ?? ''}</div>
      ${varsHtml ? `<div><strong>Variables:</strong></div>${varsHtml}` : ''}
    `;
  } else if (param) {
    specific = `
      <div><strong>Parameter:</strong> ${escapeHtml(param.description || 'Constant/scenario input used in equations.')}</div>
      <div><strong>Value:</strong> ${param.value} ${param.unit ?? ''}</div>
    `;
  }

  const refs = c?.references?.length ? `<ul>${c.references.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : '<div class="muted">No references listed.</div>';
  const examples = c?.examples?.length ? `<div><strong>Examples:</strong> ${c.examples.map(escapeHtml).join(', ')}</div>` : '';
  els.detail.innerHTML = `
    <div><strong>${name}</strong> <span class="badge">${kind}</span> ${qIcon('Click diagram nodes or list items to inspect behavior, equations, and connections.')}</div>
    ${specific}
    ${c ? `<hr/><div><strong>Concept reference: ${escapeHtml(c.name)}</strong> ${qIcon(c.summary)}</div><div>${escapeHtml(c.summary)}</div>${c.whenToUse ? `<div><strong>When to use:</strong> ${escapeHtml(c.whenToUse)}</div>` : ''}${examples}${c.mathNotes ? `<div><strong>Math notes:</strong> ${escapeHtml(c.mathNotes)}</div>` : ''}<div><strong>References:</strong></div>${refs}` : ''}
  `;
  renderDiagram();
}

function renderDiagram() {
  if (!sim) return;
  const layout = autoLayout(sim.config.model);
  const svg = els.diagram;
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `<marker id="arrow-flow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#2563eb" /></marker>`;
  svg.appendChild(defs);

  for (const e of layout.edges) {
    const from = layout.nodes.find(n => n.id === e.from);
    const to = layout.nodes.find(n => n.id === e.to);
    if (!from || !to) continue;
    const x1 = from.x + from.width / 2;
    const y1 = from.y + from.height / 2;
    const x2 = to.x + to.width / 2;
    const y2 = to.y + to.height / 2;
    const mx = (x1 + x2) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = Math.abs(y1 - y2) > 30 ? `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}` : `M ${x1} ${y1} L ${x2} ${y2}`;
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    let stroke = e.type === 'flow' ? '#2563eb' : '#94a3b8';
    let width = e.type === 'flow' ? 2.5 : 1.5;
    if (e.type === 'flow') {
      // find flow node involved in this edge to size by magnitude
      const flowNode = [from, to].find(n => n.type === 'flow');
      if (flowNode) {
        const fv = Math.abs(Number(sim.series[idx]?.values[flowNode.id] ?? 0));
        const fm = flowMax(flowNode.id);
        width = 1.5 + 8 * Math.min(1, fv / fm);
      }
      path.setAttribute('marker-end', 'url(#arrow-flow)');
    }
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', String(width));
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
  }

  for (const n of layout.nodes) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const isCloud = n.type === 'cloud';
    const val = sim.series[idx]?.values[n.id];
    if (!isCloud) { g.style.cursor = 'pointer'; g.addEventListener('click', () => selectElement(n.id)); }

    if (isCloud) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      c.setAttribute('cx', String(n.x + n.width / 2)); c.setAttribute('cy', String(n.y + n.height / 2));
      c.setAttribute('rx', String(n.width / 2)); c.setAttribute('ry', String(n.height / 2));
      c.setAttribute('fill', '#f8fafc'); c.setAttribute('stroke', '#64748b');
      c.setAttribute('stroke-dasharray', '4 3');
      g.appendChild(c);
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', String(n.x + n.width / 2)); t.setAttribute('y', String(n.y + n.height / 2 + 4));
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '10'); t.setAttribute('fill', '#64748b');
      t.textContent = 'cloud';
      g.appendChild(t);
      svg.appendChild(g);
      continue;
    }

    if (n.type === 'stock') {
      // Tank: outline + water fill proportional to value
      const x = n.x, y = n.y, w = n.width, h = n.height;
      const range = stockRange(n.id);
      const v = Number(val ?? 0);
      const denom = (Math.max(range.max, 0) - Math.min(0, range.min)) || 1;
      const frac = Math.max(0, Math.min(1, (v - Math.min(0, range.min)) / denom));
      const pad = 5;
      const innerH = h - pad * 2;
      const fillH = innerH * frac;
      const defs = svg.querySelector('defs') || svg.insertBefore(document.createElementNS('http://www.w3.org/2000/svg', 'defs'), svg.firstChild);
      const gradId = `water-${n.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      if (!svg.querySelector(`#${gradId}`)) {
        const lg = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        lg.setAttribute('id', gradId); lg.setAttribute('x1', '0'); lg.setAttribute('x2', '0'); lg.setAttribute('y1', '0'); lg.setAttribute('y2', '1');
        lg.innerHTML = `<stop offset="0%" stop-color="#7dd3fc"/><stop offset="100%" stop-color="#2563eb"/>`;
        defs.appendChild(lg);
      }
      const outline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      outline.setAttribute('x', String(x)); outline.setAttribute('y', String(y));
      outline.setAttribute('width', String(w)); outline.setAttribute('height', String(h));
      outline.setAttribute('rx', '14'); outline.setAttribute('fill', '#f8fbff');
      outline.setAttribute('stroke', selected === n.id ? '#dc2626' : '#334155');
      outline.setAttribute('stroke-width', selected === n.id ? '3' : '2');
      g.appendChild(outline);
      if (fillH > 0.5) {
        const fill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        fill.setAttribute('x', String(x + pad)); fill.setAttribute('y', String(y + h - pad - fillH));
        fill.setAttribute('width', String(w - pad * 2)); fill.setAttribute('height', String(Math.max(0, fillH)));
        fill.setAttribute('rx', '10'); fill.setAttribute('fill', `url(#${gradId})`); fill.setAttribute('opacity', '0.9');
        g.appendChild(fill);
      }
      // tank ticks
      for (let i = 1; i < 4; i++) {
        const ty = y + pad + (innerH * i) / 4;
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tick.setAttribute('x1', String(x + 8)); tick.setAttribute('y1', String(ty));
        tick.setAttribute('x2', String(x + w - 8)); tick.setAttribute('y2', String(ty));
        tick.setAttribute('stroke', '#cbd5e1'); tick.setAttribute('stroke-width', '1');
        tick.setAttribute('opacity', '0.6');
        g.appendChild(tick);
      }
    } else {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(n.x)); rect.setAttribute('y', String(n.y));
      rect.setAttribute('width', String(n.width)); rect.setAttribute('height', String(n.height));
      rect.setAttribute('rx', n.type === 'flow' ? '18' : '12');
      rect.setAttribute('fill', n.type === 'flow' ? '#dcfce7' : '#f3f4f6');
      rect.setAttribute('stroke', selected === n.id ? '#dc2626' : '#334155');
      rect.setAttribute('stroke-width', selected === n.id ? '3' : '1.5');
      g.appendChild(rect);
      if (n.type === 'flow') {
        // valve marker
        const vx = n.x + n.width / 2, vy = n.y + n.height / 2;
        const tri = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        tri.setAttribute('points', `${vx-8},${vy-10} ${vx+8},${vy-10} ${vx},${vy+2}`);
        tri.setAttribute('fill', '#16a34a'); tri.setAttribute('opacity', '0.25');
        g.appendChild(tri);
      }
    }

    const el = allElements().find(e => e.name === n.id);
    const cpt = conceptById(el?.concept) || conceptById(n.type);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${n.id} (${n.type})${cpt ? `\n${cpt.name}: ${cpt.summary}` : ''}`;
    const firstShape = g.querySelector('rect,ellipse,polygon');
    (firstShape || g.firstChild)?.appendChild(title);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(n.x + n.width / 2));
    text.setAttribute('y', String(n.y + n.height / 2 - 2));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '12');
    text.setAttribute('font-weight', selected === n.id ? '700' : '600');
    text.setAttribute('fill', '#0f172a');
    text.textContent = n.id;
    g.appendChild(text);
    const t2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t2.setAttribute('x', String(n.x + n.width / 2));
    t2.setAttribute('y', String(n.y + n.height / 2 + 14));
    t2.setAttribute('text-anchor', 'middle');
    t2.setAttribute('font-size', '11');
    t2.setAttribute('fill', '#111827');
    t2.textContent = val !== undefined ? Number(val).toFixed(2) : '';
    g.appendChild(t2);

    svg.appendChild(g);
  }
}

function renderVarPicker() {
  if (!sim) { els.vars.innerHTML = ''; return; }
  const candidates = sim.variables.filter(v => v !== 't' && v !== 'time');
  if (selectedVars.size === 0) {
    const defaults = candidates.filter(k => (sim!.config.model.stocks ?? []).some(s => s.name === k) || (sim!.config.model.flows ?? []).some(f => f.name === k));
    (defaults.length ? defaults : candidates.slice(0, 4)).forEach(v => selectedVars.add(v));
  }
  els.vars.innerHTML = candidates.map(v => `<label><input type="checkbox" data-var="${v}" ${selectedVars.has(v) ? 'checked' : ''}/> ${v}</label>`).join('');
  els.vars.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const name = (e.target as HTMLInputElement).dataset.var!;
      if ((e.target as HTMLInputElement).checked) selectedVars.add(name); else selectedVars.delete(name);
      renderChart();
    });
  });
}

function renderChart() {
  if (!sim) return;
  const labels = sim.series.map(p => p.t);
  const show = Array.from(selectedVars).filter(v => sim!.variables.includes(v)).slice(0, 8);
  const colors = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#0f766e', '#b45309'];
  const datasets = show.map((k, i) => ({
    label: k,
    data: sim!.series.map(p => p.values[k] ?? 0),
    borderColor: colors[i % colors.length],
    backgroundColor: 'transparent',
    tension: 0.15,
    pointRadius: 0,
  }));
  if (chart) chart.destroy();
  chart = new Chart(els.chart, {
    type: 'line',
    data: { labels, datasets },
    options: { animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false } }
  });
}

function updateTimeUI() {
  if (!sim) return;
  els.scrubber.max = String(sim.series.length - 1);
  els.scrubber.value = String(idx);
  const p = sim.series[idx];
  els.timeLabel.textContent = `t = ${p.t} (step ${idx + 1}/${sim.series.length}, dt=${sim.config.model.time.dt})`;
  const keys = Array.from(selectedVars).slice(0, 10);
  els.values.textContent = keys.map(k => `${k}: ${Number(p.values[k] ?? 0).toFixed(3)}`).join('\n');
  renderElementsPanel();
  renderDiagram();
  if (selected) selectElement(selected);
}

function loadConfigObject(): SysDynConfig {
  const txt = els.configText.value.trim();
  if (!txt) {
    return { version: '1', model: { time: { start: 0, stop: 40, dt: 1 }, parameters: [], stocks: [], flows: [], auxiliaries: [] } };
  }
  return txt.startsWith('{') ? parseJSON(txt) : parseYAML(txt);
}

function writeConfigObject(config: SysDynConfig) {
  els.configText.value = toYAML(config);
}

function bindBuilder() {
  const byId = (id: string) => document.getElementById(id) as HTMLInputElement | null;
  const add = (id: string, handler: () => void) => document.getElementById(id)?.addEventListener('click', handler);
  add('b_add_param', () => {
    const name = byId('b_p_name')?.value.trim(); const value = Number(byId('b_p_value')?.value);
    if (!name || !Number.isFinite(value)) return;
    const cfg = loadConfigObject();
    cfg.model.parameters = cfg.model.parameters ?? [];
    cfg.model.parameters.push({ name, value, concept: 'parameter' });
    writeConfigObject(cfg);
  });
  add('b_add_stock', () => {
    const name = byId('b_s_name')?.value.trim(); const initial = Number(byId('b_s_init')?.value || '0');
    if (!name) return;
    const cfg = loadConfigObject();
    cfg.model.stocks = cfg.model.stocks ?? [];
    cfg.model.stocks.push({ name, initial, concept: 'stock', inflows: [], outflows: [] });
    writeConfigObject(cfg);
  });
  add('b_add_flow', () => {
    const name = byId('b_f_name')?.value.trim(); const equation = byId('b_f_eq')?.value.trim();
    const from = byId('b_f_from')?.value.trim(); const to = byId('b_f_to')?.value.trim();
    if (!name || !equation) return;
    const cfg = loadConfigObject();
    cfg.model.flows = cfg.model.flows ?? [];
    cfg.model.flows.push({ name, equation, from: from || undefined, to: to || undefined, concept: 'flow' });
    if (from) {
      const s = (cfg.model.stocks ?? []).find(x => x.name === from);
      if (s) { s.outflows = Array.from(new Set([...(s.outflows ?? []), name])); }
    }
    if (to) {
      const s = (cfg.model.stocks ?? []).find(x => x.name === to);
      if (s) { s.inflows = Array.from(new Set([...(s.inflows ?? []), name])); }
    }
    writeConfigObject(cfg);
  });
  add('b_add_aux', () => {
    const name = byId('b_a_name')?.value.trim(); const equation = byId('b_a_eq')?.value.trim();
    if (!name || !equation) return;
    const cfg = loadConfigObject();
    cfg.model.auxiliaries = cfg.model.auxiliaries ?? [];
    cfg.model.auxiliaries.push({ name, equation, concept: 'auxiliary' });
    writeConfigObject(cfg);
  });
  add('b_apply', () => {
    const cfg = loadConfigObject();
    const start = Number(byId('b_start')?.value ?? cfg.model.time.start);
    const stop = Number(byId('b_stop')?.value ?? cfg.model.time.stop);
    const dt = Number(byId('b_dt')?.value ?? cfg.model.time.dt);
    cfg.model.time = { ...cfg.model.time, start, stop, dt };
    writeConfigObject(cfg);
    runModel();
  });
}

function runModel() {
  try {
    const txt = els.configText.value;
    const config: SysDynConfig = txt.trim().startsWith('{') ? parseJSON(txt) : parseYAML(txt);
    // sync builder time fields from config
    (document.getElementById('b_start') as HTMLInputElement | null)!.value = String(config.model.time.start);
    (document.getElementById('b_stop') as HTMLInputElement | null)!.value = String(config.model.time.stop);
    (document.getElementById('b_dt') as HTMLInputElement | null)!.value = String(config.model.time.dt);
    sim = simulate(config, { integrator: 'euler' });
    idx = 0;
    playing = false;
    acc = 0;
    selected = null;
    selectedVars = new Set();
    renderVarPicker();
    renderElementsPanel();
    renderDiagram();
    renderChart();
    updateTimeUI();
    syncPlayButton();
    els.status.textContent = `OK: ${sim.config.model.title ?? sim.config.model.id ?? 'model'} — ${sim.series.length} points, ${sim.variables.length} variables.`;
  } catch (e: any) {
    els.status.textContent = `Error: ${e.message ?? String(e)}`;
    console.error(e);
  }
}

function tick(ts: number) {
  if (!playing || !sim) { lastTs = ts; requestAnimationFrame(tick); return; }
  if (!lastTs) lastTs = ts;
  const delta = (ts - lastTs) / 1000;
  lastTs = ts;
  const speed = Number(els.speed.value || '1');
  acc += delta * speed;
  const stepDuration = 0.18;
  while (acc >= stepDuration && idx < sim.series.length - 1) {
    idx++;
    acc -= stepDuration;
  }
  if (idx >= sim.series.length - 1) playing = false;
  syncPlayButton();
  updateTimeUI();
  requestAnimationFrame(tick);
}

function syncPlayButton() {
  els.playPause.textContent = playing ? 'Pause' : 'Play';
}

els.run.addEventListener('click', runModel);
els.loadSample.addEventListener('click', () => { els.configText.value = sample; runModel(); });
els.playPause.addEventListener('click', () => {
  if (!sim) return;
  playing = !playing;
  if (playing && idx >= sim.series.length - 1) idx = 0;
  syncPlayButton();
});
els.reset.addEventListener('click', () => {
  if (!sim) return;
  playing = false;
  idx = 0;
  acc = 0;
  syncPlayButton();
  updateTimeUI();
});
els.stepForward.addEventListener('click', () => { if (!sim) return; playing = false; idx = Math.min(sim.series.length - 1, idx + 1); syncPlayButton(); updateTimeUI(); });
els.stepBack.addEventListener('click', () => { if (!sim) return; playing = false; idx = Math.max(0, idx - 1); syncPlayButton(); updateTimeUI(); });
els.scrubber.addEventListener('input', () => { if (!sim) return; playing = false; idx = Number(els.scrubber.value); syncPlayButton(); updateTimeUI(); });
els.saveJson.addEventListener('click', () => {
  if (!sim) return;
  const blob = new Blob([toJSON(sim.config)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${sim.config.model.id ?? 'model'}.json`;
  a.click();
});
els.file.addEventListener('change', async () => {
  const f = els.file.files?.[0];
  if (!f) return;
  els.configText.value = await f.text();
  runModel();
});

function bindHelpIcons() {
  const showHelp = (text: string) => {
    els.detail.innerHTML = `<div><strong>Help</strong></div><div>${text}</div>`;
  };
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const q = target?.closest?.('.q') as HTMLElement | null;
    if (q && q.dataset.help) {
      e.preventDefault();
      e.stopPropagation();
      showHelp(q.dataset.help);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target as HTMLElement | null;
    if (target?.classList?.contains('q') && target.dataset.help) {
      e.preventDefault();
      e.stopPropagation();
      els.detail.innerHTML = `<div><strong>Help</strong></div><div>${target.dataset.help}</div>`;
    }
  });
}

els.configText.value = sample;
bindBuilder();
bindHelpIcons();
runModel();
requestAnimationFrame(tick);
