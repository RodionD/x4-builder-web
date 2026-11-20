/*
  X4 Builder Web - savegame analysis (the original's GameImporter_Ships.ReadSaveGame / module_complex player
  stations): the player's save (.xml.gz, about 1.5 GB of XML when unpacked) is read as a stream in the browser - gzip
  stream, text, a tag scanner - without building a document. Taken: the save info (player, money, game time), the
  player's stations (name, code, sector, the modules of their construction sequence) and ships (class, macro, name,
  code, sector). Stations go to the planner as a complex; the sector names come from libraries/mapdefaults.xml.
*/
'use strict';

const Savegame = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const F = { tab: 'stations', q: '', sel: new Set() };
  let R = null;        // the result of the last read (kept in the browser: the map's fog of war and the lists survive a reload)
  const KEY = 'x4builderweb.savegame.v1';
  function persist() {
    if (!R) { try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ } return; }
    const o = { info: R.info, file: R.file, fileDate: R.fileDate, readAt: R.readAt, time: R.time,
      sectors: [...R.sectors], ships: R.ships, stations: R.stations.map(x => ({ ...x, modules: [...x.modules] })) };
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* too big or private mode: only this session */ }
  }
  (function restore() {
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!o) return;
      R = { ...o, sectors: new Map(o.sectors), stations: o.stations.map(x => ({ ...x, modules: new Map(x.modules) })) };
    } catch (e) { R = null; }
  })();
  const when = ts => (ts ? new Date(ts).toLocaleString('ru-RU') : '');
  // what the map's fog of war is based on: "save name, game time, file date"
  function describe() {
    if (!R) return null;
    const i = R.info || {};
    return `${i.save ? i.save.name : R.file}${i.game ? ', ' + fmt(Number(i.game.time) / 3600, 1) + ' ч игры' : ''}${R.fileDate ? ', файл от ' + when(R.fileDate) : ''}`;
  }
  let busy = false, progress = '';
  let sectorNames = null;

  const attrRe = /([\w:.-]+)="([^"]*)"/g;
  const unesc = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  function attrs(tag) { const o = {}; let m; attrRe.lastIndex = 0; while ((m = attrRe.exec(tag))) o[m[1]] = unesc(m[2]); return o; }

  async function loadSectorNames() {
    if (sectorNames) return;
    sectorNames = new Map();
    const doc = await XmlDiff.loadPatched('libraries/mapdefaults.xml');
    if (!doc) return;
    for (const d of doc.getElementsByTagName('dataset')) {
      const id = d.getElementsByTagName('identification')[0];
      if (id) sectorNames.set((d.getAttribute('macro') || '').toLowerCase(), id.getAttribute('name'));
    }
  }
  const sectorName = m => { const k = (m || '').toLowerCase(); return k && sectorNames && sectorNames.has(k) ? Game.text(sectorNames.get(k)) || m : (m || ''); };

  // the stream scanner: components are kept on a stack (class, macro, owner, ...); a player station collects the
  // <entry macro> of its <construction><sequence>; ships of the player are listed with the sector they are in
  async function read(file, onProgress) {
    const res = { info: {}, stations: [], ships: [], sectors: new Map(), size: file.size, time: Date.now() };
    let stream = file.stream();
    if (/\.gz$/i.test(file.name) || true) {
      // gzip magic 1f 8b: unpack; a plain .xml is read as it is
      const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
      if (head[0] === 0x1f && head[1] === 0x8b) stream = stream.pipeThrough(new DecompressionStream('gzip'));
    }
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    const stack = []; // {cls, macro, ...}
    let station = null, stationDepth = -1, inSeq = false, inInfo = true;
    let rest = '', bytes = 0, lastReport = 0;
    const sectorOf = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].cls === 'sector') return stack[i].macro; return null; };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      let text = rest + value;
      let i = 0;
      for (;;) {
        const a = text.indexOf('<', i);
        if (a < 0) { i = text.length; break; }
        const b = text.indexOf('>', a);
        if (b < 0) { i = a; break; }
        const tag = text.slice(a + 1, b);
        i = b + 1;
        const c0 = tag.charCodeAt(0);
        if (c0 === 47) { // "/"
          if (tag === '/component') {
            const top = stack.pop();
            if (top && station && stack.length < stationDepth) { res.stations.push(station); station = null; stationDepth = -1; inSeq = false; }
          } else if (tag === '/sequence') inSeq = false;
          else if (tag === '/info') inInfo = false;
          continue;
        }
        if (c0 === 63 || c0 === 33) continue; // <? and <!
        const self = tag.charCodeAt(tag.length - 1) === 47;
        if (tag.startsWith('component ')) {
          const at = attrs(tag);
          const node = { cls: at.class, macro: at.macro };
          // sectors: owner (as the map of the original shows it), the player's knowledge
          if (at.class === 'sector' && at.macro) res.sectors.set(at.macro.toLowerCase(), { owner: at.owner, contested: at.contested === '1', known: at.known === '1' || /\bplayer\b/.test(at.knownto || ''), code: at.code });
          if (at.owner === 'player') {
            if (at.class === 'station' && !station) {
              station = { code: at.code, name: at.name, macro: at.macro, sector: sectorOf(), modules: new Map(), state: at.state || '' };
              stationDepth = stack.length + 1;
            } else if (/^ship_(xs|s|m|l|xl)$/.test(at.class || '')) {
              res.ships.push({ code: at.code, name: at.name, macro: at.macro, cls: at.class, sector: sectorOf(), docked: !!stack.find(x => x.cls === 'station' || /^ship_/.test(x.cls || '')) });
            }
          }
          if (!self) stack.push(node);
        } else if (station && inSeq && tag.startsWith('entry ')) {
          const at = attrs(tag);
          if (at.macro) station.modules.set(at.macro, (station.modules.get(at.macro) || 0) + 1);
        } else if (station && tag.startsWith('sequence') && stack.length === stationDepth) {
          inSeq = !self;
        } else if (inInfo) {
          if (tag.startsWith('player ')) res.info.player = attrs(tag);
          else if (tag.startsWith('game ')) res.info.game = attrs(tag);
          else if (tag.startsWith('save ')) res.info.save = attrs(tag);
        }
      }
      rest = text.slice(i);
      if (rest.length > 1e6) rest = rest.slice(-1e6); // a broken file: no '>' for a megabyte
      if (bytes - lastReport > 2e7) { lastReport = bytes; onProgress && onProgress(`Прочитано ${fmt(bytes / 1e6)} млн знаков, станций ${res.stations.length}, кораблей ${res.ships.length}`); await new Promise(r => setTimeout(r, 0)); }
    }
    res.time = (Date.now() - res.time) / 1000;
    return res;
  }

  async function open(root) {
    const f = await IO.pickFile('.gz,.xml,application/gzip,application/xml');
    if (!f) return;
    await loadFile(f, root);
  }
  async function loadFile(f, root) {
    busy = true; progress = 'Чтение ' + f.name; render(root);
    try {
      await loadSectorNames();
      R = await read(f, t => { progress = t; const e = root.querySelector('#svProgress'); if (e) e.textContent = t; });
      R.file = f.name; R.fileDate = f.lastModified || null; R.readAt = Date.now();
      persist();
      F.sel = new Set(R.stations.map(s => s.code));
    } catch (e) { progress = 'Ошибка: ' + e.message; R = null; }
    // the page may have been left while the save was read: #main is another page's then
    busy = false; if (UI.active('savegame')) render(root);
  }

  function toPlanner() {
    const list = R.stations.filter(s => F.sel.has(s.code));
    if (!list.length) return null;
    const c = Planner.newComplex(`Станции игрока (${R.info.player ? R.info.player.name : 'сохранение'})`);
    c.stations = list.map(s => {
      const st = Planner.newStation(`${s.code} ${s.name || ''}`.trim());
      for (const [m, n] of s.modules) if (Game.D.modules.has(m)) Planner.addModule(st, m, n);
      st.sector = sectorName(s.sector);
      return st;
    });
    return c;
  }

  const CLASS = { ship_xl: 'XL', ship_l: 'L', ship_m: 'M', ship_s: 'S', ship_xs: 'XS' };

  function render(root) {
    // a save remembered from an earlier visit: the sector names are loaded on the first look
    if (R && !sectorNames) { loadSectorNames().then(() => { if (UI.active('savegame')) render(root); }); }
    if (!R) {
      root.innerHTML = `<div class="card-lite">
        <h2>Анализ сохранения</h2>
        <p>Выберите файл сохранения игры (<code>quicksave.xml.gz</code>, <code>autosave_NN.xml.gz</code>, <code>save_NNN.xml.gz</code>).
          В Linux они лежат в <code>~/.config/EgoSoft/X4/&lt;id&gt;/save</code>, в Windows — в «Документы/Egosoft/X4/&lt;id&gt;/save».
          Файл читается потоком прямо в браузере, на это уходит около минуты.</p>
        <button data-sv="open" class="big" ${busy ? 'disabled' : ''}>Выбрать сохранение</button>
        <p id="svProgress" class="status">${esc(progress)}</p></div>`;
      return;
    }
    const i = R.info;
    const q = F.q.toLowerCase();
    let body = '';
    if (F.tab === 'stations') {
      const rows = R.stations.filter(s => !q || (s.name || '').toLowerCase().includes(q) || (s.code || '').toLowerCase().includes(q) || sectorName(s.sector).toLowerCase().includes(q)).map(s => {
        const n = [...s.modules.values()].reduce((a, b) => a + b, 0);
        const prod = [...s.modules].filter(([m]) => (Game.D.modules.get(m) || {}).isProduction).map(([m, k]) => `${esc(Game.moduleName(m))}${k > 1 ? ' ×' + k : ''}`).join(', ');
        return `<tr><td><input type="checkbox" data-svsel="${esc(s.code)}" ${F.sel.has(s.code) ? 'checked' : ''}></td><td><code>${esc(s.code)}</code></td><td class="nm">${esc(s.name || '')}</td>
          <td>${esc(sectorName(s.sector))}</td><td>${n}</td><td class="small info">${prod}</td></tr>`;
      }).join('');
      body = `<p><button data-sv="planner" ${F.sel.size ? '' : 'disabled'}>Выбранные станции → в планировщик</button></p>
        <table class="grid"><thead><tr><th></th><th>Код</th><th>Станция</th><th>Сектор</th><th>Модулей</th><th>Производство</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="hint">Нет станций</td></tr>'}</tbody></table>`;
    } else {
      const ships = R.ships.filter(s => !q || (s.name || '').toLowerCase().includes(q) || (s.code || '').toLowerCase().includes(q) || sectorName(s.sector).toLowerCase().includes(q) || (s.macro || '').includes(q));
      const byClass = {};
      for (const s of R.ships) byClass[s.cls] = (byClass[s.cls] || 0) + 1;
      body = `<p class="small">${Object.entries(byClass).sort().map(([k, v]) => `${CLASS[k] || k}: ${v}`).join(' · ')}</p>
        <table class="grid"><thead><tr><th>Код</th><th>Корабль</th><th>Модель</th><th>Кл.</th><th>Сектор</th></tr></thead><tbody>${ships.slice(0, 2000).map(s => `<tr><td><code>${esc(s.code)}</code></td>
          <td class="nm">${esc(s.name || '')}</td><td class="small">${esc(s.macro)}</td><td>${CLASS[s.cls] || ''}</td><td>${esc(sectorName(s.sector))}${s.docked ? ' <small>(в доке)</small>' : ''}</td></tr>`).join('')}</tbody></table>
        ${ships.length > 2000 ? `<p class="small">Показаны первые 2000 из ${ships.length}</p>` : ''}`;
    }
    root.innerHTML = `<div class="svhead">
        <h2>${esc(i.save ? i.save.name : R.file)}</h2>
        <p class="small">${esc(R.file)} · игрок ${esc(i.player ? i.player.name : '')} · ${i.player ? fmt(Number(i.player.money)) + ' Кр' : ''}
          · время игры ${i.game ? fmt(Number(i.game.time) / 3600, 1) + ' ч' : ''} · версия ${esc(i.game ? i.game.version : '')} · прочитано за ${fmt(R.time, 1)} с
          <button data-sv="open">Другое сохранение</button> <button data-sv="forget">Забыть сохранение</button></p>
        <p class="small">Файл от ${esc(when(R.fileDate))}, прочитан ${esc(when(R.readAt))}. По нему карта показывает туман войны и владельцев секторов; запомнено в этом браузере.</p>
        <div class="filters"><button data-svtab="stations" class="${F.tab === 'stations' ? 'on' : ''}">Станции (${R.stations.length})</button>
          <button data-svtab="ships" class="${F.tab === 'ships' ? 'on' : ''}">Корабли (${R.ships.length})</button>
          <input id="svq" placeholder="Поиск" value="${esc(F.q)}"></div>
      </div>${body}`;
  }

  function click(t, root) {
    const b = t.closest('[data-sv]');
    if (b) {
      if (b.dataset.sv === 'open') { open(root); return true; }
      if (b.dataset.sv === 'planner') { const c = toPlanner(); if (c) UI.addComplex(c); return true; }
      if (b.dataset.sv === 'forget') { R = null; persist(); progress = ''; render(root); return true; }
    }
    const tb = t.closest('[data-svtab]');
    if (tb) { F.tab = tb.dataset.svtab; render(root); return true; }
    return false;
  }
  function change(t, root) {
    if (t.dataset.svsel) { if (t.checked) F.sel.add(t.dataset.svsel); else F.sel.delete(t.dataset.svsel); render(root); return true; }
    return false;
  }
  function input(t, root) {
    if (t.id === 'svq') { F.q = t.value; const pos = t.selectionStart; render(root); const n = root.querySelector('#svq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return true; }
    return false;
  }
  function reset() { sectorNames = null; }

  return { render, click, change, input, reset, read, loadFile, F, sectorName, describe, get result() { return R; } };
})();
