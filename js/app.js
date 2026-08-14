// App state and wiring. Milestone 2: rendering and navigation only — the
// graph is read-only here; editing and persistence arrive in milestone 3.

import { NODE_TYPES, validateGraph } from './schema.js';
import { createLayout } from './layout.js';
import { createView } from './view.js';
import { createRenderer, renderPanel } from './render.js';

const $ = (id) => document.getElementById(id);

const ui = {
  title: $('graph-title'),
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
  hiddenTypes: new Set(),
};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const view = createView(ui.canvas, ui.viewport);
const renderer = createRenderer(ui, { onSelect: (id) => select(id) });
let layoutFrame = null;

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
    isHidden: (node) => state.hiddenTypes.has(node.type),
    isDim: (node) => {
      if (state.search && !matchesSearch(node)) return true;
      if (state.selected) return node.id !== state.selected && !state.neighbors.has(node.id);
      return false;
    },
    isEdgeActive: (edge) =>
      state.selected !== null && (edge.from === state.selected || edge.to === state.selected),
  });
}

// ---- selection -------------------------------------------------------------

function select(id, { center = false } = {}) {
  state.selected = id;
  state.neighbors = new Set();
  for (const edge of state.graph.edges) {
    if (edge.from === id) state.neighbors.add(edge.to);
    if (edge.to === id) state.neighbors.add(edge.from);
  }
  applyVisibility();
  renderPanel(ui, state.graph, id, {
    onFollow: (otherId) => select(otherId, { center: true }),
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
  if (!event.target.closest('.node') && !event.target.closest('#detail')) deselect();
});
$('detail-close').addEventListener('click', deselect);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') deselect();
});

// ---- search and filters ----------------------------------------------------

ui.search.addEventListener('input', () => {
  state.search = ui.search.value.trim().toLowerCase();
  applyVisibility();
});

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
    chip.setAttribute('aria-pressed', String(!state.hiddenTypes.has(type)));
    chip.setAttribute('aria-label', `Show ${type} nodes`);

    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('span');
    name.textContent = type;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(counts.get(type) ?? 0);

    chip.append(dot, name, count);
    chip.addEventListener('click', () => {
      if (state.hiddenTypes.has(type)) state.hiddenTypes.delete(type);
      else state.hiddenTypes.add(type);
      chip.setAttribute('aria-pressed', String(!state.hiddenTypes.has(type)));
      if (state.selected && state.hiddenTypes.has(
        state.graph.nodes.find((n) => n.id === state.selected)?.type,
      )) {
        deselect();
      }
      applyVisibility();
    });
    ui.filters.append(chip);
  }
}

// ---- view controls ---------------------------------------------------------

$('zoom-in').addEventListener('click', () => view.zoomIn());
$('zoom-out').addEventListener('click', () => view.zoomOut());
$('fit').addEventListener('click', () => view.fit(renderer.bounds(state.positions)));

// ---- layout ----------------------------------------------------------------

function startLayout() {
  if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);

  const radii = new Map();
  for (const [id, size] of renderer.sizes) {
    radii.set(id, Math.max(size.w, size.h) / 2 + 12);
  }
  const layout = createLayout(
    state.graph.nodes.map((n) => n.id),
    state.graph.edges,
    { radii },
  );

  if (reduceMotion.matches) {
    layout.settle();
    state.positions = layout.positions();
    renderer.position(state.positions);
    view.fit(renderer.bounds(state.positions));
    return;
  }

  state.positions = layout.positions();
  renderer.position(state.positions);
  view.fit(renderer.bounds(state.positions));
  const frame = () => {
    const running = layout.step(3);
    state.positions = layout.positions();
    renderer.position(state.positions);
    if (running) {
      layoutFrame = requestAnimationFrame(frame);
    } else {
      layoutFrame = null;
      view.fit(renderer.bounds(state.positions));
    }
  };
  layoutFrame = requestAnimationFrame(frame);
}

// ---- loading ---------------------------------------------------------------

function showEmpty(message) {
  ui.emptyMessage.textContent = message;
  ui.emptyState.hidden = false;
}

function setGraph(graph) {
  state.graph = graph;
  state.selected = null;
  state.neighbors = new Set();
  ui.emptyState.hidden = true;
  ui.detail.hidden = true;
  if (graph.meta?.title) {
    ui.title.textContent = graph.meta.title;
    document.title = `${graph.meta.title} — research graph`;
  }
  buildFilterChips();
  renderer.build(graph);
  applyVisibility();
  startLayout();
}

async function loadInitialGraph() {
  try {
    const response = await fetch('examples/demo.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const graph = await response.json();
    const errors = validateGraph(graph);
    if (errors.length > 0) {
      showEmpty(`The example graph is invalid: ${errors[0]}`);
      return;
    }
    setGraph(graph);
  } catch (error) {
    showEmpty(
      'Could not load the example graph. If you opened this page as a file, '
      + 'serve the folder instead (e.g. python3 -m http.server) — browsers '
      + `block module and fetch requests from file:// pages. (${error.message})`,
    );
  }
}

loadInitialGraph();
