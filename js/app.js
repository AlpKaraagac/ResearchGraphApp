// App state and wiring: loading, persistence, selection, search, filters,
// and every graph mutation. No lint and no rules — the graph is whatever the
// author says it is; the app's job is to render it and not lose it.

import { NODE_TYPES, validateGraph, edgeKey, allEdges, childrenOf } from './schema.js';
import { createLayout, separateRects } from './layout.js';
import { createView } from './view.js';
import { createRenderer, renderPanel } from './render.js';
import { createForms, slugify } from './forms.js';
import { toCanvas, importText, buildSelfContainedHtml, download } from './exporter.js';
import {
  parseSourcesText, planSourceImport, applySourcePatch, zoteroPull,
} from './sources.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);

const ui = {
  title: $('graph-title'),
  saveIndicator: $('save-indicator'),
  search: $('search'),
  filters: $('type-filters'),
  canvas: $('canvas'),
  viewport: $('viewport'),
  nodeLayer: $('node-layer'),
  edgeLines: $('edge-lines'),
  edgeLabels: $('edge-labels'),
  emptyState: $('empty-state'),
  emptyMessage: $('empty-message'),
  undoClear: $('undo-clear'),
  clearDialog: $('clear-dialog'),
  clearBody: $('clear-body'),
  detail: $('detail'),
  detailType: $('detail-type'),
  detailStatus: $('detail-status'),
  detailLabel: $('detail-label'),
  detailBody: $('detail-body'),
  detailFields: $('detail-fields'),
  detailOutgoing: $('detail-outgoing'),
  detailIncoming: $('detail-incoming'),
  detailId: $('detail-id'),
  shareDialog: $('share-dialog'),
  shareInfo: $('share-info'),
  shareError: $('share-error'),
  importInput: $('import-input'),
  sourcesDialog: $('sources-dialog'),
  sourcesText: $('sources-text'),
  sourcesResult: $('sources-result'),
  sourcesError: $('sources-error'),
  sourcesFileInput: $('sources-file-input'),
  zoteroKey: $('zotero-key'),
  zoteroType: $('zotero-type'),
  zoteroId: $('zotero-id'),
  zoteroPullBtn: $('zotero-pull'),
};

const state = {
  graph: null,
  positions: new Map(),
  selected: null,
  neighbors: new Set(),
  search: '',
  shownTypes: null, // null = no filter; a Set isolates those types
  saveFailed: false,
};

const isTypeHidden = (type) => state.shownTypes !== null && !state.shownTypes.has(type);

const view = createView(ui.canvas, ui.viewport);
const renderer = createRenderer(ui, { onSelect: (id) => select(id) });

const nodeById = (id) => state.graph.nodes.find((n) => n.id === id);
const labelOf = (id) => nodeById(id)?.label ?? id;

// Every type present in the graph, so nodes written under the older schema
// still get a filter chip and a colour.
function typesInGraph() {
  const seen = new Set(NODE_TYPES);
  for (const node of state.graph.nodes) seen.add(node.type);
  return [...seen];
}

// ---- persistence -----------------------------------------------------------

function setSaveIndicator(ok) {
  state.saveFailed = !ok;
  ui.saveIndicator.textContent = ok ? 'Saved' : 'NOT saved — storage error';
  ui.saveIndicator.classList.toggle('err', !ok);
}

function ensureGraphId() {
  state.graph.meta ??= {};
  state.graph.meta.id ??= `graph-${crypto.randomUUID().slice(0, 8)}`;
}

function syncPositionsIntoGraph() {
  for (const node of state.graph.nodes) {
    const p = state.positions.get(node.id);
    if (p) {
      node.x = Math.round(p.x * 10) / 10;
      node.y = Math.round(p.y * 10) / 10;
    }
  }
}

function persist() {
  ensureGraphId();
  state.graph.meta.modified = new Date().toISOString();
  syncPositionsIntoGraph();
  const result = store.save(state.graph);
  setSaveIndicator(result.ok);
}

window.addEventListener('beforeunload', (event) => {
  if (state.saveFailed) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// ---- visibility state ------------------------------------------------------

function matchesSearch(node) {
  const q = state.search;
  if (!q) return true;
  const haystack = [
    node.label, node.id, node.type, node.status ?? '', node.nature ?? '',
    node.description ?? '', node.result ?? '',
    ...Object.values(node.fields ?? {}),
  ].join('\n').toLowerCase();
  return haystack.includes(q);
}

function applyVisibility() {
  renderer.setState(state.graph, {
    selectedId: state.selected,
    isHidden: (node) => isTypeHidden(node.type),
    isDim: (node) => {
      if (state.search && !matchesSearch(node)) return true;
      if (state.selected) return node.id !== state.selected && !state.neighbors.has(node.id);
      return false;
    },
    isEdgeActive: (edge) =>
      state.selected !== null && (edge.from === state.selected || edge.to === state.selected),
  });
}

function refreshEmptyState() {
  if (state.graph && state.graph.nodes.length === 0) {
    const backup = store.loadBackup(state.graph.meta?.id);
    showEmpty(backup
      ? `Cleared — ${backup.nodes.length} node${backup.nodes.length === 1 ? '' : 's'} removed. Tap ＋ to start again.`
      : 'The graph is empty — tap ＋ to add the first question.');
    ui.undoClear.hidden = !backup;
  } else {
    ui.emptyState.hidden = true;
    ui.undoClear.hidden = true;
  }
}

// ---- selection -------------------------------------------------------------

function select(id, { center = false } = {}) {
  if (!nodeById(id)) return;
  state.selected = id;
  state.neighbors = new Set();
  for (const edge of allEdges(state.graph)) {
    if (edge.from === id) state.neighbors.add(edge.to);
    if (edge.to === id) state.neighbors.add(edge.from);
  }
  applyVisibility();
  renderPanel(ui, state.graph, id, {
    onFollow: (otherId) => select(otherId, { center: true }),
    onDeleteEdge: (edge) => forms.confirmDeleteEdge(edge, labelOf),
  });
  if (center) {
    const p = state.positions.get(id);
    if (p) view.centerOn(p.x, p.y);
  }
}

function deselect() {
  state.selected = null;
  state.neighbors = new Set();
  ui.detail.hidden = true;
  applyVisibility();
}

ui.canvas.addEventListener('click', (event) => {
  // a panel row's click detaches the row when the panel re-renders mid-dispatch;
  // a detached target has no ancestors, which would read as a background click
  if (!event.target.isConnected) return;
  if (event.target.closest('#add-node-btn')) return;
  if (event.target.closest('#detail')) return;
  if (!event.target.closest('.node')) deselect();
});
$('detail-close').addEventListener('click', deselect);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) deselect();
});

// ---- mutations -------------------------------------------------------------

const forms = createForms({
  onCreateNode(node) {
    state.graph.nodes.push(node);
    state.positions.set(node.id, view.worldCenter());
    renderer.addNode(node);
    renderer.rebuildEdges(state.graph); // a parent link is an edge to draw
    renderer.position(state.positions);
    buildFilterChips();
    refreshEmptyState();
    persist();
    select(node.id);
  },

  onUpdateNode(id, patch) {
    const node = nodeById(id);
    if (!node) return;
    node.label = patch.label;
    for (const key of ['status', 'nature', 'description', 'result', 'parent']) {
      if (patch[key]) node[key] = patch[key];
      else delete node[key];
    }
    if (patch.fields) node.fields = patch.fields;
    else delete node.fields;
    renderer.updateNode(node);
    renderer.rebuildEdges(state.graph);
    renderer.position(state.positions); // size may have changed → re-trim edges
    applyVisibility();
    if (state.selected === id) select(id);
    persist();
  },

  onDeleteNode(id) {
    state.graph.edges = state.graph.edges.filter(
      (edge) => edge.from !== id && edge.to !== id,
    );
    for (const child of childrenOf(state.graph, id)) delete child.parent;
    state.graph.nodes = state.graph.nodes.filter((n) => n.id !== id);
    renderer.removeNode(id);
    renderer.rebuildEdges(state.graph);
    renderer.position(state.positions);
    state.positions.delete(id);
    deselect();
    buildFilterChips();
    refreshEmptyState();
    persist();
  },

  onCreateEdge(edge) {
    state.graph.edges.push(edge);
    renderer.addEdge(edge);
    renderer.position(state.positions);
    if (state.selected) select(state.selected);
    else applyVisibility();
    persist();
  },

  onDeleteEdge(edge) {
    const key = edgeKey(edge);
    state.graph.edges = state.graph.edges.filter((e) => edgeKey(e) !== key);
    renderer.removeEdge(key);
    if (state.selected) select(state.selected);
    else applyVisibility();
    persist();
  },

  onApplyJson(graph) {
    adoptGraph(graph);
    persist();
  },
});

$('add-node-btn').addEventListener('click', () => {
  forms.openAddNode(state.graph, new Set(state.graph.nodes.map((n) => n.id)));
});
$('json-btn').addEventListener('click', () => {
  ui.shareDialog.close();
  syncPositionsIntoGraph();
  forms.openJson(JSON.stringify(state.graph, null, 2));
});
$('detail-edit').addEventListener('click', () => {
  const node = nodeById(state.selected);
  if (node) forms.openEditNode(node, state.graph);
});
$('detail-add-edge').addEventListener('click', () => {
  const node = nodeById(state.selected);
  if (node) forms.openAddEdge(node, state.graph);
});
$('detail-delete').addEventListener('click', () => {
  const node = nodeById(state.selected);
  if (!node) return;
  const incident = state.graph.edges.filter((e) => e.from === node.id || e.to === node.id);
  forms.confirmDeleteNode(node, incident, childrenOf(state.graph, node.id), labelOf);
});

// ---- clear, and the undo that makes it safe --------------------------------

$('clear-btn').addEventListener('click', () => {
  const nodes = state.graph.nodes.length;
  const edges = state.graph.edges.length;
  if (nodes === 0 && edges === 0) return; // nothing to clear
  ui.clearBody.textContent =
    `Delete everything in "${state.graph.meta?.title ?? 'this map'}" — `
    + `${nodes} node${nodes === 1 ? '' : 's'} and ${edges} link${edges === 1 ? '' : 's'}?`;
  ui.clearDialog.showModal();
});

$('clear-ok').addEventListener('click', () => {
  ui.clearDialog.close();
  syncPositionsIntoGraph();
  store.saveBackup(state.graph);
  const { id, title } = state.graph.meta ?? {};
  adoptGraph({ version: 2, meta: { id, title }, nodes: [], edges: [] });
  persist();
  deselect();
});

ui.undoClear.addEventListener('click', () => {
  const backup = store.loadBackup(state.graph.meta?.id);
  if (!backup) return;
  adoptGraph(backup);
  store.clearBackup(backup.meta?.id);
  persist();
  refreshEmptyState();
});

// ---- share: export and import ----------------------------------------------

const isEmbeddedCopy = document.getElementById('embedded-graph') !== null;

function shareMessage(text, isError = false) {
  ui.shareInfo.hidden = isError || !text;
  ui.shareError.hidden = !isError || !text;
  (isError ? ui.shareError : ui.shareInfo).textContent = text;
}

function fileSlug() {
  return slugify(state.graph.meta?.title ?? state.graph.meta?.id ?? 'graph');
}

$('share-btn').addEventListener('click', () => {
  shareMessage('');
  // a self-contained copy cannot read its own sources to re-assemble itself
  $('export-html').hidden = isEmbeddedCopy;
  ui.shareDialog.showModal();
});

$('export-json').addEventListener('click', () => {
  syncPositionsIntoGraph();
  download(`${fileSlug()}.json`, JSON.stringify(state.graph, null, 2));
  shareMessage('Graph JSON downloaded.');
});

$('export-canvas').addEventListener('click', () => {
  syncPositionsIntoGraph();
  const canvas = toCanvas(state.graph, renderer.sizes);
  download(`${fileSlug()}.canvas`, JSON.stringify(canvas, null, 2));
  shareMessage('JSON Canvas downloaded — openable in Obsidian and anything else that speaks it.');
});

$('export-html').addEventListener('click', async () => {
  syncPositionsIntoGraph();
  try {
    const html = await buildSelfContainedHtml(state.graph);
    download(`${fileSlug()}.html`, html, 'text/html');
    shareMessage('Self-contained HTML downloaded — it opens anywhere, with nothing installed.');
  } catch (error) {
    shareMessage(`Could not build the HTML export: ${error.message}`, true);
  }
});

$('import-btn').addEventListener('click', () => ui.importInput.click());

ui.importInput.addEventListener('change', async () => {
  const file = ui.importInput.files?.[0];
  ui.importInput.value = '';
  if (!file) return;
  const result = importText(await file.text());
  if (!result.ok) {
    shareMessage(result.message, true);
    return;
  }
  adoptGraph(result.graph);
  persist();
  shareMessage(result.message);
});

// ---- sources import --------------------------------------------------------

function sourcesMessage(text, isError = false) {
  ui.sourcesResult.hidden = isError || !text;
  ui.sourcesError.hidden = !isError || !text;
  (isError ? ui.sourcesError : ui.sourcesResult).textContent = text;
}

function openSourcesDialog() {
  ui.shareDialog.close();
  const settings = store.loadSettings();
  ui.zoteroKey.value = settings.zoteroKey ?? '';
  ui.zoteroType.value = settings.zoteroType ?? 'user';
  ui.zoteroId.value = settings.zoteroId ?? '';
  sourcesMessage('');
  ui.sourcesDialog.showModal();
}

function applySourceImport(plan) {
  for (const { id, patch } of plan.updates) {
    const node = nodeById(id);
    if (!node) continue;
    applySourcePatch(node, patch);
    renderer.updateNode(node);
  }
  const centre = view.worldCenter();
  plan.creates.forEach((node, i) => {
    state.graph.nodes.push(node);
    const angle = i * 2.399963229728653;
    const radius = 60 * Math.sqrt(i + 0.5);
    state.positions.set(node.id, {
      x: centre.x + Math.cos(angle) * radius,
      y: centre.y + Math.sin(angle) * radius,
    });
    renderer.addNode(node);
  });
  renderer.position(state.positions);
  buildFilterChips();
  refreshEmptyState();
  applyVisibility();
  if (state.selected) select(state.selected);
  persist();
}

function runSourcesImport(items, ignored, origin) {
  const plan = planSourceImport(state.graph, items);
  applySourceImport(plan);
  const parts = [
    `${plan.creates.length} new source${plan.creates.length === 1 ? '' : 's'}`,
    `${plan.updates.length} updated`,
  ];
  if (plan.skipped > 0) parts.push(`${plan.skipped} duplicate${plan.skipped === 1 ? '' : 's'} skipped`);
  if (ignored > 0) parts.push(`${ignored} item${ignored === 1 ? '' : 's'} without title or author ignored`);
  sourcesMessage(`${origin}: ${parts.join(', ')}.`);
}

function importSourcesFromText(text, origin = 'Imported') {
  let parsed;
  try {
    parsed = parseSourcesText(text);
  } catch (error) {
    sourcesMessage(error.message, true);
    return;
  }
  runSourcesImport(parsed.items, parsed.ignored, origin);
}

$('import-sources-btn').addEventListener('click', openSourcesDialog);

$('sources-form').addEventListener('submit', (event) => {
  event.preventDefault();
  importSourcesFromText(ui.sourcesText.value);
});

$('sources-file-btn').addEventListener('click', () => ui.sourcesFileInput.click());
ui.sourcesFileInput.addEventListener('change', async () => {
  const file = ui.sourcesFileInput.files?.[0];
  ui.sourcesFileInput.value = '';
  if (!file) return;
  const text = await file.text();
  ui.sourcesText.value = text;
  importSourcesFromText(text, `Imported from ${file.name}`);
});

ui.zoteroPullBtn.addEventListener('click', async () => {
  const config = {
    key: ui.zoteroKey.value.trim(),
    libraryType: ui.zoteroType.value,
    libraryId: ui.zoteroId.value.trim(),
  };
  store.saveSettings({
    zoteroKey: config.key, zoteroType: config.libraryType, zoteroId: config.libraryId,
  });
  ui.zoteroPullBtn.disabled = true;
  ui.zoteroPullBtn.textContent = 'Pulling…';
  try {
    const items = await zoteroPull(config);
    const usable = items.filter((it) => it && typeof it === 'object' && (it.title || it.author));
    runSourcesImport(usable, items.length - usable.length, 'Pulled from Zotero');
  } catch (error) {
    sourcesMessage(error.message, true);
  } finally {
    ui.zoteroPullBtn.disabled = false;
    ui.zoteroPullBtn.textContent = 'Pull items from Zotero';
  }
});

// ---- drag and drop ---------------------------------------------------------

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', async (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  const text = file ? await file.text() : event.dataTransfer?.getData('text/plain');
  if (!text?.trim()) return;

  let isGraphish = text.trim().startsWith('<');
  if (!isGraphish) {
    try {
      isGraphish = Array.isArray(JSON.parse(text).nodes);
    } catch { /* not JSON — fall through to the sources path */ }
  }
  if (isGraphish) {
    const result = importText(text);
    $('export-html').hidden = isEmbeddedCopy;
    ui.shareDialog.showModal();
    if (result.ok) {
      adoptGraph(result.graph);
      persist();
      shareMessage(result.message);
    } else {
      shareMessage(result.message, true);
    }
    return;
  }
  openSourcesDialog();
  ui.sourcesText.value = text;
  importSourcesFromText(text, file ? `Imported from ${file.name}` : 'Imported from drop');
});

// ---- search and filters ----------------------------------------------------

ui.search.addEventListener('input', () => {
  state.search = ui.search.value.trim().toLowerCase();
  applyVisibility();
});

function updateChipStates() {
  for (const chip of ui.filters.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(!isTypeHidden(chip.dataset.type)));
  }
}

function buildFilterChips() {
  ui.filters.replaceChildren();
  const counts = new Map();
  for (const node of state.graph.nodes) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }
  for (const type of typesInGraph()) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip type-${type}`;
    chip.dataset.type = type;
    chip.setAttribute('aria-label', `Show ${type} nodes`);

    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('span');
    name.textContent = type;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(counts.get(type) ?? 0);

    chip.append(dot, name, count);
    // First tap isolates the type; further taps toggle types in and out of
    // the shown set; emptying the set brings every type back.
    chip.addEventListener('click', () => {
      if (state.shownTypes === null) {
        state.shownTypes = new Set([type]);
      } else if (state.shownTypes.has(type)) {
        state.shownTypes.delete(type);
        if (state.shownTypes.size === 0) state.shownTypes = null;
      } else {
        state.shownTypes.add(type);
      }
      updateChipStates();
      if (state.selected && isTypeHidden(nodeById(state.selected)?.type)) deselect();
      applyVisibility();
    });
    ui.filters.append(chip);
  }
  updateChipStates();
}

// ---- view controls ---------------------------------------------------------

$('zoom-in').addEventListener('click', () => view.zoomIn());
$('zoom-out').addEventListener('click', () => view.zoomOut());
$('fit').addEventListener('click', () => view.fit(renderer.bounds(state.positions)));
$('relayout').addEventListener('click', () => startLayout());

// ---- layout ----------------------------------------------------------------

function startLayout() {
  const radii = new Map();
  for (const [id, size] of renderer.sizes) {
    radii.set(id, Math.max(size.w, size.h) / 2 + 24);
  }
  const layout = createLayout(
    state.graph.nodes.map((n) => n.id),
    allEdges(state.graph),
    { radii, sizes: renderer.sizes },
  );
  layout.settle();
  state.positions = layout.positions();
  renderer.position(state.positions);
  view.fit(renderer.bounds(state.positions), { animate: false });
  persist();
}

// ---- loading ---------------------------------------------------------------

function showEmpty(message) {
  ui.emptyMessage.textContent = message;
  ui.emptyState.hidden = false;
}

function adoptGraph(graph) {
  state.graph = graph;
  state.graph.edges ??= [];
  state.selected = null;
  state.neighbors = new Set();
  ui.detail.hidden = true;
  ensureGraphId();
  if (graph.meta?.title) {
    ui.title.textContent = graph.meta.title;
    document.title = `${graph.meta.title} — research graph`;
  }
  buildFilterChips();
  renderer.build(graph);
  refreshEmptyState();
  applyVisibility();

  const stored = graph.nodes.length > 0
    && graph.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
  if (stored) {
    state.positions = new Map(graph.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    // stored arrangements predate layout improvements; heal any overlap
    // in place rather than showing a crowded graph forever
    const healed = separateRects(state.positions, renderer.sizes);
    renderer.position(state.positions);
    view.fit(renderer.bounds(state.positions), { animate: false });
    if (healed) persist();
  } else if (graph.nodes.length > 0) {
    startLayout();
  } else {
    state.positions = new Map();
  }
}

async function loadInitialGraph() {
  // A self-contained export carries its graph inside the file. It wins over
  // localStorage unless this browser holds a NEWER edit of the same graph.
  const embeddedEl = document.getElementById('embedded-graph');
  if (embeddedEl) {
    let embedded = null;
    try {
      embedded = JSON.parse(embeddedEl.textContent);
    } catch { /* falls through to the error below */ }
    if (!embedded || validateGraph(embedded).length > 0) {
      showEmpty('The graph embedded in this file is invalid.');
      return;
    }
    const stored = store.load(embedded.meta?.id);
    const storedIsNewer = stored
      && validateGraph(stored).length === 0
      && (stored.meta?.modified ?? '') > (embedded.meta?.modified ?? '');
    adoptGraph(storedIsNewer ? stored : embedded);
    setSaveIndicator(true);
    return;
  }

  const saved = store.loadCurrent();
  if (saved) {
    const errors = validateGraph(saved);
    if (errors.length === 0) {
      adoptGraph(saved);
      setSaveIndicator(true);
      return;
    }
    showEmpty(`The stored graph is invalid: ${errors[0]}`);
    return;
  }
  try {
    const response = await fetch('examples/demo.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const graph = await response.json();
    const errors = validateGraph(graph);
    if (errors.length > 0) {
      showEmpty(`The example graph is invalid: ${errors[0]}`);
      return;
    }
    adoptGraph(graph);
  } catch (error) {
    showEmpty(
      'Could not load the example graph. If you opened this page as a file, '
      + 'serve the folder instead (e.g. python3 -m http.server) — browsers '
      + `block module and fetch requests from file:// pages. (${error.message})`,
    );
  }
}

loadInitialGraph();
