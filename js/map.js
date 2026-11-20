/*
  X4 Builder Web - galaxy map (the original's module_map / page_Map, in short): the clusters of the galaxy
  (maps/xu_ep2_universe/galaxy.xml with the extensions' diffs) as flat hexes at their positions (radius 10 000 km:
  the game's grid, 15 000 km apart horizontally, 17 320 km vertically), the sectors of a cluster inside it; names,
  sunlight, economy and security from libraries/mapdefaults.xml; owners and the player's stations and ships from the
  savegame read on the savegame page. A sector's sunlight can go to the current station of the planner.
*/
'use strict';

const GalaxyMap = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  // fog of war: with a savegame, sectors the player does not know are drawn blank (no name, owner, data)
  const F = { sel: null, view: null, color: 'owner', fog: true };
  let G = null; let loading = null;
  const R = 10e6; // cluster hex radius in metres

  const kids = (el, tag) => (el ? [...el.children].filter(c => !tag || c.tagName === tag) : []);
  const childEl = (el, tag) => kids(el, tag)[0] || null;
  const A = (el, n) => (el ? el.getAttribute(n) : null);
  const pos = conn => { const p = childEl(childEl(conn, 'offset'), 'position'); return { x: Number(A(p, 'x')) || 0, z: Number(A(p, 'z')) || 0 }; };

  const docCache = new Map();
  // the index has wildcard entries too ("Cluster_*" -> maps/xu_ep2_universe/clusters)
  let wild = null;
  function macroPath(name) {
    const k = String(name).toLowerCase();
    if (Game.D.macros.has(k)) return Game.D.macros.get(k);
    if (!wild) wild = [...Game.D.macros].filter(([n]) => n.includes('*')).map(([n, v]) => [new RegExp('^' + n.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), v]);
    const w = wild.find(([re]) => re.test(k));
    return w ? w[1] : null;
  }
  async function macroEl(name) {
    const path = macroPath(name);
    if (!path) return null;
    const p = path.replace(/\\/g, '/');
    if (!docCache.has(p)) docCache.set(p, (async () => { const t = await CatFS.read(p + '.xml'); try { return t ? XmlDiff.parse(t, p) : null; } catch (e) { return null; } })());
    const doc = await docCache.get(p);
    if (!doc) return null;
    const lname = String(name).toLowerCase();
    return [...doc.getElementsByTagName('macro')].find(m => (A(m, 'name') || '').toLowerCase() === lname) || null;
  }

  async function load(progress) {
    if (G) return;
    if (loading) return loading;
    loading = (async () => {
      const g = { clusters: [], defaults: new Map(), colors: new Map() };
      progress('Галактика…');
      const gal = await XmlDiff.loadPatched('maps/xu_ep2_universe/galaxy.xml');
      const md = await XmlDiff.loadPatched('libraries/mapdefaults.xml');
      if (md) for (const d of md.getElementsByTagName('dataset')) {
        const props = childEl(d, 'properties');
        const id = childEl(props, 'identification'), area = childEl(props, 'area');
        g.defaults.set((A(d, 'macro') || '').toLowerCase(), { name: A(id, 'name'), description: A(id, 'description'), sunlight: area ? Number(A(area, 'sunlight')) : null, economy: area ? Number(A(area, 'economy')) : null, security: area ? Number(A(area, 'security')) : null });
      }
      // faction colours: faction <color ref> -> colors.xml mapping -> color
      const cd = await XmlDiff.loadPatched('libraries/colors.xml');
      const col = new Map(), map = new Map();
      if (cd) {
        for (const c of cd.getElementsByTagName('color')) if (A(c, 'id')) col.set(A(c, 'id'), `rgb(${A(c, 'r')},${A(c, 'g')},${A(c, 'b')})`);
        for (const m of cd.getElementsByTagName('mapping')) map.set(A(m, 'id'), A(m, 'ref'));
      }
      for (const f of Game.D.factions.values()) {
        const ref = A(childEl(f.el, 'color'), 'ref');
        let c = ref, guard = 0;
        while (c && !col.has(c) && map.has(c) && guard++ < 5) c = map.get(c);
        if (c && col.has(c)) g.colors.set(f.id, col.get(c));
      }
      const list = gal ? [...gal.getElementsByTagName('connection')].filter(c => A(c, 'ref') === 'clusters') : [];
      let done = 0;
      for (const c of list) {
        const ref = A(childEl(c, 'macro'), 'ref');
        if (!ref) continue;
        const p = pos(c);
        const cm = await macroEl(ref);
        const sectors = [];
        if (cm) for (const sc of kids(childEl(cm, 'connections'), 'connection')) {
          if (A(sc, 'ref') !== 'sectors') continue;
          const sref = A(childEl(sc, 'macro'), 'ref');
          if (sref) sectors.push({ macro: sref.toLowerCase(), off: pos(sc) });
        }
        g.clusters.push({ macro: ref.toLowerCase(), x: p.x, z: p.z, sectors });
        if (++done % 20 === 0) progress(`Кластеры: ${done} из ${list.length}`);
      }
      // sector hexes: one sector fills the cluster; several share it, placed by their offsets
      for (const c of g.clusters) {
        if (c.sectors.length <= 1) { for (const s of c.sectors) { s.x = c.x; s.z = c.z; s.r = R * 0.94; } continue; }
        const cx = c.sectors.reduce((a, s) => a + s.off.x, 0) / c.sectors.length, cz = c.sectors.reduce((a, s) => a + s.off.z, 0) / c.sectors.length;
        const far = Math.max(...c.sectors.map(s => Math.hypot(s.off.x - cx, s.off.z - cz))) || 1;
        for (const s of c.sectors) { s.x = c.x + (s.off.x - cx) / far * R * 0.5; s.z = c.z + (s.off.z - cz) / far * R * 0.5; s.r = R * 0.46; }
      }
      G = g;
    })();
    return loading;
  }

  const U = 1e4; // drawing unit: 10 km
  const hex = (x, y, r) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i; return `${((x + r * Math.cos(a)) / U).toFixed(1)},${((y + r * Math.sin(a)) / U).toFixed(1)}`; }).join(' ');
  const dname = m => { const d = G.defaults.get(m); return d ? Game.text(d.name) || m : m; };
  // unknown to the player in the loaded save (and the fog on); without a save there is nothing to go by
  const hidden = m => { const sv = Savegame.result; if (!F.fog || !sv) return false; const x = sv.sectors.get(m); return !x || !x.known; };

  function sectorInfo(s) {
    const d = G.defaults.get(s.macro) || {};
    const sv = Savegame.result;
    const own = sv && sv.sectors.get(s.macro);
    const stations = sv ? sv.stations.filter(x => (x.sector || '').toLowerCase() === s.macro) : [];
    const ships = sv ? sv.ships.filter(x => (x.sector || '').toLowerCase() === s.macro) : [];
    return `<h2>${esc(dname(s.macro))}</h2>
      <table class="grid facts"><tbody>
        <tr><td>Макрос</td><td><code>${esc(s.macro)}</code></td></tr>
        ${own ? `<tr><td>Владелец</td><td>${esc(Game.factionName(own.owner))}${own.contested ? ' <span class="warn">оспаривается</span>' : ''}</td></tr>` : ''}
        ${d.sunlight != null ? `<tr><td>Солнце</td><td>${fmt(d.sunlight * 100)}% <button data-sun="${d.sunlight}">→ в текущую станцию</button></td></tr>` : ''}
        ${d.economy != null ? `<tr><td>Экономика</td><td>${fmt(d.economy, 2)}</td></tr>` : ''}
        ${d.security != null ? `<tr><td>Безопасность</td><td>${fmt(d.security, 2)}</td></tr>` : ''}
        ${sv ? `<tr><td>Ваши станции</td><td>${stations.length ? stations.map(x => esc(x.code + ' ' + (x.name || ''))).join(', ') : '—'}</td></tr>
          <tr><td>Ваши корабли</td><td>${ships.length}</td></tr>` : ''}
      </tbody></table>
      ${Game.text(d.description) ? `<p class="small desc">${esc(Game.text(d.description))}</p>` : ''}`;
  }

  async function render(root) {
    if (!G) { root.innerHTML = '<p class="hint" id="mapLoad">Загрузка карты…</p>'; await load(t => { const e = root.querySelector('#mapLoad'); if (e) e.textContent = t; }); if (!UI.active('map')) return; }
    const sv = Savegame.result;
    const xs = G.clusters.map(c => c.x), zs = G.clusters.map(c => -c.z);
    const minX = (Math.min(...xs) - R * 1.2) / U, maxX = (Math.max(...xs) + R * 1.2) / U, minY = (Math.min(...zs) - R * 1.2) / U, maxY = (Math.max(...zs) + R * 1.2) / U;
    if (!F.view) F.view = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    const owners = new Map();
    let cells = '';
    for (const c of G.clusters) {
      cells += `<polygon class="cl" points="${hex(c.x, -c.z, R)}"/>`;
      for (const s of c.sectors) {
        const own = sv && sv.sectors.get(s.macro);
        if (hidden(s.macro)) { cells += `<g class="sec fog"><polygon points="${hex(s.x, -s.z, s.r)}"/></g>`; continue; }
        let fill = 'var(--panel2)';
        if (F.color === 'owner' && own && own.owner) { fill = G.colors.get(own.owner) || '#777'; owners.set(own.owner, fill); }
        else if (F.color === 'sun') { const d = G.defaults.get(s.macro); const v = d && d.sunlight != null ? Math.min(1, d.sunlight / 1.5) : 0; fill = `hsl(45, 90%, ${12 + v * 50}%)`; }
        const mine = sv && sv.stations.some(x => (x.sector || '').toLowerCase() === s.macro);
        cells += `<g data-sec="${esc(s.macro)}" class="sec${F.sel === s.macro ? ' on' : ''}${own && !own.known ? ' unk' : ''}"><polygon points="${hex(s.x, -s.z, s.r)}" fill="${fill}"/>
          <text x="${(s.x / U).toFixed(1)}" y="${(-s.z / U).toFixed(1)}" font-size="${(s.r * 0.13 / U).toFixed(1)}">${esc(dname(s.macro))}</text>
          ${mine ? `<circle cx="${(s.x / U).toFixed(1)}" cy="${((-s.z + s.r * 0.45) / U).toFixed(1)}" r="${(s.r * 0.09 / U).toFixed(1)}" class="mine"/>` : ''}</g>`;
      }
    }
    const v = F.view;
    const legend = F.color === 'owner' ? (sv ? [...owners].sort((a, b) => Game.factionName(a[0]).localeCompare(Game.factionName(b[0]))).map(([o, c]) => `<span class="lg"><i style="background:${c}"></i>${esc(Game.factionName(o))}</span>`).join('') : '<span class="small">Владельцы секторов появятся после чтения сохранения (страница «Сохранение»).</span>')
      : '<span class="small">Ярче — больше солнца</span>';
    const sel = F.sel && !hidden(F.sel) && G.clusters.flatMap(c => c.sectors).find(s => s.macro === F.sel);
    const fogNote = !sv ? '<p class="small warn">Сохранение не прочитано: показана вся карта. Чтобы скрыть неизвестные секторы, прочитайте сохранение на странице «Сохранение».</p>'
      : `<p class="small">По сохранению: ${esc(Savegame.describe())}${F.fog ? '' : ' · <span class="warn">туман войны выключен</span>'}</p>`;
    root.innerHTML = `<div class="filters">
        <select id="mapColor"><option value="owner" ${F.color === 'owner' ? 'selected' : ''}>Цвет: владелец</option><option value="sun" ${F.color === 'sun' ? 'selected' : ''}>Цвет: солнце</option></select>
        <label class="inl"><input type="checkbox" id="mapFog" ${F.fog ? 'checked' : ''}> туман войны</label>
        <button data-mapreset>Вся карта</button><span class="small">Колесо — масштаб, перетаскивание — сдвиг, клик — сектор. Точка — ваша станция.</span></div>
      ${fogNote}<div class="legend">${legend}</div>
      <div class="mapwrap"><svg id="galaxy" viewBox="${v.x} ${v.y} ${v.w} ${v.h}" preserveAspectRatio="xMidYMid meet">${cells}</svg>
        <section class="mapinfo">${sel ? sectorInfo(sel) : '<p class="hint">Выберите сектор.</p>'}</section></div>`;
    bindPanZoom(root.querySelector('#galaxy'));
  }

  function bindPanZoom(svg) {
    let drag = null;
    const toView = (e) => { const r = svg.getBoundingClientRect(), v = F.view; const s = Math.max(v.w / r.width, v.h / r.height); return { s, r }; };
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const { s, r } = toView(e), v = F.view;
      const mx = v.x + (e.clientX - r.left - (r.width - v.w / s) / 2) * s, my = v.y + (e.clientY - r.top - (r.height - v.h / s) / 2) * s;
      const k = e.deltaY > 0 ? 1.2 : 1 / 1.2;
      F.view = { x: mx - (mx - v.x) * k, y: my - (my - v.y) * k, w: v.w * k, h: v.h * k };
      svg.setAttribute('viewBox', `${F.view.x} ${F.view.y} ${F.view.w} ${F.view.h}`);
    }, { passive: false });
    // a drag swallows the click that follows its release (it is not a sector pick); the flag is set only on the release
    // after a real drag and cleared on every press, so a drag that ends with no click does not eat the next real click
    svg.addEventListener('pointerdown', e => { delete svg.dataset.dragged; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, v: { ...F.view }, moved: false }; });
    svg.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const { s } = toView(e);
      const dx = (e.clientX - drag.x) * s, dy = (e.clientY - drag.y) * s;
      if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) {
        drag.moved = true;
        // captured only once it is a drag: the moves and the release outside the map still come here; a plain click
        // keeps its target (a captured pointer's click goes to the svg, not to the sector)
        try { svg.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone */ }
      }
      F.view = { ...drag.v, x: drag.v.x - dx, y: drag.v.y - dy };
      svg.setAttribute('viewBox', `${F.view.x} ${F.view.y} ${F.view.w} ${F.view.h}`);
    });
    svg.addEventListener('pointerup', e => { if (drag && e.pointerId === drag.id && drag.moved) svg.dataset.dragged = '1'; drag = null; });
    svg.addEventListener('pointercancel', () => { drag = null; });
  }

  function click(t, root) {
    const svg = root.querySelector('#galaxy');
    if (svg && svg.dataset.dragged) { delete svg.dataset.dragged; return true; }
    if (t.closest('[data-mapreset]')) { F.view = null; render(root); return true; }
    const sun = t.closest('[data-sun]');
    if (sun) { UI.setSunlight(Math.round(Number(sun.dataset.sun) * 100)); return true; }
    const s = t.closest('[data-sec]');
    if (s) { F.sel = s.dataset.sec; render(root); return true; }
    return false;
  }
  function change(t, root) {
    if (t.id === 'mapColor') { F.color = t.value; render(root); return true; }
    if (t.id === 'mapFog') { F.fog = t.checked; render(root); return true; }
    return false;
  }
  function input() { return false; }
  function reset() { G = null; loading = null; docCache.clear(); F.view = null; wild = null; }

  return { render, click, change, input, reset, F, get data() { return G; } };
})();
