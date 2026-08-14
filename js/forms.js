// Edit dialogs: node form, relation form, delete confirmations, raw JSON tab.
// The forms are schema-driven — they only ever offer statuses valid for the
// chosen type and relations valid between the two types being connected, so
// invalid graphs are hard to build rather than merely detectable.

import {
  NODE_TYPES, statusesFor, validRelations, validateGraph, edgeKey,
} from './schema.js';

// ---- pure helpers (unit-tested from tests.html) ----------------------------

export const ID_PREFIXES = {
  question: 'q', gap: 'gap', construct: 'con', source: 'src', study: 'st',
  method: 'm', material: 'mat', finding: 'f', claim: 'claim', note: 'note',
  task: 'task',
};

export function slugify(label) {
  const slug = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 4)
    .join('-');
  return slug || 'node';
}

export function uniqueNodeId(type, label, existingIds) {
  const base = `${ID_PREFIXES[type] ?? type}-${slugify(label)}`;
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// Every relation legal between a fixed node and another, in either direction.
export function directedRelationOptions(thisType, otherType) {
  return [
    ...validRelations(thisType, otherType).map((relation) => ({ relation, direction: 'out' })),
    ...validRelations(otherType, thisType).map((relation) => ({ relation, direction: 'in' })),
  ];
}

function truncate(text, max = 34) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---- dialog factory --------------------------------------------------------

export function createForms(callbacks) {
  const $ = (id) => document.getElementById(id);
  const els = {
    nodeDialog: $('node-dialog'),
    nodeForm: $('node-form'),
    nodeTitle: $('node-dialog-title'),
    nodeType: $('node-type'),
    nodeLabel: $('node-label'),
    nodeStatusWrap: $('node-status-wrap'),
    nodeStatus: $('node-status'),
    fieldRows: $('field-rows'),
    addFieldRow: $('add-field-row'),
    nodeIdPreview: $('node-id-preview'),
    nodeError: $('node-error'),
    edgeDialog: $('edge-dialog'),
    edgeForm: $('edge-form'),
    edgeSource: $('edge-source'),
    edgeOther: $('edge-other'),
    edgeRelation: $('edge-relation'),
    edgeError: $('edge-error'),
    confirmDialog: $('confirm-dialog'),
    confirmTitle: $('confirm-title'),
    confirmBody: $('confirm-body'),
    confirmOk: $('confirm-ok'),
    jsonDialog: $('json-dialog'),
    jsonForm: $('json-form'),
    jsonText: $('json-text'),
    jsonError: $('json-error'),
  };

  for (const button of document.querySelectorAll('dialog [data-close]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }

  function showError(el, message) {
    el.textContent = message;
    el.hidden = !message;
  }

  // ---- node form -----------------------------------------------------------

  // null while adding; holds the node being edited otherwise
  let editingNode = null;
  let knownIds = new Set();

  for (const type of NODE_TYPES) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    els.nodeType.append(option);
  }

  function fillStatusSelect(type, selected) {
    const vocab = statusesFor(type) ?? [];
    els.nodeStatusWrap.hidden = vocab.length === 0;
    els.nodeStatus.replaceChildren();
    for (const status of vocab) {
      const option = document.createElement('option');
      option.value = status;
      option.textContent = status;
      els.nodeStatus.append(option);
    }
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(no status)';
    els.nodeStatus.append(none);
    els.nodeStatus.value = selected ?? vocab[0] ?? '';
  }

  function addFieldRow(name = '', value = '') {
    const row = document.createElement('div');
    row.className = 'field-row';
    const nameInput = document.createElement('input');
    nameInput.placeholder = 'Name';
    nameInput.value = name;
    nameInput.setAttribute('aria-label', 'Field name');
    const valueInput = document.createElement('input');
    valueInput.placeholder = 'Value';
    valueInput.value = value;
    valueInput.setAttribute('aria-label', 'Field value');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'row-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove field ${name || ''}`.trim());
    remove.addEventListener('click', () => row.remove());
    row.append(nameInput, valueInput, remove);
    els.fieldRows.append(row);
  }

  function collectFields() {
    const fields = {};
    for (const row of els.fieldRows.querySelectorAll('.field-row')) {
      const [nameInput, valueInput] = row.querySelectorAll('input');
      const name = nameInput.value.trim();
      if (name) fields[name] = valueInput.value;
    }
    return Object.keys(fields).length > 0 ? fields : undefined;
  }

  function updateIdPreview() {
    if (editingNode) {
      els.nodeIdPreview.textContent = `id: ${editingNode.id}`;
      return;
    }
    const label = els.nodeLabel.value.trim();
    els.nodeIdPreview.textContent = label
      ? `id: ${uniqueNodeId(els.nodeType.value, label, knownIds)}`
      : '';
  }

  els.nodeType.addEventListener('change', () => {
    fillStatusSelect(els.nodeType.value);
    updateIdPreview();
  });
  els.nodeLabel.addEventListener('input', updateIdPreview);
  els.addFieldRow.addEventListener('click', () => addFieldRow());

  function openNodeDialog(node, existingIds) {
    editingNode = node ?? null;
    knownIds = existingIds;
    els.nodeTitle.textContent = node ? 'Edit node' : 'Add node';
    els.nodeType.value = node?.type ?? 'question';
    els.nodeType.disabled = Boolean(node);
    els.nodeType.title = node ? 'Type cannot change; delete and recreate instead' : '';
    els.nodeLabel.value = node?.label ?? '';
    fillStatusSelect(els.nodeType.value, node?.status);
    els.fieldRows.replaceChildren();
    for (const [name, value] of Object.entries(node?.fields ?? {})) {
      addFieldRow(name, value);
    }
    showError(els.nodeError, '');
    updateIdPreview();
    els.nodeDialog.showModal();
  }

  els.nodeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const label = els.nodeLabel.value.trim();
    if (!label) {
      showError(els.nodeError, 'A label is required.');
      return;
    }
    const status = els.nodeStatusWrap.hidden ? '' : els.nodeStatus.value;
    const fields = collectFields();
    if (editingNode) {
      callbacks.onUpdateNode(editingNode.id, { label, status, fields });
    } else {
      const type = els.nodeType.value;
      const node = { id: uniqueNodeId(type, label, knownIds), type, label };
      if (status) node.status = status;
      if (fields) node.fields = fields;
      callbacks.onCreateNode(node);
    }
    els.nodeDialog.close();
  });

  // ---- relation form -------------------------------------------------------

  let edgeAnchor = null;
  let edgeGraph = null;

  function fillRelationSelect() {
    const other = edgeGraph.nodes.find((n) => n.id === els.edgeOther.value);
    els.edgeRelation.replaceChildren();
    showError(els.edgeError, '');
    if (!other) return;
    const options = directedRelationOptions(edgeAnchor.type, other.type);
    for (const { relation, direction } of options) {
      const option = document.createElement('option');
      option.value = `${direction}:${relation}`;
      option.textContent = direction === 'out'
        ? `${truncate(edgeAnchor.label, 22)} —${relation}→ ${truncate(other.label, 22)}`
        : `${truncate(other.label, 22)} —${relation}→ ${truncate(edgeAnchor.label, 22)}`;
      els.edgeRelation.append(option);
    }
    els.edgeRelation.disabled = options.length === 0;
    if (options.length === 0) {
      showError(
        els.edgeError,
        `The schema allows no relation between ${edgeAnchor.type} and ${other.type}.`,
      );
    }
  }

  function openEdgeDialog(anchor, graph) {
    edgeAnchor = anchor;
    edgeGraph = graph;
    els.edgeSource.textContent = `${anchor.type}: ${truncate(anchor.label, 60)}`;
    els.edgeOther.replaceChildren();
    const byType = new Map();
    for (const node of graph.nodes) {
      if (node.id === anchor.id) continue;
      if (!byType.has(node.type)) byType.set(node.type, []);
      byType.get(node.type).push(node);
    }
    for (const type of NODE_TYPES) {
      const nodes = byType.get(type);
      if (!nodes) continue;
      const group = document.createElement('optgroup');
      group.label = type;
      for (const node of nodes) {
        const option = document.createElement('option');
        option.value = node.id;
        option.textContent = truncate(node.label, 48);
        group.append(option);
      }
      els.edgeOther.append(group);
    }
    fillRelationSelect();
    els.edgeDialog.showModal();
  }

  els.edgeOther.addEventListener('change', fillRelationSelect);

  els.edgeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = els.edgeRelation.value;
    const otherId = els.edgeOther.value;
    if (!value || !otherId) return;
    const [direction, relation] = value.split(':');
    const edge = direction === 'out'
      ? { from: edgeAnchor.id, relation, to: otherId }
      : { from: otherId, relation, to: edgeAnchor.id };
    if (edgeGraph.edges.some((e) => edgeKey(e) === edgeKey(edge))) {
      showError(els.edgeError, 'That edge already exists.');
      return;
    }
    callbacks.onCreateEdge(edge);
    els.edgeDialog.close();
  });

  // ---- confirmations -------------------------------------------------------

  function openConfirm(title, bodyNodes, onConfirm) {
    els.confirmTitle.textContent = title;
    els.confirmBody.replaceChildren(...bodyNodes);
    els.confirmOk.onclick = () => {
      els.confirmDialog.close();
      onConfirm();
    };
    els.confirmDialog.showModal();
  }

  function describeEdge(edge, labelOf) {
    return `${truncate(labelOf(edge.from), 26)} —${edge.relation}→ ${truncate(labelOf(edge.to), 26)}`;
  }

  function confirmDeleteNode(node, incidentEdges, labelOf) {
    const body = [];
    const p = document.createElement('p');
    p.textContent = incidentEdges.length === 0
      ? `Delete "${truncate(node.label, 60)}"? It has no edges.`
      : `Delete "${truncate(node.label, 60)}"? This also removes ${incidentEdges.length} edge${incidentEdges.length === 1 ? '' : 's'}:`;
    body.push(p);
    if (incidentEdges.length > 0) {
      const list = document.createElement('ul');
      for (const edge of incidentEdges.slice(0, 8)) {
        const item = document.createElement('li');
        item.textContent = describeEdge(edge, labelOf);
        list.append(item);
      }
      if (incidentEdges.length > 8) {
        const item = document.createElement('li');
        item.textContent = `…and ${incidentEdges.length - 8} more`;
        list.append(item);
      }
      body.push(list);
    }
    openConfirm('Delete node', body, () => callbacks.onDeleteNode(node.id));
  }

  function confirmDeleteEdge(edge, labelOf) {
    const p = document.createElement('p');
    p.textContent = `Delete the edge ${describeEdge(edge, labelOf)}?`;
    openConfirm('Delete edge', [p], () => callbacks.onDeleteEdge(edge));
  }

  // ---- raw JSON tab --------------------------------------------------------

  function openJson(graphText) {
    els.jsonText.value = graphText;
    showError(els.jsonError, '');
    els.jsonDialog.showModal();
  }

  els.jsonForm.addEventListener('submit', (event) => {
    event.preventDefault();
    let graph;
    try {
      graph = JSON.parse(els.jsonText.value);
    } catch (error) {
      showError(els.jsonError, `Not valid JSON: ${error.message}`);
      return;
    }
    const errors = validateGraph(graph);
    if (errors.length > 0) {
      const shown = errors.slice(0, 5).join('\n');
      const more = errors.length > 5 ? `\n…and ${errors.length - 5} more` : '';
      showError(els.jsonError, `Not applied — ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n${shown}${more}`);
      return;
    }
    callbacks.onApplyJson(graph);
    els.jsonDialog.close();
  });

  return {
    openAddNode: (existingIds) => openNodeDialog(null, existingIds),
    openEditNode: (node) => openNodeDialog(node, new Set()),
    openAddEdge: openEdgeDialog,
    confirmDeleteNode,
    confirmDeleteEdge,
    openJson,
  };
}
