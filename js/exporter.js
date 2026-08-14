// Export and import. Three ways out — graph JSON, a self-contained HTML file
// with the whole viewer inlined, and JSON Canvas (jsoncanvas.org) — and two
// ways back in: graph JSON, and .canvas as far as it round-trips. Our own
// .canvas exports round-trip losslessly via the rgNode/rgGraph extra
// properties the spec tolerates; foreign canvases import best-effort.

import { validateGraph, relationAllows, edgeKey } from './schema.js';

export function download(filename, text, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- JSON Canvas -----------------------------------------------------------

const TYPE_COLORS = {
  question: '#7048e8', gap: '#9c36b5', construct: '#1971c2', source: '#0c8599',
  study: '#2f9e44', method: '#66a80f', material: '#099268', finding: '#e8590c',
  claim: '#e03131', note: '#f08c00', task: '#846358',
};

const DEFAULT_CARD = { w: 185, h: 72 };

// Canvas positions are top-left corners; ours are card centres. rgNode keeps
// the full original node so a re-import loses nothing.
export function toCanvas(graph, sizes = new Map()) {
  const nodes = graph.nodes.map((node) => {
    const size = sizes.get(node.id) ?? DEFAULT_CARD;
    const cx = Number.isFinite(node.x) ? node.x : 0;
    const cy = Number.isFinite(node.y) ? node.y : 0;
    return {
      id: node.id,
      type: 'text',
      text: `${node.label}\n\n${node.type}${node.status ? ` · ${node.status}` : ''}`,
      x: Math.round(cx - size.w / 2),
      y: Math.round(cy - size.h / 2),
      width: Math.round(size.w),
      height: Math.round(size.h),
      color: TYPE_COLORS[node.type],
      rgNode: { ...node },
    };
  });
  const edges = graph.edges.map((edge, i) => ({
    id: `edge-${i + 1}`,
    fromNode: edge.from,
    toNode: edge.to,
    label: edge.relation,
  }));
  return { nodes, edges, rgGraph: { version: graph.version ?? 1, meta: graph.meta ?? {} } };
}

export function looksLikeCanvas(json) {
  if (!json || !Array.isArray(json.nodes)) return false;
  if (json.rgGraph) return true;
  if (Array.isArray(json.edges)
    && json.edges.some((e) => e && (e.fromNode !== undefined || e.toNode !== undefined))) {
    return true;
  }
  return json.nodes.some((n) => n
    && ['text', 'file', 'link', 'group'].includes(n.type) && n.width !== undefined);
}

// Returns { graph, report }. Nodes without rgNode (foreign canvases) become
// notes; edges keep their relation only when the label is a schema relation
// legal between the two endpoint types — everything else is reported, not
// silently swallowed.
export function fromCanvas(canvas) {
  const report = { foreignNodes: 0, droppedEdges: [] };
  const nodes = [];
  const seenIds = new Set();
  for (const cn of canvas.nodes ?? []) {
    if (!cn) continue;
    if (cn.rgNode && typeof cn.rgNode === 'object' && !Array.isArray(cn.rgNode)) {
      if (!seenIds.has(cn.rgNode.id)) {
        seenIds.add(cn.rgNode.id);
        nodes.push({ ...cn.rgNode });
      }
      continue;
    }
    const raw = cn.text ?? cn.label ?? cn.file ?? cn.url ?? cn.id ?? 'Untitled';
    const label = String(raw).split('\n')[0].trim().slice(0, 200) || 'Untitled';
    const id = String(cn.id ?? `node-${nodes.length + 1}`);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    report.foreignNodes += 1;
    nodes.push({
      id,
      type: 'note',
      label,
      x: (cn.x ?? 0) + (cn.width ?? DEFAULT_CARD.w) / 2,
      y: (cn.y ?? 0) + (cn.height ?? DEFAULT_CARD.h) / 2,
    });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  const seenEdges = new Set();
  for (const ce of canvas.edges ?? []) {
    if (!ce) continue;
    const from = byId.get(String(ce.fromNode));
    const to = byId.get(String(ce.toNode));
    const relation = ce.label;
    const describe = `${ce.fromNode} → ${ce.toNode}${ce.label ? ` (${ce.label})` : ''}`;
    if (!from || !to || !relation || !relationAllows(relation, from.type, to.type)) {
      report.droppedEdges.push(describe);
      continue;
    }
    const edge = { from: from.id, relation, to: to.id };
    if (seenEdges.has(edgeKey(edge)) || edge.from === edge.to) {
      report.droppedEdges.push(describe);
      continue;
    }
    seenEdges.add(edgeKey(edge));
    edges.push(edge);
  }

  return {
    graph: { version: 1, meta: canvas.rgGraph?.meta ?? {}, nodes, edges },
    report,
  };
}

// ---- import ----------------------------------------------------------------

export function importText(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, message: `Not valid JSON: ${error.message}` };
  }
  if (looksLikeCanvas(json)) {
    const { graph, report } = fromCanvas(json);
    const errors = validateGraph(graph);
    if (errors.length > 0) {
      return { ok: false, message: `Canvas import failed:\n${errors.slice(0, 5).join('\n')}` };
    }
    const notes = [
      report.foreignNodes > 0 ? `${report.foreignNodes} untyped node(s) became notes.` : '',
      report.droppedEdges.length > 0
        ? `Dropped ${report.droppedEdges.length} edge(s) that don't fit the schema.` : '',
    ].filter(Boolean).join(' ');
    return {
      ok: true,
      graph,
      message: `Imported ${graph.nodes.length} nodes and ${graph.edges.length} edges from JSON Canvas.${notes ? ` ${notes}` : ''}`,
    };
  }
  const errors = validateGraph(json);
  if (errors.length > 0) {
    const shown = errors.slice(0, 5).join('\n');
    const more = errors.length > 5 ? `\n…and ${errors.length - 5} more` : '';
    return { ok: false, message: `Not a valid graph:\n${shown}${more}` };
  }
  return {
    ok: true,
    graph: json,
    message: `Imported ${json.nodes.length} nodes and ${json.edges.length} edges.`,
  };
}

// ---- self-contained HTML ---------------------------------------------------

// Assembled at export time from the live app's own sources: every module is
// inlined as a data: URL behind an import map, the CSS goes into a <style>,
// and the graph rides along in a JSON script tag. No file:// fetches, no
// CDNs — the file opens anywhere. Order matters only for readability; the
// import map resolves dependencies by name.
const MODULE_NAMES = [
  'schema', 'lint', 'layout', 'store', 'view', 'render', 'forms', 'exporter', 'app',
];

async function fetchText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not read ${path} (HTTP ${response.status})`);
  return response.text();
}

export async function buildSelfContainedHtml(graph) {
  const [indexHtml, css, ...sources] = await Promise.all([
    fetchText('index.html'),
    fetchText('css/app.css'),
    ...MODULE_NAMES.map((name) => fetchText(`js/${name}.js`)),
  ]);

  const importMap = { imports: {} };
  MODULE_NAMES.forEach((name, i) => {
    const source = sources[i].replace(/from '\.\/(\w+)\.js'/g, "from 'rg:$1'");
    importMap.imports[`rg:${name}`] = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
  });

  const noScriptClose = (s) => s.replace(/</g, '\\u003c');
  const replacement = [
    `<script type="application/json" id="embedded-graph">${noScriptClose(JSON.stringify(graph))}</script>`,
    `<script type="importmap">${noScriptClose(JSON.stringify(importMap))}</script>`,
    "<script type=\"module\">import 'rg:app';</script>",
  ].join('\n');

  let html = indexHtml;
  const linkTag = /<link rel="stylesheet" href="css\/app\.css">/;
  const scriptTag = /<script type="module" src="js\/app\.js"><\/script>/;
  if (!linkTag.test(html) || !scriptTag.test(html)) {
    throw new Error('index.html changed shape; the HTML exporter needs updating');
  }
  html = html.replace(linkTag, `<style>\n${css}</style>`);
  html = html.replace(scriptTag, replacement);
  return html;
}
