// DOM rendering: node cards in an HTML layer, edges in an SVG layer beneath
// them, and the detail panel. Pure rendering — state lives in app.js.

import { edgeKey } from './schema.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Visual grouping of statuses only — the vocabulary itself comes from the
// schema and is not interpreted here beyond a tint.
const STATUS_TONES = {
  good: ['answered', 'verified', 'complete', 'supported', 'established', 'read',
    'run', 'collected', 'frozen', 'done', 'preregistered', 'closed-by-others'],
  bad: ['abandoned', 'withdrawn', 'invalid', 'contested', 'superseded'],
  warn: ['unverified', 'to-read', 'todo', 'asserted', 'draft'],
  info: ['sealed', 'bounded', 'null-with-bound', 'untestable', 'partly-answered',
    'running', 'doing'],
};

export function statusTone(status) {
  for (const [tone, list] of Object.entries(STATUS_TONES)) {
    if (list.includes(status)) return tone;
  }
  return 'neutral';
}

export function makeStatusPill(status) {
  const pill = document.createElement('span');
  pill.className = `status tone-${statusTone(status)}`;
  pill.textContent = status;
  return pill;
}

export function createRenderer(ui, callbacks) {
  const cards = new Map(); // node id → button element
  const lines = new Map(); // edge key → { line, label, edge }
  const sizes = new Map(); // node id → { w, h }

  function build(graph) {
    cards.clear();
    lines.clear();
    sizes.clear();
    ui.nodeLayer.replaceChildren();
    ui.edgeLines.replaceChildren();
    ui.edgeLabels.replaceChildren();

    for (const node of graph.nodes) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `node type-${node.type}`;
      card.dataset.id = node.id;

      const type = document.createElement('span');
      type.className = 'node-type';
      type.textContent = node.type;
      card.append(type);

      const label = document.createElement('span');
      label.className = 'node-label';
      label.textContent = node.label;
      card.append(label);

      if (node.status) card.append(makeStatusPill(node.status));

      card.setAttribute('aria-label',
        `${node.type}: ${node.label}${node.status ? `, ${node.status}` : ''}`);
      card.addEventListener('click', () => callbacks.onSelect(node.id));
      ui.nodeLayer.append(card);
      cards.set(node.id, card);
    }

    for (const edge of graph.edges) {
      if (!cards.has(edge.from) || !cards.has(edge.to)) continue;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'edge');
      line.setAttribute('marker-end', 'url(#arrow)');
      ui.edgeLines.append(line);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('class', 'edge-label');
      label.textContent = edge.relation;
      ui.edgeLabels.append(label);

      lines.set(edgeKey(edge), { line, label, edge });
    }

    // one reflow, then cached; card size doesn't depend on position
    for (const [id, card] of cards) {
      sizes.set(id, { w: card.offsetWidth, h: card.offsetHeight });
    }
  }

  // Point on the segment from → to where it crosses the padded card
  // rectangle around `to`, so arrowheads sit at the card edge.
  function trim(from, to, size, gap) {
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const hw = size.w / 2 + gap;
    const hh = size.h / 2 + gap;
    const s = Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
    if (s <= 1) return { x: from.x, y: from.y }; // overlapping cards: degenerate
    return { x: to.x + dx / s, y: to.y + dy / s };
  }

  function position(positions) {
    for (const [id, card] of cards) {
      const p = positions.get(id);
      if (p) card.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    }
    for (const { line, label, edge } of lines.values()) {
      const a = positions.get(edge.from);
      const b = positions.get(edge.to);
      if (!a || !b) continue;
      const start = trim(b, a, sizes.get(edge.from), 3);
      const end = trim(a, b, sizes.get(edge.to), 6);
      line.setAttribute('x1', start.x);
      line.setAttribute('y1', start.y);
      line.setAttribute('x2', end.x);
      line.setAttribute('y2', end.y);
      label.setAttribute('x', (start.x + end.x) / 2);
      label.setAttribute('y', (start.y + end.y) / 2);
    }
  }

  function bounds(positions) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [id, card] of cards) {
      if (card.classList.contains('is-hidden')) continue;
      const p = positions.get(id);
      const s = sizes.get(id);
      if (!p || !s) continue;
      minX = Math.min(minX, p.x - s.w / 2);
      minY = Math.min(minY, p.y - s.h / 2);
      maxX = Math.max(maxX, p.x + s.w / 2);
      maxY = Math.max(maxY, p.y + s.h / 2);
    }
    return { minX, minY, maxX, maxY };
  }

  // visibility: { isHidden(node), isDim(node), selectedId, isEdgeActive(edge) }
  function setState(graph, visibility) {
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const [id, card] of cards) {
      const node = nodeById.get(id);
      card.classList.toggle('is-hidden', visibility.isHidden(node));
      card.classList.toggle('is-dim', !visibility.isHidden(node) && visibility.isDim(node));
      card.classList.toggle('is-selected', id === visibility.selectedId);
      if (id === visibility.selectedId) card.setAttribute('aria-pressed', 'true');
      else card.removeAttribute('aria-pressed');
    }
    for (const { line, label, edge } of lines.values()) {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      const hidden = visibility.isHidden(from) || visibility.isHidden(to);
      const dim = !hidden && (visibility.isDim(from) || visibility.isDim(to));
      const active = !hidden && !dim && visibility.isEdgeActive(edge);
      line.classList.toggle('is-hidden', hidden);
      label.classList.toggle('is-hidden', hidden);
      line.classList.toggle('is-dim', dim);
      label.classList.toggle('is-dim', dim);
      line.classList.toggle('is-active', active);
    }
  }

  return { build, position, bounds, setState, sizes };
}

// ---- detail panel ----------------------------------------------------------

export function renderPanel(ui, graph, nodeId, callbacks) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) {
    ui.detail.hidden = true;
    return;
  }
  ui.detail.hidden = false;
  ui.detail.scrollTop = 0;

  ui.detailType.textContent = node.type;
  ui.detailType.className = `type-tag type-${node.type}`;
  ui.detailLabel.textContent = node.label;
  ui.detailStatus.hidden = !node.status;
  if (node.status) {
    ui.detailStatus.textContent = node.status;
    ui.detailStatus.className = `status tone-${statusTone(node.status)}`;
  }
  ui.detailId.textContent = node.id;

  ui.detailFields.replaceChildren();
  const addField = (name, value, href) => {
    const dt = document.createElement('dt');
    dt.textContent = name;
    const dd = document.createElement('dd');
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = value;
      dd.append(a);
    } else {
      dd.textContent = value;
    }
    ui.detailFields.append(dt, dd);
  };
  for (const [name, value] of Object.entries(node.fields ?? {})) {
    addField(name, value);
  }
  if (node.meta?.doi) {
    addField('DOI', node.meta.doi, `https://doi.org/${encodeURIComponent(node.meta.doi)}`);
  }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const fillRelations = (section, edges, otherEnd) => {
    const list = section.querySelector('.rel-list');
    list.replaceChildren();
    section.hidden = edges.length === 0;
    for (const edge of edges) {
      const other = nodeById.get(otherEnd(edge));
      if (!other) continue;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `rel-row type-${other.type}`;

      const name = document.createElement('span');
      name.className = 'rel-name';
      name.textContent = edge.relation;

      const dot = document.createElement('span');
      dot.className = 'dot';

      const target = document.createElement('span');
      target.className = 'rel-target';
      target.textContent = other.label;

      row.append(name, dot, target);
      row.addEventListener('click', () => callbacks.onFollow(other.id));
      list.append(row);
    }
  };

  fillRelations(ui.detailOutgoing, graph.edges.filter((e) => e.from === nodeId), (e) => e.to);
  fillRelations(ui.detailIncoming, graph.edges.filter((e) => e.to === nodeId), (e) => e.from);
}
