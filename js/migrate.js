// SCHEMA.md §7: migration from the old map format — rq / experiment / result /
// paper / corpus / venue node types, per-node `detail` prose, and free-text
// `rel` edges — into schema v1. The mapping is pure and *reported*: everything
// the closed schema cannot express is dropped loudly, never silently.

import { relationAllows, edgeKey } from './schema.js';
import { slugify } from './forms.js';

const TYPE_MAP = {
  rq: 'question',
  experiment: 'study',
  result: 'finding',
  paper: 'source',
  corpus: 'material',
  venue: 'task', // §7: drop venue — make it a task
  gap: 'gap',
  construct: 'construct',
  method: 'method',
  claim: 'claim',
  note: 'note',
  task: 'task',
};

// Old statuses were global; new ones are per type (§2). §7 pins three of
// these: not-estimable → untestable, established on a finding → supported,
// established on a claim stays. The rest are the nearest honest word; a
// status with no honest mapping is dropped and reported.
const STATUS_MAP = {
  question: {
    open: 'open',
    answered: 'answered',
    'partly-answered': 'partly-answered',
    split: 'partly-answered',
    partial: 'partly-answered',
    bounded: 'bounded',
    sealed: 'open', // a question whose evidence is sealed is still open
    abandoned: 'abandoned',
  },
  study: {
    planned: 'planned',
    running: 'running',
    complete: 'complete',
    established: 'complete',
    inconclusive: 'complete', // the study ran; its findings carry the verdict
    untestable: 'complete',
    sealed: 'running', // computed but gated: not finished yet
    abandoned: 'abandoned',
  },
  finding: {
    supported: 'supported',
    established: 'supported',
    'null-with-bound': 'null-with-bound',
    'not-estimable': 'untestable',
    untestable: 'untestable',
    inconclusive: 'untestable',
    sealed: 'sealed',
    withdrawn: 'withdrawn',
    invalid: 'invalid',
  },
  claim: {
    established: 'established',
    provisional: 'provisional',
    contested: 'contested',
    abandoned: 'abandoned',
  },
  source: {
    'to-read': 'to-read',
    todo: 'to-read',
    read: 'read',
    verified: 'verified',
    established: 'verified',
    unverified: 'unverified',
  },
  material: {
    planned: 'planned',
    collected: 'collected',
    frozen: 'frozen',
    established: 'frozen',
  },
  task: { todo: 'todo', doing: 'doing', done: 'done' },
  gap: {
    asserted: 'asserted',
    verified: 'verified',
    contested: 'contested',
    'closed-by-others': 'closed-by-others',
  },
  construct: {},
  note: {},
};

export function looksLikeOldMap(json) {
  if (!json || !Array.isArray(json.nodes)) return false;
  const oldTypes = ['rq', 'experiment', 'result', 'paper', 'corpus', 'venue'];
  if (json.nodes.some((n) => n && oldTypes.includes(n.type))) return true;
  return Array.isArray(json.edges)
    && json.edges.some((e) => e && typeof e.rel === 'string' && e.from !== undefined);
}

// Free-text rels are mapped by endpoint types, with the rel text breaking
// ties (threatens vs grounds, bounds vs supports). Returns null when the
// closed set has nothing honest to offer.
function mapEdge(relRaw, fromType, toType) {
  const rel = String(relRaw ?? '').toLowerCase();
  if (fromType === 'note') return { relation: 'qualifies' };
  if (fromType === 'task') return { relation: 'blocks' };
  if (fromType === 'question' && toType === 'question') return { relation: 'asks' };
  if (fromType === 'gap' && toType === 'question') return { relation: 'motivates' };
  if (fromType === 'study' && toType === 'question') return { relation: 'addresses' };
  if ((fromType === 'method' || fromType === 'material') && toType === 'study') {
    return { relation: 'uses' };
  }
  if (fromType === 'claim' && toType === 'question') return { relation: 'answers' };
  if (fromType === 'finding' && toType === 'claim') return { relation: 'supports' };
  if (fromType === 'claim' && toType === 'finding') {
    // "cl generalises r" means the finding is the evidence — flip it
    return { relation: 'supports', flip: true };
  }
  if (fromType === 'finding' && toType === 'finding') {
    return { relation: /bound/.test(rel) ? 'bounds' : 'supports' };
  }
  if (fromType === 'finding' && toType === 'question') {
    return { relation: 'bounds', approx: true };
  }
  if (fromType === 'finding' && toType === 'study') {
    // only production-flavoured rels become yields; a finding that merely
    // *motivated* a study did not come out of it
    return /yield|headline|finding|audit|validat/.test(rel) ? { relation: 'yields' } : null;
  }
  if (fromType === 'source') {
    if (toType === 'construct') return { relation: 'grounds' };
    if (toType === 'gap') return { relation: /threat/.test(rel) ? 'threatens' : 'grounds' };
    if (toType === 'claim') {
      if (/contradict/.test(rel)) return { relation: 'contradicts' };
      if (/threat|objection/.test(rel)) return { relation: 'threatens' };
      return { relation: 'grounds' };
    }
    if (toType === 'method' || toType === 'study') return { relation: 'inspires' };
  }
  return null;
}

const KNOWN_KEYS = ['id', 'type', 'label', 'detail', 'fields', 'status', 'meta'];

export function migrateOldMap(old) {
  const report = {
    droppedEdges: [],
    approximated: [],
    droppedStatuses: [],
    notes: [],
  };

  const nodes = [];
  const typeOf = new Map();
  for (const n of old.nodes ?? []) {
    if (!n || typeof n.id !== 'string') continue;
    let type = TYPE_MAP[n.type];
    if (!type) {
      type = 'note';
      report.notes.push(`node "${n.id}": unknown old type "${n.type}" kept as a note`);
    }
    if (n.type === 'venue') report.notes.push(`venue "${n.id}" became a task (§7)`);

    const node = { id: n.id, type, label: String(n.label ?? n.id) };
    if (n.status) {
      const mapped = STATUS_MAP[type][n.status];
      if (mapped) node.status = mapped;
      else report.droppedStatuses.push(`"${n.id}": a ${type} cannot be "${n.status}"`);
    }
    if (n.type === 'venue' && !node.status) node.status = 'todo';

    const fields = {};
    for (const [key, value] of Object.entries(n.fields ?? {})) fields[key] = String(value);
    if (n.detail) fields.Detail = String(n.detail);
    if (Object.keys(fields).length > 0) node.fields = fields;
    if (n.meta && typeof n.meta === 'object') node.meta = n.meta;
    for (const [key, value] of Object.entries(n)) {
      if (!KNOWN_KEYS.includes(key)) node[key] = value; // bar, root, x, y … survive
    }
    nodes.push(node);
    typeOf.set(node.id, node.type);
  }

  // The old map attached results to methods; the schema says findings yield
  // studies. Route each finding → method edge to the method's own study.
  const methodStudies = new Map();
  for (const e of old.edges ?? []) {
    if (typeOf.get(e?.from) === 'method' && typeOf.get(e?.to) === 'study') {
      if (!methodStudies.has(e.from)) methodStudies.set(e.from, new Set());
      methodStudies.get(e.from).add(e.to);
    }
  }

  const edges = [];
  const seen = new Set();
  const push = (from, relation, to, approxNote) => {
    const edge = { from, relation, to };
    const key = edgeKey(edge);
    if (from === to || seen.has(key)) return;
    if (!relationAllows(relation, typeOf.get(from), typeOf.get(to))) return;
    seen.add(key);
    edges.push(edge);
    if (approxNote) report.approximated.push(approxNote);
  };

  for (const e of old.edges ?? []) {
    if (!e) continue;
    const fromType = typeOf.get(e.from);
    const toType = typeOf.get(e.to);
    const describe = `${e.from} —${e.rel}→ ${e.to}`;
    if (!fromType || !toType) {
      report.droppedEdges.push(`${describe} (missing endpoint)`);
      continue;
    }
    if (fromType === 'finding' && toType === 'method') {
      const studies = methodStudies.get(e.to);
      if (studies?.size === 1) push(e.from, 'yields', [...studies][0]);
      else report.droppedEdges.push(`${describe} (method serves ${studies?.size ?? 0} studies)`);
      continue;
    }
    const mapped = mapEdge(e.rel, fromType, toType);
    if (!mapped) {
      report.droppedEdges.push(`${describe} (schema has no ${fromType} → ${toType} relation)`);
      continue;
    }
    if (mapped.flip) {
      push(e.to, mapped.relation, e.from);
    } else {
      push(e.from, mapped.relation, e.to,
        mapped.approx ? `${describe} → bounds (nearest legal relation)` : undefined);
    }
  }

  const meta = { ...(old.meta ?? {}) };
  meta.id ??= slugify(meta.title ?? 'migrated-map');
  return { graph: { version: 1, meta, nodes, edges }, report };
}
