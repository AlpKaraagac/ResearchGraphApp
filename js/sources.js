// Bibliography import: CSL-JSON and BibTeX in, `source` nodes out, using the
// mapping in SCHEMA.md §5. planSourceImport() is pure and decides create vs
// update — re-importing the same item updates rather than duplicates, matched
// on meta.zoteroKey, then DOI, then citation key. The Zotero Web API pull
// lives here too; the local API on port 23119 is deliberately not offered
// (it rejects browser requests — see SCHEMA.md §5).

import { slugify } from './forms.js';

// ---- CSL-JSON → source node ------------------------------------------------

// Zotero Web API csljson ids look like "392648/7VLLCTW7" or
// "http://zotero.org/users/12345/items/7VLLCTW7"; the item key is the final
// 8-character segment either way.
export function extractZoteroKey(id) {
  const match = /\/([A-Z0-9]{8})$/.exec(String(id ?? ''));
  return match ? match[1] : undefined;
}

function truncateAtWord(text, max = 60) {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max - 1);
  return `${text.slice(0, cut > 20 ? cut : max - 1)}…`;
}

export function cslToSource(item) {
  const names = (item.author ?? item.editor ?? [])
    .map((a) => a.family ?? a.literal ?? '')
    .filter(Boolean);
  let who = names[0] ?? '';
  if (names.length === 2) who = `${names[0]} & ${names[1]}`;
  else if (names.length > 2) who = `${names[0]} et al.`;

  const year = item.issued?.['date-parts']?.[0]?.[0];
  const title = truncateAtWord(String(
    item['title-short'] ?? item.shortTitle ?? item.title ?? 'Untitled',
  ));
  const label = who ? `${who} (${year ?? 'n.d.'}) — ${title}` : `${title} (${year ?? 'n.d.'})`;

  const citation = [
    item['container-title'], item.volume, item.page ?? item.pages, item.DOI,
  ].filter(Boolean).map(String).join(', ');

  const citationKey = item['citation-key'] ?? item.citationKey;
  const id = String(citationKey ?? item.id ?? '') || `src-${slugify(label)}`;

  const node = { id, type: 'source', label };
  const fields = {};
  if (citation) fields.Citation = citation;
  if (item.type) fields.Type = String(item.type);
  if (Object.keys(fields).length > 0) node.fields = fields;
  const meta = {};
  if (item.DOI) meta.doi = String(item.DOI);
  const zoteroKey = extractZoteroKey(item.id);
  if (zoteroKey) meta.zoteroKey = zoteroKey;
  if (Object.keys(meta).length > 0) node.meta = meta;
  return node;
}

// ---- BibTeX ----------------------------------------------------------------

const BIBTEX_TYPES = {
  article: 'article-journal',
  book: 'book',
  inbook: 'chapter',
  incollection: 'chapter',
  inproceedings: 'paper-conference',
  conference: 'paper-conference',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  thesis: 'thesis',
  techreport: 'report',
  report: 'report',
  unpublished: 'manuscript',
  misc: 'document',
  online: 'webpage',
  electronic: 'webpage',
  webpage: 'webpage',
  dataset: 'dataset',
  software: 'software',
};

function cleanBibValue(raw) {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\\([&%$#_])/g, '$1')
    .replace(/~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .trim();
}

function parseBibNames(value) {
  if (!value) return undefined;
  const people = value.split(/\s+and\s+/i).map((name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (trimmed.includes(',')) {
      const [family, given] = trimmed.split(',', 2).map((s) => s.trim());
      return { family, ...(given ? { given } : {}) };
    }
    const words = trimmed.split(/\s+/);
    const family = words[words.length - 1];
    const given = words.slice(0, -1).join(' ');
    return { family, ...(given ? { given } : {}) };
  }).filter(Boolean);
  return people.length > 0 ? people : undefined;
}

// Reads "name = value" pairs; values are {balanced braces}, "quoted", or bare
// words. Later duplicates of a field are ignored, matching BibTeX practice.
function parseBibFields(text) {
  const fields = {};
  let i = 0;
  const skipWs = () => { while (i < text.length && /\s/.test(text[i])) i += 1; };
  while (i < text.length) {
    skipWs();
    let name = '';
    while (i < text.length && /[\w-]/.test(text[i])) { name += text[i]; i += 1; }
    skipWs();
    if (!name || text[i] !== '=') break;
    i += 1;
    skipWs();
    let raw = '';
    if (text[i] === '{') {
      let depth = 1;
      i += 1;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') depth -= 1;
        if (depth > 0) raw += text[i];
        i += 1;
      }
    } else if (text[i] === '"') {
      let depth = 0;
      i += 1;
      while (i < text.length && !(text[i] === '"' && depth === 0)) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') depth -= 1;
        raw += text[i];
        i += 1;
      }
      i += 1;
    } else {
      while (i < text.length && text[i] !== ',') { raw += text[i]; i += 1; }
    }
    const key = name.toLowerCase();
    if (!(key in fields)) fields[key] = cleanBibValue(raw);
    while (i < text.length && text[i] !== ',') i += 1;
    i += 1;
  }
  return fields;
}

export function parseBibtex(text) {
  const items = [];
  const entryStart = /@\s*(\w+)\s*([{(])/g;
  let match;
  while ((match = entryStart.exec(text)) !== null) {
    const type = match[1].toLowerCase();
    const close = match[2] === '{' ? '}' : ')';
    let depth = 1;
    let i = entryStart.lastIndex;
    let body = '';
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === '{' || (ch === match[2] && match[2] === '(')) depth += 1;
      else if (ch === '}' || (ch === close && close === ')')) depth -= 1;
      if (depth > 0) body += ch;
      i += 1;
    }
    entryStart.lastIndex = i;
    if (['comment', 'preamble', 'string'].includes(type)) continue;

    const comma = body.indexOf(',');
    const key = (comma === -1 ? body : body.slice(0, comma)).trim();
    const f = parseBibFields(comma === -1 ? '' : body.slice(comma + 1));

    const yearText = f.year ?? /^(\d{4})/.exec(f.date ?? '')?.[1];
    const item = {
      id: key,
      'citation-key': key,
      type: BIBTEX_TYPES[type] ?? type,
    };
    if (f.title) item.title = f.title;
    if (f.shorttitle) item['title-short'] = f.shorttitle;
    const container = f.journal ?? f.journaltitle ?? f.booktitle;
    if (container) item['container-title'] = container;
    if (f.volume) item.volume = f.volume;
    if (f.pages) item.page = f.pages;
    if (f.doi) item.DOI = f.doi;
    const author = parseBibNames(f.author) ?? parseBibNames(f.editor);
    if (author) item.author = author;
    if (yearText) item.issued = { 'date-parts': [[Number(yearText)]] };
    items.push(item);
  }
  return items;
}

// ---- format detection ------------------------------------------------------

// Accepts a pasted CSL-JSON array, a Zotero Web API {items: […]} object, or
// BibTeX text. Items with neither title nor author (attachments, notes) are
// ignored and counted.
export function parseSourcesText(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Nothing to import — paste CSL-JSON or BibTeX first.');
  let items;
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let json;
    try {
      json = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Looks like JSON but does not parse: ${error.message}`);
    }
    if (Array.isArray(json)) items = json;
    else if (Array.isArray(json.items)) items = json.items;
    else throw new Error('JSON, but not CSL — expected an array of items (or {"items": […]}).');
  } else if (/@\s*\w+\s*[{(]/.test(trimmed)) {
    items = parseBibtex(trimmed);
    if (items.length === 0) throw new Error('No BibTeX entries found.');
  } else {
    throw new Error('Not recognizable as CSL-JSON or BibTeX.');
  }
  const usable = items.filter((it) => it && typeof it === 'object' && (it.title || it.author));
  return { items: usable, ignored: items.length - usable.length };
}

// ---- import planning -------------------------------------------------------

// Pure: decides which incoming items update an existing source node and which
// become new nodes. Matching order: meta.zoteroKey, then DOI, then id
// (citation key). Updates never touch the node's status — "verified" must
// survive a re-import.
export function planSourceImport(graph, cslItems) {
  const sources = graph.nodes.filter((n) => n.type === 'source');
  const byZotero = new Map();
  const byDoi = new Map();
  for (const node of sources) {
    if (node.meta?.zoteroKey) byZotero.set(node.meta.zoteroKey, node);
    if (node.meta?.doi) byDoi.set(String(node.meta.doi).toLowerCase(), node);
  }
  const allIds = new Set(graph.nodes.map((n) => n.id));
  const creates = [];
  const updates = [];
  const created = new Set();
  const claimed = new Set();
  let skipped = 0;

  for (const item of cslItems) {
    const incoming = cslToSource(item);
    let target = incoming.meta?.zoteroKey ? byZotero.get(incoming.meta.zoteroKey) : undefined;
    if (!target && incoming.meta?.doi) target = byDoi.get(incoming.meta.doi.toLowerCase());
    if (!target) {
      target = graph.nodes.find((n) => n.type === 'source' && n.id === incoming.id);
    }

    if (target) {
      if (claimed.has(target) || created.has(target)) {
        skipped += 1; // the same work twice in one paste
      } else {
        claimed.add(target);
        updates.push({ id: target.id, patch: incoming });
      }
      continue;
    }

    let id = incoming.id;
    let n = 2;
    while (allIds.has(id)) id = `${incoming.id}-${n++}`;
    allIds.add(id);
    const node = { ...incoming, id, status: 'to-read' };
    creates.push(node);
    created.add(node);
    if (node.meta?.zoteroKey) byZotero.set(node.meta.zoteroKey, node);
    if (node.meta?.doi) byDoi.set(node.meta.doi.toLowerCase(), node);
  }

  return { creates, updates, skipped };
}

// Applies one update patch to an existing source node, preserving status and
// any fields the import does not know about.
export function applySourcePatch(node, patch) {
  node.label = patch.label;
  const fields = { ...node.fields };
  if (patch.fields?.Citation) fields.Citation = patch.fields.Citation;
  if (patch.fields?.Type) fields.Type = patch.fields.Type;
  if (Object.keys(fields).length > 0) node.fields = fields;
  if (patch.meta) node.meta = { ...node.meta, ...patch.meta };
}

// ---- Zotero Web API --------------------------------------------------------

// https://api.zotero.org sends Access-Control-Allow-Origin: * and allows the
// Zotero-API-Key header (verified 2026-08), so this works from the browser.
// Public libraries need no key. /items/top skips attachments and child notes.
export async function zoteroPull({ key, libraryType, libraryId }) {
  const kind = libraryType === 'group' ? 'groups' : 'users';
  const id = String(libraryId ?? '').trim();
  if (!id) throw new Error('A library ID is required.');
  const headers = { 'Zotero-API-Version': '3' };
  if (key) headers['Zotero-API-Key'] = key;

  const items = [];
  const limit = 100;
  for (let start = 0; start < 2000; start += limit) {
    const url = `https://api.zotero.org/${kind}/${encodeURIComponent(id)}/items/top`
      + `?format=csljson&limit=${limit}&start=${start}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const why = response.status === 403 ? ' — bad key, or no access to that library'
        : response.status === 404 ? ' — no such library' : '';
      throw new Error(`Zotero API answered HTTP ${response.status}${why}.`);
    }
    const data = await response.json();
    const batch = Array.isArray(data) ? data : data.items ?? [];
    items.push(...batch);
    const total = Number(response.headers.get('Total-Results') ?? NaN);
    if (batch.length < limit || (Number.isFinite(total) && items.length >= total)) break;
  }
  return items;
}
