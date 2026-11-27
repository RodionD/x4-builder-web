/*
  X4 Builder Web - game folder access.
  The player picks the X4 folder in the browser (nothing leaves the computer). The .cat files are text indexes of the
  .dat archives: "path size timestamp md5" per line, the data of an entry follows the previous one in the .dat.
  Base game: NN.cat (later ones override earlier ones). Extension: extensions/<id>/ext_NN.cat (its own files, seen as
  extensions/<id>/<path>) and subst_NN.cat (replaces base game files with the same path).
  Same file lookup rule as the original X4 Builder (data.data_ReadData): the latest archive wins.
*/
'use strict';

const CatFS = (() => {
  // all picked files by their relative path below the chosen folder (lower case, forward slashes)
  let files = new Map();
  // virtual game file system: path (lower case, '/' separators, with extension) -> {file, offset, size, src}
  let entries = new Map();
  let extensions = [];

  const norm = p => p.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();

  // the picked folder may be the game folder itself or its parent: find the prefix that holds 01.cat
  function setFiles(list) {
    const raw = [];
    for (const f of list) {
      const rel = norm(f.webkitRelativePath || f.relPath || f.name);
      raw.push([rel, f]);
    }
    let prefix = null;
    for (const [rel] of raw) {
      const m = rel.match(/^(.*?)(?:^|\/)01\.cat$/);
      if (m && !rel.includes('extensions/')) {
        const p = rel.slice(0, rel.length - '01.cat'.length);
        if (prefix === null || p.length < prefix.length) prefix = p;
      }
    }
    if (prefix === null) return false;
    const next = new Map();
    for (const [rel, f] of raw) {
      if (rel.startsWith(prefix)) next.set(rel.slice(prefix.length), f);
    }
    files = next;
    return true;
  }

  async function readText(file) {
    return await file.text();
  }

  async function parseCat(catPath, datPath, mount, subst) {
    const cat = files.get(catPath), dat = files.get(datPath);
    if (!cat || !dat) return 0;
    const text = await readText(cat);
    let offset = 0, n = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      // name may contain spaces: the last three fields are size, timestamp, md5
      const parts = line.replace(/\r$/, '').split(' ');
      if (parts.length < 4) continue;
      const size = parseInt(parts[parts.length - 3], 10);
      const name = norm(parts.slice(0, parts.length - 3).join(' '));
      if (!isNaN(size)) {
        const key = subst ? name : (mount ? mount + name : name);
        entries.set(key, { file: dat, offset, size, src: catPath });
        n++;
        offset += size;
      }
    }
    return n;
  }

  // extension list from extensions/*/content.xml
  async function readExtensions() {
    const ids = new Set();
    for (const rel of files.keys()) {
      const m = rel.match(/^extensions\/([^/]+)\/content\.xml$/);
      if (m) ids.add(m[1]);
    }
    const list = [];
    for (const id of ids) {
      let name = id, enabled = true, deps = [], version = '';
      try {
        const doc = new DOMParser().parseFromString(await readText(files.get(`extensions/${id}/content.xml`)), 'application/xml');
        const c = doc.documentElement;
        name = c.getAttribute('name') || id;
        version = c.getAttribute('version') || '';
        enabled = c.getAttribute('enabled') !== '0' && c.getAttribute('enabled') !== 'false';
        for (const d of c.getElementsByTagName('dependency')) {
          if (d.getAttribute('id')) deps.push(d.getAttribute('id').toLowerCase());
        }
      } catch (e) { /* a broken content.xml: the folder name is used */ }
      const hasData = [...files.keys()].some(r => r.startsWith(`extensions/${id}/`) && r.endsWith('.cat'));
      list.push({ id, name, version, enabled, deps, hasData });
    }
    // load order: dependencies first, then alphabetical (as the game does)
    list.sort((a, b) => a.id.localeCompare(b.id));
    const done = new Set(), out = [];
    const visit = (e, stack) => {
      if (done.has(e.id) || stack.has(e.id)) return;
      stack.add(e.id);
      for (const d of e.deps) { const de = list.find(x => x.id === d); if (de) visit(de, stack); }
      done.add(e.id); out.push(e);
    };
    for (const e of list) visit(e, new Set());
    return out;
  }

  // mount everything; enabledIds: set of extension ids to use (null = as content.xml says); knownIds: previously seen ids
  async function mount(enabledIds, progress, knownIds) {
    entries = new Map();
    const cats = [...files.keys()].filter(r => /^\d\d\.cat$/.test(r)).sort();
    for (const c of cats) {
      progress && progress(`Архив ${c}`);
      await parseCat(c, c.replace(/\.cat$/, '.dat'), '', false);
    }
    extensions = await readExtensions();
    for (const e of extensions) {
      e.active = enabledIds ? (knownIds && !knownIds.has(e.id) ? e.enabled : enabledIds.has(e.id)) : e.enabled;
      if (!e.active) continue;
      const base = `extensions/${e.id}/`;
      const ecats = [...files.keys()].filter(r => r.startsWith(base) && /\/(ext|subst)_\d\d\.cat$/.test(r)).sort();
      for (const c of ecats) {
        progress && progress(`Расширение ${e.id}: ${c.slice(base.length)}`);
        await parseCat(c, c.replace(/\.cat$/, '.dat'), base, /\/subst_\d\d\.cat$/.test(c));
      }
    }
    return entries.size;
  }

  function has(path) { return entries.has(norm(path)); }

  async function readBytes(path) {
    const e = entries.get(norm(path));
    if (!e) return null;
    return new Uint8Array(await e.file.slice(e.offset, e.offset + e.size).arrayBuffer());
  }

  async function read(path) {
    const p = norm(path);
    let e = entries.get(p);
    let gz = false;
    if (!e && entries.has(p + '.gz')) { e = entries.get(p + '.gz'); gz = true; }
    if (!e) return null;
    let blob = e.file.slice(e.offset, e.offset + e.size);
    if (gz || p.endsWith('.gz')) blob = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).blob();
    let text = await blob.text();
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text;
  }

  // the file of the base game and the same path in each active extension (for diff patching), in load order
  function layers(path) {
    const p = norm(path);
    const out = [];
    if (entries.has(p)) out.push({ ext: null, path: p });
    for (const e of extensions) {
      if (!e.active) continue;
      const ep = `extensions/${e.id}/${p}`;
      if (entries.has(ep)) out.push({ ext: e.id, path: ep });
    }
    return out;
  }

  function list(prefix, suffix) {
    const p = norm(prefix || '');
    const out = [];
    for (const k of entries.keys()) if (k.startsWith(p) && (!suffix || k.endsWith(suffix))) out.push(k);
    return out;
  }

  return {
    setFiles, mount, has, read, readBytes, layers, list, norm,
    get extensions() { return extensions; },
    get size() { return entries.size; },
    get pickedCount() { return files.size; },
    readPicked: async rel => { const f = files.get(norm(rel)); return f ? await f.text() : null; },
  };
})();
