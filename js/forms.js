// Edit dialogs: node form, link form, delete confirmations, raw JSON tab.
// The forms suggest rather than constrain — statuses, natures and relations
// are all free text with a datalist behind them.

import { NODE_TYPES, TYPE_HINTS, statusesFor, validateGraph, edgeKey } from './schema.js';

// ---- pure helpers (unit-tested from tests.html) ----------------------------

export const ID_PREFIXES = {
  question: 'q', experiment: 'ex', source: 'src', note: 'note',
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

function truncate(text, max = 34) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// A question cannot be its own ancestor; offer only nodes that keep the tree
// acyclic.
export function eligibleParents(graph, nodeId) {
  const questions = graph.nodes.filter((n) => n.type === 'question' && n.id !== nodeId);
  if (!nodeId) return questions;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const isDescendant = (candidate) => {
    let cursor = byId.get(candidate);
    const seen = new Set();
    while (cursor?.parent && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      if (cursor.parent === nodeId) return true;
      cursor = byId.get(cursor.parent);
    }
    return false;
  };
  return questions.filter((q) => !isDescendant(q.id));
}

// ---- dialog factory --------------------------------------------------------

export function createForms(callbacks) {
  const $ = (id) => document.getElementById(id);
  const els = {
    nodeDialog: $('node-dialog'),
    nodeForm: $('node-form'),
    nodeTitle: $('node-dialog-title'),
    nodeType: $('node-type'),
    nodeHint: $('node-type-hint'),
    nodeLabel: $('node-label'),
    nodeStatus: $('node-status'),
    statusOptions: $('status-options'),
    expFields: $('experiment-fields'),
    nodeNature: $('node-nature'),
    nodeDescription: $('node-description'),
    nodeResult: $('node-result'),
    parentWrap: $('node-parent-wrap'),
    nodeParent: $('node-parent'),
    fieldRows: $('field-rows'),
    addFieldRow: $('add-field-row'),
    nodeIdPreview: $('node-id-preview'),
    nodeError: $('node-error'),
    edgeDialog: $('edge-dialog'),
    edgeForm: $('edge-form'),
    edgeSource: $('edge-source'),
    edgeOther: $('edge-other'),
    edgeDirection: $('edge-direction'),
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

  let editingNode = null; // null while adding
  let knownIds = new Set();
  let graphRef = { nodes: [], edges: [] };

  for (const type of NODE_TYPES) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    els.nodeType.append(option);
  }

  function fillStatusOptions(type) {
    els.statusOptions.replaceChildren();
    for (const status of statusesFor(type)) {
      const option = document.createElement('option');
      option.value = status;
      els.statusOptions.append(option);
    }
  }

  function fillParentOptions(selected) {
    els.nodeParent.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(none — this is a root question)';
    els.nodeParent.append(none);
    for (const q of eligibleParents(graphRef, editingNode?.id)) {
      const option = document.createElement('option');
      option.value = q.id;
      option.textContent = truncate(q.label, 56);
      els.nodeParent.append(option);
    }
    els.nodeParent.value = selected ?? '';
  }

  function applyType(type, node) {
    els.nodeHint.textContent = TYPE_HINTS[type] ?? '';
    fillStatusOptions(type);
    els.expFields.hidden = type !== 'experiment';
    els.parentWrap.hidden = type !== 'question';
    if (type === 'question') fillParentOptions(node?.parent);
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
    applyType(els.nodeType.value);
    updateIdPreview();
  });
  els.nodeLabel.addEventListener('input', updateIdPreview);
  els.addFieldRow.addEventListener('click', () => addFieldRow());

  function openNodeDialog(node, graph, existingIds) {
    editingNode = node ?? null;
    graphRef = graph;
    knownIds = existingIds ?? new Set(graph.nodes.map((n) => n.id));
    els.nodeTitle.textContent = node ? 'Edit node' : 'Add node';
    els.nodeType.value = node?.type && NODE_TYPES.includes(node.type) ? node.type : 'question';
    els.nodeType.disabled = Boolean(node) && !NODE_TYPES.includes(node?.type);
    els.nodeLabel.value = node?.label ?? '';
    els.nodeStatus.value = node?.status ?? '';
    els.nodeNature.value = node?.nature ?? '';
    els.nodeDescription.value = node?.description ?? '';
    els.nodeResult.value = node?.result ?? '';
    applyType(els.nodeType.value, node);
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
    const type = els.nodeType.disabled ? editingNode.type : els.nodeType.value;
    const patch = {
      label,
      status: els.nodeStatus.value.trim(),
      nature: type === 'experiment' ? els.nodeNature.value.trim() : '',
      description: type === 'experiment' ? els.nodeDescription.value.trim() : '',
      result: type === 'experiment' ? els.nodeResult.value.trim() : '',
      parent: type === 'question' ? els.nodeParent.value : '',
      fields: collectFields(),
    };
    if (editingNode) {
      callbacks.onUpdateNode(editingNode.id, patch);
    } else {
      const node = { id: uniqueNodeId(type, label, knownIds), type, label };
      if (patch.status) node.status = patch.status;
      if (patch.nature) node.nature = patch.nature;
      if (patch.description) node.description = patch.description;
      if (patch.result) node.result = patch.result;
      if (patch.parent) node.parent = patch.parent;
      if (patch.fields) node.fields = patch.fields;
      callbacks.onCreateNode(node);
    }
    els.nodeDialog.close();
  });

  // ---- link form -----------------------------------------------------------

  let edgeAnchor = null;
  let edgeGraph = null;

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
    for (const [type, nodes] of byType) {
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
    els.edgeRelation.value = '';
    els.edgeDirection.value = 'out';
    showError(els.edgeError, '');
    els.edgeDialog.showModal();
  }

  els.edgeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const otherId = els.edgeOther.value;
    if (!otherId) return;
    const relation = els.edgeRelation.value.trim();
    const edge = els.edgeDirection.value === 'out'
      ? { from: edgeAnchor.id, relation, to: otherId }
      : { from: otherId, relation, to: edgeAnchor.id };
    if (edgeGraph.edges.some((e) => edgeKey(e) === edgeKey(edge))) {
      showError(els.edgeError, 'That link already exists.');
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
    const rel = edge.relation ? ` —${edge.relation}→ ` : ' → ';
    return `${truncate(labelOf(edge.from), 26)}${rel}${truncate(labelOf(edge.to), 26)}`;
  }

  function confirmDeleteNode(node, incidentEdges, children, labelOf) {
    const body = [];
    const p = document.createElement('p');
    const bits = [];
    if (incidentEdges.length > 0) {
      bits.push(`${incidentEdges.length} link${incidentEdges.length === 1 ? '' : 's'}`);
    }
    if (children.length > 0) {
      bits.push(`${children.length} sub-question${children.length === 1 ? '' : 's'} will lose their parent`);
    }
    p.textContent = bits.length === 0
      ? `Delete "${truncate(node.label, 60)}"? Nothing else is attached.`
      : `Delete "${truncate(node.label, 60)}"? This also removes ${bits.join(', and ')}.`;
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
    p.textContent = `Delete the link ${describeEdge(edge, labelOf)}?`;
    openConfirm('Delete link', [p], () => callbacks.onDeleteEdge(edge));
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
    openAddNode: (graph, existingIds) => openNodeDialog(null, graph, existingIds),
    openEditNode: (node, graph) => openNodeDialog(node, graph),
    openAddEdge: openEdgeDialog,
    confirmDeleteNode,
    confirmDeleteEdge,
    openJson,
  };
}
