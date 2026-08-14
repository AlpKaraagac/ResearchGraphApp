// localStorage persistence, keyed per graph: each graph lives under its own
// key (rg.graph.<meta.id>) and rg.current names the one the app has open.
// save() never throws — the caller shows the result on the save indicator,
// because a silent failure here is exactly what the app must not allow.

const GRAPH_PREFIX = 'rg.graph.';
const CURRENT_KEY = 'rg.current';

export function load(id) {
  try {
    if (!id) return null;
    const raw = localStorage.getItem(GRAPH_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function loadCurrent() {
  try {
    return load(localStorage.getItem(CURRENT_KEY));
  } catch {
    return null;
  }
}

export function save(graph) {
  try {
    const id = graph.meta?.id;
    if (!id) throw new Error('graph has no meta.id');
    localStorage.setItem(GRAPH_PREFIX + id, JSON.stringify(graph));
    localStorage.setItem(CURRENT_KEY, id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
