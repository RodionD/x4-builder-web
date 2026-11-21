/*
  X4 Builder Web - saving complexes and exchanging construction plans.
  Complexes live in the browser (localStorage) and go to / come from JSON files. Construction plans: the player's
  constructionplans.xml (the game keeps it in its profile folder) and the game's own plans
  (libraries/constructionplans.xml) are read as module lists; a station is written as <plans><plan><entry macro/>.
  As in the original (module_Station.GetConstructionPlan), entries carry no positions: the game puts the modules
  at the plan's origin and they are arranged in the station editor.
*/
'use strict';

const IO = (() => {
  const KEY = 'x4builderweb.complexes.v1';
  const SETTINGS = 'x4builderweb.settings.v1';

  function loadComplexes() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function saveComplexes(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveSettings(s) { try { localStorage.setItem(SETTINGS, JSON.stringify(s)); } catch (e) { /* private mode */ } }

  function download(name, text, type = 'application/json') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function pickFile(accept) {
    return new Promise(res => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = accept;
      i.onchange = () => res(i.files[0] || null);
      i.click();
    });
  }

  // <plans><plan id name><entry index macro>... -> [{id, name, modules: [{macro, count}]}]
  function parsePlans(text) {
    const doc = XmlDiff.parse(text, 'constructionplans');
    const out = [];
    for (const p of doc.getElementsByTagName('plan')) {
      const counts = new Map();
      for (const e of p.getElementsByTagName('entry')) {
        const m = e.getAttribute('macro');
        // connectors (struct_*: crosses and the like) are no station modules: the automatic layout adds them again itself;
        // counted as modules they showed up as "not in the game data (extension off?)" (the player, 2026-11-19)
        if (m && /^struct_/.test(m)) continue;
        if (m) counts.set(m, (counts.get(m) || 0) + 1);
      }
      // the entries as they stand (for the "extend" layout: these stay where they are, new modules are joined to them)
      const ser = new XMLSerializer(), base = [];
      for (const e of p.getElementsByTagName('entry')) {
        const pos = e.getElementsByTagName('position')[0], rot = e.getElementsByTagName('rotation')[0], pr = e.getElementsByTagName('predecessor')[0];
        const f = (el, a) => el ? Number(el.getAttribute(a)) || 0 : 0;
        if (!e.getAttribute('macro')) continue;
        base.push({ idx: Number(e.getAttribute('index')), macro: e.getAttribute('macro'), conn: e.getAttribute('connection') || null,
          pred: pr ? Number(pr.getAttribute('index')) : null, predConn: pr ? pr.getAttribute('connection') : null,
          p: [f(pos, 'x'), f(pos, 'y'), f(pos, 'z')], rot: { yaw: f(rot, 'yaw'), pitch: f(rot, 'pitch'), roll: f(rot, 'roll') },
          raw: ser.serializeToString(e) });
      }
      out.push({ id: p.getAttribute('id'), name: p.getAttribute('name') || p.getAttribute('id'), modules: [...counts].map(([macro, count]) => ({ macro, count })), base });
    }
    return out;
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // the modules the layout could not place: root entries (no predecessor / connection, as the layout's first entry),
  // indexes after the placed ones, on a grid beside the placed modules' box (+X side), one cell per module, the cell
  // larger than the largest of their boxes, so they overlap neither the structure nor each other; joined in the editor
  function unplacedEntries(st, L, indent) {
    const list = L.unplaced || [];
    if (!list.length) return '';
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const e of L.entries) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], e.box.lo[i]); hi[i] = Math.max(hi[i], e.box.hi[i]); }
    const boxes = L.unplacedBox || [];
    const GAP = 500;
    const step = Math.max(2500, ...boxes.filter(Boolean).map(b => 2 * Math.max(...b.h) + GAP));
    const cols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
    const cy = (lo[1] + hi[1]) / 2;
    let x = '';
    list.forEach((macro, k) => {
      const c = (boxes[k] && boxes[k].c) || [0, 0, 0];
      // the box centre at the cell centre (the module is not turned)
      const px = hi[0] + GAP + (k % cols) * step + step / 2 - c[0], py = cy - c[1], pz = lo[2] + Math.floor(k / cols) * step + step / 2 - c[2];
      x += `${indent}<entry index="${L.entries.length + k + 1}" macro="${esc(macro)}">\n`;
      x += `${indent}  <offset>\n${indent}    <position x="${+px.toFixed(3)}" y="${+py.toFixed(3)}" z="${+pz.toFixed(3)}"/>\n${indent}  </offset>\n`;
      if (typeof StationLoadout !== 'undefined') x += StationLoadout.upgradesXml(st, macro, indent + '  ');
      x += `${indent}</entry>\n`;
    });
    return x;
  }

  // the game's plan file (as the files the station editor exports into <profile>/constructionplan/: one plan, id
  // "player_<seconds>"). The modules are put on a grid 2.5 km apart around the plan's centre, so they do not overlap;
  // the builder knows no snap connections, so they are arranged and joined in the station editor.
  // L: an automatic layout (layout.js): the modules connected by their snaps; without it the old grid
  function planXml(st, L) {
    if (L && L.entries.length) {
      const id = 'player_' + Math.floor(Date.now() / 1000);
      return '<?xml version="1.0" encoding="UTF-8"?>\n<plans>\n' + `  <plan id="${id}" name="${esc(st.name || 'План')}" description="X4 Builder Web">\n`
        + Layout.planEntries(st, L, esc, '    ') + unplacedEntries(st, L, '    ') + '  </plan>\n</plans>\n';
    }
    const mods = [];
    for (const m of st.modules) if (m.enabled) for (let k = 0; k < m.count; k++) mods.push(m.macro);
    const cols = Math.max(1, Math.ceil(Math.sqrt(mods.length)));
    const step = 2500, half = (cols - 1) * step / 2;
    const id = 'player_' + Math.floor(Date.now() / 1000);
    let x = '<?xml version="1.0" encoding="UTF-8"?>\n<plans>\n';
    x += `  <plan id="${id}" name="${esc(st.name || 'План')}" description="X4 Builder Web">\n`;
    mods.forEach((macro, i) => {
      const px = (i % cols) * step - half, pz = Math.floor(i / cols) * step - half;
      // the turrets and shields of the module (StationLoadout), as the game's plan keeps them
      const up = typeof StationLoadout !== 'undefined' ? StationLoadout.upgradesXml(st, macro, '      ') : '';
      x += `    <entry index="${i + 1}" macro="${esc(macro)}">\n      <offset>\n        <position x="${px}" y="0" z="${pz}"/>\n      </offset>\n${up}    </entry>\n`;
    });
    return x + '  </plan>\n</plans>\n';
  }
  const planFileName = st => (String(st.name || 'План').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'План') + '.xml';

  // save straight into the game's constructionplan folder (Chromium: the folder is asked once and kept), else download
  const PLANDB = { name: 'x4builderweb-plans', store: 'h' };
  function idb(mode, fn) {
    return new Promise(res => {
      if (!window.indexedDB) { res(null); return; }
      const r = indexedDB.open(PLANDB.name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(PLANDB.store);
      r.onerror = () => res(null);
      r.onsuccess = () => { const tx = r.result.transaction(PLANDB.store, mode); const q = fn(tx.objectStore(PLANDB.store)); tx.oncomplete = () => res(q && q.result !== undefined ? q.result : null); tx.onerror = () => res(null); };
    });
  }
  async function planFolder(change) {
    if (!window.showDirectoryPicker) return null;
    let h = change ? null : await idb('readonly', s => s.get('plans'));
    if (h) {
      let p = await h.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted') p = await h.requestPermission({ mode: 'readwrite' });
      if (p === 'granted') return h;
    }
    h = await window.showDirectoryPicker({ id: 'x4plans', mode: 'readwrite' });
    await idb('readwrite', s => s.put(h, 'plans'));
    return h;
  }
  // -> {where: 'folder'|'download', name, folder}
  async function savePlan(st, change, progress) {
    if (typeof StationLoadout !== 'undefined') await StationLoadout.prepare(st);
    const L = typeof Layout !== 'undefined' && st.layoutOn !== false ? await Layout.make(st, progress) : null;
    const name = planFileName(st), text = planXml(st, L);
    // the plan saved for the game becomes the station's base: the next extend layout starts from it (the player,
    // 2026-11-19: the open station is the plan - no file to pick)
    if (L && L.entries.length) { try { const p = parsePlans(text)[0]; if (p && p.base.length) { st.base = { name: p.name, entries: p.base }; if (!st.layoutMode) st.layoutMode = 'extend'; } } catch (e) { /* keep the old base */ } }
    try {
      const dir = await planFolder(change);
      if (dir) {
        const f = await dir.getFileHandle(name, { create: true });
        const w = await f.createWritable(); await w.write(text); await w.close();
        return { where: 'folder', name, folder: dir.name, L };
      }
    } catch (e) { if (e.name === 'AbortError') return null; }
    download(name, text, 'application/xml');
    return { where: 'download', name, L };
  }

  // the station's own plan file (<name>.xml) from the plans folder the builder saves to, or null (no folder / no file)
  // the plan files of a folder picked by the player (input webkitdirectory: Firefox / file://), kept until the page reloads
  const planFiles = new Map();
  function setPlanFiles(files) {
    planFiles.clear();
    for (const f of files) if (/\.xml$/i.test(f.name) && (f.webkitRelativePath || f.name).split('/').length <= 2) planFiles.set(f.name, f);
    return planFiles.size;
  }
  async function readOwnPlan(st) {
    const name = planFileName(st);
    if (planFiles.has(name)) return { name, text: await planFiles.get(name).text() };
    // opened from the TD panel (http://127.0.0.1:47101/builder/): its /plans/ serves the game's plan folder (Firefox has no
    // folder access for pages)
    try {
      const r = await fetch('../plans/' + encodeURIComponent(name), { cache: 'no-store' });
      if (r.ok) return { name, text: await r.text() };
    } catch (e) { /* not under the panel */ }
    try {
      if (!window.showDirectoryPicker) return { error: 'браузер не даёт доступа к папкам', name };
      const dir = await planFolder(false);
      if (!dir) return { error: 'папка планов не выбрана', name };
      const f = await (await dir.getFileHandle(name)).getFile();
      return { name: f.name, text: await f.text() };
    } catch (e) { return { error: e.name === 'NotFoundError' ? 'в папке планов нет такого файла' : e.name === 'NotAllowedError' ? 'нет разрешения на папку планов' : e.message, name }; }
  }

  // the access to the plans folder, asked from a click (the browser asks only on a user's action): the stored folder's
  // permission, else the folder picker; true when granted
  async function grantPlans() {
    try {
      if (!window.showDirectoryPicker) return false;
      const h = await idb('readonly', x => x.get('plans'));
      if (h && (await h.requestPermission({ mode: 'readwrite' })) === 'granted') return true;
      return !!(await planFolder(true));
    } catch (e) { return false; }
  }

  async function gamePlans() {
    const doc = await XmlDiff.loadPatched('libraries/constructionplans.xml');
    if (!doc) return [];
    return parsePlans(new XMLSerializer().serializeToString(doc));
  }

  return { loadComplexes, saveComplexes, loadSettings, saveSettings, download, pickFile, parsePlans, planXml, savePlan, gamePlans, readOwnPlan, grantPlans, setPlanFiles };
})();
