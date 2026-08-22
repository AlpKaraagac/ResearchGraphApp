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

// Device-local app settings (e.g. the Zotero key and library ID). Nothing
// here ever leaves the browser.
const SETTINGS_KEY = 'rg.settings';

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function saveSettings(patch) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch }));
  } catch { /* settings are a convenience; losing them is harmless */ }
}

// Clearing a map is the one destructive action here, so the cleared copy is
// kept under its own key — the undo survives a reload, not just a click.
const BACKUP_PREFIX = 'rg.backup.';

export function saveBackup(graph) {
  try {
    if (!graph?.meta?.id) return { ok: false };
    localStorage.setItem(BACKUP_PREFIX + graph.meta.id, JSON.stringify(graph));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export function loadBackup(id) {
  try {
    if (!id) return null;
    const raw = localStorage.getItem(BACKUP_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearBackup(id) {
  try {
    if (id) localStorage.removeItem(BACKUP_PREFIX + id);
  } catch { /* nothing to do */ }
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
