// DOM rendering: node cards in an HTML layer, edges in an SVG layer beneath
// them, and the detail panel. Pure rendering — state lives in app.js.
//
// An experiment card carries its own result, so it renders in three parts:
// its nature, what was done, and what came out.

import { edgeKey, allEdges } from './schema.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function makeStatusPill(status) {
  const pill = document.createElement('span');
  pill.className = 'status';
  pill.textContent = status;
  return pill;
}

function truncate(text, max) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function createRenderer(ui, callbacks) {
  const cards = new Map(); // node id → button element
  const lines = new Map(); // edge key → { line, label, edge }
  const sizes = new Map(); // node id → { w, h }

  function fillCard(card, node) {
    card.className = `node type-${node.type}`;
    card.dataset.id = node.id;
    card.replaceChildren();

    const head = document.createElement('span');
    head.className = 'node-type';
    head.textContent = node.type === 'experiment' && node.nature
      ? `${node.type} · ${node.nature}`
      : node.type;
    card.append(head);

    const label = document.createElement('span');
    label.className = 'node-label';
    label.textContent = node.label;
    card.append(label);

    if (node.type === 'experiment') {
      if (node.description) {
        const desc = document.createElement('span');
        desc.className = 'node-desc';
        desc.textContent = truncate(node.description, 110);
        card.append(desc);
      }
      if (node.result) {
        const result = document.createElement('span');
        result.className = 'node-result';
        result.textContent = truncate(node.result, 130);
        card.append(result);
      }
    }

    if (node.status) card.append(makeStatusPill(node.status));

    card.setAttribute('aria-label',
      `${node.type}: ${node.label}${node.status ? `, ${node.status}` : ''}`);
  }

  function measure(id) {
    const card = cards.get(id);
    sizes.set(id, { w: card.offsetWidth, h: card.offsetHeight });
  }

  function addNode(node) {
    const card = document.createElement('button');
    card.type = 'button';
    fillCard(card, node);
    card.addEventListener('click', () => callbacks.onSelect(node.id));
    ui.nodeLayer.append(card);
    cards.set(node.id, card);
    measure(node.id);
  }

  function updateNode(node) {
    const card = cards.get(node.id);
    if (!card) return;
    fillCard(card, node);
    measure(node.id);
  }

  function removeNode(id) {
    cards.get(id)?.remove();
    cards.delete(id);
    sizes.delete(id);
  }

  function addEdge(edge) {
    if (!cards.has(edge.from) || !cards.has(edge.to)) return;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', edge.derived ? 'edge is-derived' : 'edge');
    line.setAttribute('marker-end', 'url(#arrow)');
    ui.edgeLines.append(line);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'edge-label');
    label.textContent = edge.relation ?? '';
    ui.edgeLabels.append(label);

    lines.set(edgeKey(edge), { line, label, edge });
  }

  function removeEdge(key) {
    const entry = lines.get(key);
    if (!entry) return;
    entry.line.remove();
    entry.label.remove();
    lines.delete(key);
  }

  // Parent links are a field, so any edit that could change one has to
  // rebuild the derived edges rather than patch a single object.
  function rebuildEdges(graph) {
    lines.clear();
    ui.edgeLines.replaceChildren();
    ui.edgeLabels.replaceChildren();
    for (const edge of allEdges(graph)) addEdge(edge);
  }

  function build(graph) {
    cards.clear();
    sizes.clear();
    ui.nodeLayer.replaceChildren();
    for (const node of graph.nodes) addNode(node);
    rebuildEdges(graph);
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
      if (!node) continue;
      card.classList.toggle('is-hidden', visibility.isHidden(node));
      card.classList.toggle('is-dim', !visibility.isHidden(node) && visibility.isDim(node));
      card.classList.toggle('is-selected', id === visibility.selectedId);
      if (id === visibility.selectedId) card.setAttribute('aria-pressed', 'true');
      else card.removeAttribute('aria-pressed');
    }
    for (const { line, label, edge } of lines.values()) {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) continue;
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

  return {
    build, position, bounds, setState, sizes,
    addNode, updateNode, removeNode, addEdge, removeEdge, rebuildEdges,
  };
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

  ui.detailType.textContent = node.type === 'experiment' && node.nature
    ? `${node.type} · ${node.nature}`
    : node.type;
  ui.detailType.className = `type-tag type-${node.type}`;
  ui.detailLabel.textContent = node.label;
  ui.detailStatus.hidden = !node.status;
  if (node.status) {
    ui.detailStatus.textContent = node.status;
    ui.detailStatus.className = 'status';
  }
  ui.detailId.textContent = node.id;

  // An experiment reads top to bottom: what was done, then what came out.
  ui.detailBody.replaceChildren();
  const addBlock = (title, text, className) => {
    if (!text) return;
    const h = document.createElement('h3');
    h.textContent = title;
    const p = document.createElement('p');
    p.className = className;
    p.textContent = text;
    ui.detailBody.append(h, p);
  };
  addBlock('What was done', node.description, 'detail-prose');
  addBlock('Result', node.result, 'detail-prose detail-result');

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
  const edges = allEdges(graph);
  const fillRelations = (section, list, otherEnd) => {
    const target = section.querySelector('.rel-list');
    target.replaceChildren();
    section.hidden = list.length === 0;
    for (const edge of list) {
      const other = nodeById.get(otherEnd(edge));
      if (!other) continue;
      const row = document.createElement('div');
      row.className = `rel-row type-${other.type}`;

      const follow = document.createElement('button');
      follow.type = 'button';
      follow.className = 'rel-follow';

      const name = document.createElement('span');
      name.className = 'rel-name';
      name.textContent = edge.relation ?? '—';

      const dot = document.createElement('span');
      dot.className = 'dot';

      const label = document.createElement('span');
      label.className = 'rel-target';
      label.textContent = other.label;

      follow.append(name, dot, label);
      follow.addEventListener('click', () => callbacks.onFollow(other.id));
      row.append(follow);

      // derived parent links are edited on the node, not deleted here
      if (callbacks.onDeleteEdge && !edge.derived) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'rel-del';
        del.textContent = '×';
        del.setAttribute('aria-label', `Delete edge: ${edge.relation ?? 'link'} ${other.label}`);
        del.addEventListener('click', () => callbacks.onDeleteEdge(edge));
        row.append(del);
      }
      target.append(row);
    }
  };

  fillRelations(ui.detailOutgoing, edges.filter((e) => e.from === nodeId), (e) => e.to);
  fillRelations(ui.detailIncoming, edges.filter((e) => e.to === nodeId), (e) => e.from);
}
