// App state and wiring: loading, persistence, selection, search, filters,
// and every graph mutation. Mutations go through small handlers that update
// the graph, patch the render incrementally, and save — the graph in
// localStorage is never allowed to drift from what is on screen.

import { NODE_TYPES, validateGraph, edgeKey } from './schema.js';
import { createLayout } from './layout.js';
import { createView } from './view.js';
import { createRenderer, renderPanel } from './render.js';
import { createForms } from './forms.js';
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
  detail: $('detail'),
  detailType: $('detail-type'),
  detailStatus: $('detail-status'),
  detailLabel: $('detail-label'),
  detailFields: $('detail-fields'),
  detailOutgoing: $('detail-outgoing'),
  detailIncoming: $('detail-incoming'),
  detailId: $('detail-id'),
};

const state = {
  graph: null,
  positions: new Map(),
  selected: null,
  neighbors: new Set(),
  search: '',
  shownTypes: null, // null = no filter (all types visible); a Set isolates those types
  saveFailed: false,
};

const isTypeHidden = (type) => state.shownTypes !== null && !state.shownTypes.has(type);

const view = createView(ui.canvas, ui.viewport);
const renderer = createRenderer(ui, { onSelect: (id) => select(id) });

const nodeById = (id) => state.graph.nodes.find((n) => n.id === id);
const labelOf = (id) => nodeById(id)?.label ?? id;

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
    node.label, node.id, node.type, node.status ?? '',
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
    showEmpty('The graph is empty — tap ＋ to add the first node.');
  } else {
    ui.emptyState.hidden = true;
  }
}

// ---- selection -------------------------------------------------------------

function select(id, { center = false } = {}) {
  if (!nodeById(id)) return;
  state.selected = id;
  state.neighbors = new Set();
  for (const edge of state.graph.edges) {
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
  if (!event.target.closest('.node') && !event.target.closest('#detail')) deselect();
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
    if (patch.status) node.status = patch.status;
    else delete node.status;
    if (patch.fields) node.fields = patch.fields;
    else delete node.fields;
    renderer.updateNode(node);
    renderer.position(state.positions); // size may have changed → re-trim edges
    applyVisibility();
    if (state.selected === id) select(id);
    persist();
  },

  onDeleteNode(id) {
    state.graph.edges = state.graph.edges.filter((edge) => {
      const gone = edge.from === id || edge.to === id;
      if (gone) renderer.removeEdge(edgeKey(edge));
      return !gone;
    });
    state.graph.nodes = state.graph.nodes.filter((n) => n.id !== id);
    renderer.removeNode(id);
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
  forms.openAddNode(new Set(state.graph.nodes.map((n) => n.id)));
});
$('json-btn').addEventListener('click', () => {
  syncPositionsIntoGraph();
  forms.openJson(JSON.stringify(state.graph, null, 2));
});
$('detail-edit').addEventListener('click', () => {
  const node = nodeById(state.selected);
  if (node) forms.openEditNode(node);
});
$('detail-add-edge').addEventListener('click', () => {
  const node = nodeById(state.selected);
  if (node) forms.openAddEdge(node, state.graph);
});
$('detail-delete').addEventListener('click', () => {
  const node = nodeById(state.selected);
  if (!node) return;
  const incident = state.graph.edges.filter(
    (e) => e.from === node.id || e.to === node.id,
  );
  forms.confirmDeleteNode(node, incident, labelOf);
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
  for (const type of NODE_TYPES) {
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
      if (state.selected && isTypeHidden(nodeById(state.selected)?.type)) {
        deselect();
      }
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

// ---- layout ----------------------------------------------------------------

// Settles synchronously: layout is fast at this scale, and an animated settle
// can be interrupted (throttled tabs, quick reloads), which would leave the
// graph half-arranged and the stored positions unwritten.
function startLayout() {
  const radii = new Map();
  for (const [id, size] of renderer.sizes) {
    radii.set(id, Math.max(size.w, size.h) / 2 + 12);
  }
  const layout = createLayout(
    state.graph.nodes.map((n) => n.id),
    state.graph.edges,
    { radii },
  );
  layout.settle();
  state.positions = layout.positions();
  renderer.position(state.positions);
  view.fit(renderer.bounds(state.positions), { animate: false });
  persist(); // stored positions make the next load instant and stable
}

// ---- loading ---------------------------------------------------------------

function showEmpty(message) {
  ui.emptyMessage.textContent = message;
  ui.emptyState.hidden = false;
}

function adoptGraph(graph) {
  state.graph = graph;
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
    renderer.position(state.positions);
    view.fit(renderer.bounds(state.positions), { animate: false });
  } else if (graph.nodes.length > 0) {
    startLayout();
  } else {
    state.positions = new Map();
  }
}

async function loadInitialGraph() {
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
