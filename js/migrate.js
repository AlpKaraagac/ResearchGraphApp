// Bring a graph written under any earlier schema into the simplified one:
// four types, free-text links, sub-questions as a `parent` field, and — the
// point of the exercise — results folded into the experiment that produced
// them, so one node carries its nature, what was done, and what came out.

import { slugify } from './forms.js';

// Old type name → new type. Everything not named here becomes a note, with
// its original type preserved in a field so nothing is silently lost.
const TYPE_MAP = {
  rq: 'question',
  question: 'question',
  experiment: 'experiment',
  study: 'experiment',
  paper: 'source',
  source: 'source',
  note: 'note',
};

const RESULT_TYPES = ['result', 'finding'];
const EXPERIMENT_TYPES = ['experiment', 'study'];

// The relation names, across schema versions, that tie a result to the study
// that produced it. Edges may carry `relation` (v1.x) or `rel` (the original).
const YIELD_RELS = ['yields', 'headline finding', 'validation', 'audit'];

const relOf = (edge) => String(edge?.relation ?? edge?.rel ?? '').toLowerCase();

export function looksLikeOldMap(json) {
  if (!json || !Array.isArray(json.nodes)) return false;
  const legacyTypes = ['rq', 'experiment', 'result', 'paper', 'corpus', 'venue',
    'study', 'finding', 'claim', 'gap', 'construct', 'method', 'material', 'task'];
  if (json.nodes.some((n) => n && legacyTypes.includes(n.type))) return true;
  return Array.isArray(json.edges) && json.edges.some((e) => e && e.rel !== undefined);
}

function textOf(node) {
  const bits = [];
  if (node.detail) bits.push(String(node.detail));
  for (const [key, value] of Object.entries(node.fields ?? {})) {
    if (key === 'Detail') bits.push(String(value));
    else bits.push(`${key}: ${value}`);
  }
  return bits.join('\n');
}

export function migrateOldMap(old) {
  const report = { merged: 0, becameNotes: 0, notes: [] };
  const oldNodes = (old.nodes ?? []).filter((n) => n && typeof n.id === 'string');
  const oldById = new Map(oldNodes.map((n) => [n.id, n]));
  const edges = (old.edges ?? []).filter((e) => e && oldById.has(e.from) && oldById.has(e.to));

  // Which study each result belongs to.
  const resultHome = new Map();
  for (const edge of edges) {
    const from = oldById.get(edge.from);
    const to = oldById.get(edge.to);
    if (!RESULT_TYPES.includes(from.type)) continue;
    if (EXPERIMENT_TYPES.includes(to.type) && YIELD_RELS.includes(relOf(edge))) {
      if (!resultHome.has(from.id)) resultHome.set(from.id, to.id);
    }
  }
  const resultsFor = new Map();
  for (const [resultId, studyId] of resultHome) {
    if (!resultsFor.has(studyId)) resultsFor.set(studyId, []);
    resultsFor.get(studyId).push(resultId);
  }

  const nodes = [];
  const idMap = new Map(); // old id → new id (a merged result points at its study)

  for (const n of oldNodes) {
    if (RESULT_TYPES.includes(n.type) && resultHome.has(n.id)) {
      idMap.set(n.id, resultHome.get(n.id)); // folded into its experiment below
      report.merged += 1;
      continue;
    }
    const mapped = TYPE_MAP[n.type]
      ?? (RESULT_TYPES.includes(n.type) ? 'experiment' : 'note');
    const node = { id: n.id, type: mapped, label: String(n.label ?? n.id) };
    if (n.status) node.status = String(n.status);
    if (Number.isFinite(n.x) && Number.isFinite(n.y)) { node.x = n.x; node.y = n.y; }

    const body = textOf(n);
    if (mapped === 'experiment') {
      if (RESULT_TYPES.includes(n.type)) {
        // an unattached result becomes an experiment that is all result
        node.result = [n.label, body].filter(Boolean).join('\n');
        node.label = String(n.label ?? n.id);
      } else if (body) {
        node.description = body;
      }
      const own = resultsFor.get(n.id) ?? [];
      if (own.length > 0) {
        node.result = own.map((rid) => {
          const r = oldById.get(rid);
          const rBody = textOf(r);
          const head = own.length > 1 ? `• ${r.label}` : r.label;
          return [head, rBody].filter(Boolean).join('\n');
        }).join('\n\n');
      }
    } else if (body) {
      node.fields = { Detail: body };
    }

    if (!TYPE_MAP[n.type] && !RESULT_TYPES.includes(n.type)) {
      node.fields = { ...(node.fields ?? {}), Kind: String(n.type) };
      report.becameNotes += 1;
    }
    if (n.meta && typeof n.meta === 'object') node.meta = n.meta;
    nodes.push(node);
    idMap.set(n.id, n.id);
  }

  const newById = new Map(nodes.map((n) => [n.id, n]));

  // Sub-question links become a parent field: `child asks parent`.
  for (const edge of edges) {
    if (relOf(edge) !== 'asks' && relOf(edge) !== 'sub-question') continue;
    const child = newById.get(idMap.get(edge.from));
    const parent = newById.get(idMap.get(edge.to));
    if (child?.type === 'question' && parent?.type === 'question' && child.id !== parent.id) {
      child.parent ??= parent.id;
    }
  }

  const outEdges = [];
  const seen = new Set();
  for (const edge of edges) {
    const rel = relOf(edge);
    if (rel === 'asks' || rel === 'sub-question') continue;
    const from = idMap.get(edge.from);
    const to = idMap.get(edge.to);
    if (!from || !to || from === to) continue; // dropped: internal to a merge
    if (!newById.has(from) || !newById.has(to)) continue;
    const key = `${from}|${rel}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outEdges.push({ from, relation: edge.relation ?? edge.rel ?? '', to });
  }

  const meta = { ...(old.meta ?? {}) };
  meta.id ??= slugify(meta.title ?? 'migrated-map');
  return { graph: { version: 2, meta, nodes, edges: outEdges }, report };
}
