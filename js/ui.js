/*
  X4 Builder Web - interface. The station planner part of the original (page_ComplexList, page_ComplexProperies,
  page_ModulesList, page_BuildCosts): complexes of stations, modules with counts, workforce, the ware balance per
  period, storage and build costs.
*/
'use strict';

const UI = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sign = v => (v > 0 ? '+' : '') + fmt(v);

  const CLASS_NAMES = {
    production: 'Производство', habitation: 'Жилой', storage: 'Склад', dockarea: 'Док', pier: 'Пирс',
    defencemodule: 'Оборона', welfaremodule: 'Благоустройство', processingmodule: 'Переработка', buildmodule: 'Верфь/док',
    radar: 'Радар',
  };
  const TRANSPORT = { container: 'Контейнеры', solid: 'Твёрдые', liquid: 'Жидкие', condensate: 'Конденсат' };
  const PERIODS = [[3600, 'час'], [600, '10 минут'], [86400, 'сутки']];

  const S = {
    settings: IO.loadSettings(),
    complexes: IO.loadComplexes().map(Planner.normComplex).filter(Boolean), // cleaned: an older import may have saved junk
    cur: null,       // complex id
    st: null,        // station id
    view: 'station', // station | total
    page: 'stations', // stations | one of PAGES
    filter: { q: '', cls: '', race: '', bp: false },
    loaded: false,
    gamePlans: [],
  };
  S.settings.period = S.settings.period || 3600;
  S.settings.price = S.settings.price || 'avg';
  S.settings.lang = S.settings.lang || '7';

  // pages other than the station planner: {render(root), click(t, root), change(t, root), input(t, root)}
  const PAGES = { wares: Wares, mods: Mods, terraform: Terraform, factions: Factions, diplomacy: Diplomacy, ships: Ships, military: Military, savegame: Savegame, map: GalaxyMap };
  const page = () => PAGES[S.page] || null;
  // is this page still the shown one (an async page render checks it after its await before writing #main)
  const active = name => S.page === name;
  const save = () => { IO.saveComplexes(S.complexes); IO.saveSettings(S.settings); };
  const cx = () => S.complexes.find(c => c.id === S.cur) || null;
  const station = () => { const c = cx(); return c ? (c.stations.find(s => s.id === S.st) || c.stations[0] || null) : null; };

  // ---------- loading ----------
  function status(t) { const e = $('#status'); if (e) e.textContent = t; }

  async function collectFromHandle(dir) {
    const out = [];
    const take = async (h, rel) => { const f = await h.getFile(); f.relPath = rel; out.push(f); };
    for await (const [name, h] of dir.entries()) {
      const n = name.toLowerCase();
      if (h.kind === 'file' && (/\.(cat|dat)$/.test(n) || n === 'version.dat')) await take(h, name);
      if (h.kind === 'directory' && n === 'extensions') {
        for await (const [en, eh] of h.entries()) {
          if (eh.kind !== 'directory') continue;
          for await (const [fn, fh] of eh.entries()) {
            const f = fn.toLowerCase();
            if (fh.kind === 'file' && (/\.(cat|dat)$/.test(f) || f === 'content.xml')) await take(fh, `extensions/${en}/${fn}`);
          }
        }
      }
    }
    return out;
  }

  // the chosen game folder is kept (a directory handle in IndexedDB, Chromium browsers): the next visit opens it
  // at once while the browser still grants the access, else with one click; Firefox has no such handles
  const DB = { name: 'x4builderweb', store: 'handles' };
  function idb(mode, fn) {
    return new Promise((res, rej) => {
      if (!window.indexedDB) { res(null); return; }
      const r = indexedDB.open(DB.name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(DB.store);
      r.onerror = () => res(null);
      r.onsuccess = () => {
        const tx = r.result.transaction(DB.store, mode);
        const q = fn(tx.objectStore(DB.store));
        tx.oncomplete = () => res(q && q.result !== undefined ? q.result : null);
        tx.onerror = () => res(null);
      };
    });
  }
  const saveHandle = h => idb('readwrite', st => st.put(h, 'game')).catch(() => null);
  const loadHandle = () => idb('readonly', st => st.get('game')).catch(() => null);

  async function openHandle(h, ask) {
    try {
      let p = await h.queryPermission({ mode: 'read' });
      if (p !== 'granted' && ask) p = await h.requestPermission({ mode: 'read' });
      if (p !== 'granted') return false;
      await startLoad(await collectFromHandle(h));
      return true;
    } catch (e) { status('Папка недоступна: ' + e.message + '. Выберите её заново.'); return false; }
  }

  async function pickFolder() {
    let list = null;
    if (window.showDirectoryPicker) {
      try {
        const h = await window.showDirectoryPicker({ id: 'x4game', mode: 'read' });
        await saveHandle(h);
        list = await collectFromHandle(h);
      } catch (e) { if (e.name === 'AbortError') return; list = null; }
    }
    if (!list) { $('#dirInput').click(); return; }
    await startLoad(list);
  }

  // on start: the kept folder, opened by itself or by one click
  async function resume() {
    if (!window.showDirectoryPicker) return;
    const h = await loadHandle();
    if (!h) return;
    $('#lastFolder').hidden = false;
    $('#lastFolderBtn').textContent = `Открыть папку «${h.name}»`;
    $('#lastFolderBtn').onclick = () => openHandle(h, true);
    status(`Открываю сохранённую папку «${h.name}»…`);
    if (!(await openHandle(h, false))) status(`Браузер просит подтвердить доступ к папке «${h.name}»: нажмите кнопку выше.`);
  }

  async function startLoad(list) {
    // also when the folder is changed from inside the app: the start screen shows the progress
    $('#app').hidden = true; $('#start').hidden = false;
    $('#start').classList.add('busy');
    try {
      if (!CatFS.setFiles(list)) { status('В выбранной папке нет архивов игры (01.cat). Выберите папку, где лежит X4.exe / X4 и файлы 01.cat ... 09.cat.'); return; }
      const enabled = S.settings.extensions ? new Set(S.settings.extensions) : null;
      await CatFS.mount(enabled, status);
      await Game.loadAll(S.settings.lang, status);
      for (const p of Object.values(PAGES)) if (p.reset) p.reset();
      S.gamePlans = await IO.gamePlans().catch(() => []);
      S.loaded = true;
      if (!S.complexes.length) { const c = Planner.newComplex('Мой комплекс'); S.complexes.push(c); }
      S.cur = S.cur || S.complexes[0].id;
      save();
      $('#start').hidden = true; $('#app').hidden = false;
      render();
    } catch (e) {
      console.error(e);
      status('Ошибка загрузки: ' + e.message);
    } finally { $('#start').classList.remove('busy'); }
  }

  // ---------- rendering ----------
  function render() {
    renderTop(); renderSide();
    $('#pages').hidden = false;
    for (const b of document.querySelectorAll('[data-page]')) b.classList.toggle('on', b.dataset.page === S.page);
    if (page()) page().render($('#main')); else renderMain();
  }
  function toast(t) {
    const e = $('#toast'); e.textContent = t; e.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { e.hidden = true; }, 2500);
  }

  function renderTop() {
    $('#period').innerHTML = PERIODS.map(([v, n]) => `<option value="${v}" ${v == S.settings.period ? 'selected' : ''}>в ${n}</option>`).join('');
    $('#priceMode').value = S.settings.price;
    $('#lang').value = S.settings.lang;
    $('#gameInfo').textContent = `модулей ${Game.D.modules.size}, товаров ${Game.D.wares.size}, расширений ${CatFS.extensions.filter(e => e.active).length}`;
  }

  function renderSide() {
    const list = S.complexes.map(c => `<li class="${c.id === S.cur ? 'on' : ''}" data-cx="${esc(c.id)}"><span>${esc(c.name)}</span><small>${c.stations.length} ст.</small></li>`).join('');
    $('#cxList').innerHTML = list || '<li class="empty">Нет комплексов</li>';
    const q = ($('#planQ').value || '').toLowerCase();
    $('#plans').innerHTML = S.gamePlans.filter(p => !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)).slice(0, 200)
      .map(p => `<li data-plan="${esc(p.id)}" title="${esc(p.id)}">${esc(Game.text(p.name) || p.id)}<small>${p.modules.reduce((s, m) => s + m.count, 0)} мод.</small></li>`).join('') || '<li class="empty">—</li>';
  }

  function price(p) { return p ? p[S.settings.price] || 0 : 0; }

  function renderMain() {
    const c = cx();
    if (!c) { $('#main').innerHTML = '<p class="hint">Создайте комплекс слева.</p>'; return; }
    if (!c.stations.length) c.stations.push(Planner.newStation('Станция 1'));
    if (!c.stations.find(s => s.id === S.st)) S.st = c.stations[0].id;
    const tabs = c.stations.map(s => `<button class="tab ${S.view === 'station' && s.id === S.st ? 'on' : ''}" data-st="${esc(s.id)}">${esc(s.name)}</button>`).join('');
    $('#main').innerHTML = `
      <div class="cxhead">
        <input id="cxName" value="${esc(c.name)}" aria-label="Название комплекса">
        <div class="tabs">${tabs}<button class="tab add" data-act="addStation" title="Добавить станцию">+</button>
          <button class="tab ${S.view === 'total' ? 'on' : ''}" data-act="total">Итог комплекса</button></div>
      </div>
      <div id="body"></div>`;
    if (S.view === 'total') renderTotal(c); else renderStation(c, station());
  }

  function moduleRow(sm, i) {
    const m = Game.D.modules.get(sm.macro);
    if (!m) return `<tr class="missing"><td colspan="6">Нет в данных игры: ${esc(sm.macro)}</td><td><button data-rm="${i}">×</button></td></tr>`;
    let info = '';
    if (m.isProduction) info = m.queue.map(q => Game.wareName(q.ware)).join(', ') + (m.workforceMax ? ` · рабочих ${m.workforceMax}` : '');
    else if (m.class === 'habitation') info = `${Game.raceName(m.habRace)} · мест ${fmt(m.habCapacity)}`;
    else if (m.cargoMax) info = `${(m.cargoTags || '').split(' ').map(t => TRANSPORT[t] || t).join(', ')} · ${fmt(m.cargoMax)} м³`;
    // who sells the blueprint (the module ware's owners)
    if (m.owners && m.owners.length) info += (info ? ' · ' : '') + 'чертёж: ' + m.owners.map(o => { const f = Game.D.factions.get(o); return f && f.short ? Game.text(f.short) : Game.factionName(o); }).join(', ');
    const pi = partsText(m.parts);
    if (pi && !m.isProduction && m.class !== 'habitation' && m.class !== 'storage') info = pi;
    return `<tr class="${sm.enabled ? '' : 'off'}">
      <td><input type="checkbox" data-en="${i}" ${sm.enabled ? 'checked' : ''} title="Учитывать модуль"></td>
      <td class="nm" title="${esc(m.macro)}">${esc(Game.text(m.name) || m.macro)}${m.ext ? ` <span class="tag">${esc(m.ext.replace('ego_dlc_', ''))}</span>` : ''}</td>
      <td>${esc(CLASS_NAMES[m.class] || m.class)}</td>
      <td>${esc(Game.raceName(m.makerrace))}</td>
      <td class="cnt"><button data-dec="${i}">−</button><input type="number" min="0" value="${esc(sm.count)}" data-cnt="${i}"><button data-inc="${i}">+</button></td>
      <td class="info">${esc(info)}</td>
      <td><button data-rm="${i}" title="Убрать">×</button></td></tr>`;
  }

  // turrets / shields / docks as short text: "турели L×2 M×4 · щиты M×2 · стыковка S×4 M×2"
  const SZ = { extralarge: 'XL', large: 'L', medium: 'M', small: 'S', dock_xl: 'XL', dock_l: 'L', dock_m: 'M', dock_s: 'S' };
  const ORDER = ['extralarge', 'large', 'medium', 'small', 'dock_xl', 'dock_l', 'dock_m', 'dock_s'];
  const sizes = o => ORDER.filter(k => o && o[k]).map(k => `${SZ[k]}×${fmt(o[k])}`).join(' ');
  function partsText(p) {
    if (!p) return '';
    const a = [];
    if (sizes(p.turret)) a.push('турели ' + sizes(p.turret));
    if (sizes(p.shield)) a.push('щиты ' + sizes(p.shield));
    if (sizes(p.docks)) a.push('посадка ' + sizes(p.docks));
    const inner = Object.keys(p.dockCapacity || {}).filter(k => (p.dockCapacity[k] || 0) > (p.docks[k] || 0));
    if (inner.length) a.push('ангар ' + inner.map(k => `${SZ[k]}×${fmt(p.dockCapacity[k])}`).join(' '));
    if (p.drones) a.push('дронов ' + fmt(p.drones));
    return a.join(' · ');
  }
  function partsTable(p) {
    const rows = [];
    const row = (name, o) => { const t = sizes(o); if (t) rows.push(`<tr><td>${name}</td><td>${t}</td></tr>`); };
    row('Турели', p.turret); row('Щиты', p.shield); row('Посадочные места', p.docks);
    const cap = {}; for (const k of Object.keys(p.dockCapacity)) cap[k] = p.dockCapacity[k];
    row('Вместимость доков (с ангарами)', cap);
    if (p.drones) rows.push(`<tr><td>Дроны</td><td>${fmt(p.drones)}</td></tr>`);
    return rows.length ? `<h3>Оборона и доки</h3><table class="grid"><tbody>${rows.join('')}</tbody></table>` : '';
  }

  function balanceTable(balance) {
    const rows = [...balance.values()].sort((a, b) => (a.net >= 0) - (b.net >= 0) || Game.wareName(a.id).localeCompare(Game.wareName(b.id)));
    if (!rows.length) return '<p class="hint">Нет производства.</p>';
    let tv = 0;
    const body = rows.map(b => {
      const v = b.net * price(b.price); tv += v;
      return `<tr><td class="nm">${esc(Game.wareName(b.id))}</td><td>${fmt(b.produced)}</td><td>${fmt(b.consumed)}${b.food ? ` <small title="из них еда и медикаменты рабочих">(${fmt(b.food)})</small>` : ''}${b.build ? ` <small title="из них на постройку кораблей">[${fmt(b.build)}]</small>` : ''}</td>
        <td class="${b.net < 0 ? 'neg' : b.net > 0 ? 'pos' : ''}">${sign(b.net)}</td><td class="${v < 0 ? 'neg' : ''}">${fmt(v)}</td></tr>`;
    }).join('');
    return `<table class="grid bal"><thead><tr><th>Товар</th><th>Производство</th><th>Потребление</th><th>Баланс</th><th>Кр</th></tr></thead>
      <tbody>${body}</tbody><tfoot><tr><td>Итого</td><td></td><td></td><td></td><td class="${tv < 0 ? 'neg' : 'pos'}">${fmt(tv)}</td></tr></tfoot></table>`;
  }

  function costTable(buildcost, buildvalue, modPrice, time) {
    const rows = [...buildcost].sort((a, b) => Game.wareName(a[0]).localeCompare(Game.wareName(b[0])))
      .map(([id, a]) => { const w = Game.D.wares.get(id); return `<tr><td class="nm">${esc(Game.wareName(id))}</td><td>${fmt(a)}</td><td>${fmt(a * price(w && w.price))}</td></tr>`; }).join('');
    return `<table class="grid"><thead><tr><th>Ресурс</th><th>Кол-во</th><th>Кр</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td>Ресурсы для постройки</td><td></td><td>${fmt(buildvalue[S.settings.price])}</td></tr>
      <tr><td>Цена модулей (покупка у верфи)</td><td></td><td>${fmt(modPrice[S.settings.price])}</td></tr>
      ${time != null ? `<tr><td>Время постройки (сумма)</td><td colspan="2">${fmtTime(time)}</td></tr>` : ''}</tfoot></table>`;
  }
  function fmtTime(s) { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return (h ? h + ' ч ' : '') + m + ' мин'; }

  function renderStation(c, st) {
    // the ship building demand first: the balance below includes it
    if (st.shipOrders && st.shipOrders.length && Ships.api.loaded && Military.api.items().length) ShipBuild.compute(st);
    // the station's turrets and shields (their cost goes to the build cost)
    if (st.loadout && st.loadout.mode !== 'none') {
      if (StationLoadout.ready()) StationLoadout.compute(st);
      else StationLoadout.ensure(() => { if (S.page === 'stations' && station() === st) { save(); renderMain(); } });
    } else st.loadoutCalc = null;
    const r = Planner.calcStation(st, S.settings.period);
    const pname = PERIODS.find(p => p[0] == S.settings.period)[1];
    const rows = st.modules.map(moduleRow).join('');
    const wfRaces = r.races.map(x => `${esc(Game.raceName(x.race))}: ${fmt(r.spread[x.race] || 0)} / ${fmt(x.capacity)}`).join(', ');
    const demand = Expand.storageDemand(Planner.calcStation(st, 3600), Expand.storeHours(st));
    const storage = Object.keys(TRANSPORT).filter(t => r.storage.get(t) || demand.get(t)).map(t => {
      const cap = r.storage.get(t) || 0, need = demand.get(t) || 0;
      return `<tr><td>${TRANSPORT[t]}</td><td>${fmt(cap)}</td><td>${fmt(need)}</td><td class="${cap < need ? 'neg' : 'pos'}">${need ? fmt(cap / need * 100) + '%' : '—'}</td></tr>`;
    }).join('');
    $('#body').innerHTML = `
      <div class="cols">
        <section class="modules">
          <div class="sthead">
            <input id="stName" value="${esc(st.name)}" aria-label="Название станции">
            <button data-act="dupStation">Копия</button><button data-act="delStation" class="danger">Удалить станцию</button>
            <button data-act="exportPlan" title="Файл плана для игры (в папку профиля constructionplan); модули расставлены сеткой, соединить их — в редакторе станции">План для игры</button>
            ${window.showDirectoryPicker ? '<button data-act="exportPlanTo" title="Выбрать другую папку для планов">…</button>' : ''}
            <button data-act="layout" title="Авторасстановка модулей: компактно, доки снаружи; предпросмотр">Раскладка</button>
            <label class="inl small" title="Соединить модули в плане для игры (иначе — сеткой, без соединений)"><input type="checkbox" id="layOn" ${st.layoutOn !== false ? 'checked' : ''}> соединить модули</label>
            <button data-act="expand" title="Добавить жильё, производство недостающих товаров и склады">Автодостройка</button>
          </div>
          <div class="sthead small"><label class="inl" title="${st.base ? `Модули и соединители чертежа «${esc(st.base.name)}» (${st.base.entries.length} записей) остаются на месте, новые пристыкуются к ним` : 'Взять чертёж этой станции из папки планов игры (иначе выбрать файл) и достраивать его, не меняя построенное'}"><input type="checkbox" id="stExtend" ${st.base && st.layoutMode !== 'scratch' ? 'checked' : ''}> достройка${st.base ? ` чертежа «${esc(st.base.name)}» (${st.base.entries.length} записей на месте)` : ' (без отметки — раскладка с нуля)'}</label>${st.base || !window.showDirectoryPicker ? '' : ' <button data-act="baseGrant" class="small" title="Браузер спросит разрешение на папку планов игры (или попросит выбрать её: …/X4/&lt;id&gt;/constructionplan) и возьмёт оттуда чертёж этой станции">разрешить доступ к папке планов</button>'}</div>
          ${StationLoadout.html(st, loadoutRaces())}
          <table class="grid mods"><thead><tr><th></th><th>Модуль</th><th>Тип</th><th>Раса</th><th>Кол-во</th><th>Сведения</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" class="hint">Добавьте модули из списка ниже.</td></tr>'}</tbody></table>
          ${r.missing.length ? `<p class="warn">Модулей нет в данных игры: ${r.missing.length} (расширение выключено?)</p>` : ''}
          <div id="shipbuild" class="picker"></div>
          <div class="picker">
            <div class="filters">
              <input id="fq" placeholder="Поиск модуля или товара" value="${esc(S.filter.q)}">
              <select id="fcls"><option value="">Все типы</option>${Object.entries(CLASS_NAMES).map(([k, v]) => `<option value="${k}" ${S.filter.cls === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
              <select id="frace"><option value="">Все расы</option>${raceOptions()}</select>
            </div>
            <ul id="pick" class="pick"></ul>
          </div>
        </section>
        <section class="results">
          <h3>Рабочие</h3>
          <div class="wf">
            <label>Нужно <b>${fmt(r.need)}</b></label><label>Мест <b>${fmt(r.capacity)}</b></label>
            <label>Рабочих <input type="number" id="workers" min="0" value="${st.workers == null ? '' : esc(st.workers)}" placeholder="${fmt(r.workers)}" title="Пусто: столько, сколько нужно, но не больше мест"></label>
            <label>Бонус <b>${fmt(r.effect * 100, 1)}%</b></label>
            <label>Солнце, % <input type="number" id="sunlight" min="0" max="1000" value="${esc(st.sunlight)}"></label>
            <label>Корпус, % <input type="number" id="hull" min="0" max="100" value="${esc(st.hull)}"></label>
          </div>
          ${wfRaces ? `<p class="small">${wfRaces}</p>` : ''}
          ${r.need > r.capacity ? `<p class="warn">Жилья не хватает: мест ${fmt(r.capacity)} при потребности ${fmt(r.need)}.</p>` : ''}
          <h3>Баланс товаров в ${pname}</h3>
          ${balanceTable(r.balance)}
          <div id="logistics"></div>
          ${storage ? `<h3>Склады</h3><table class="grid"><thead><tr><th>Тип</th><th>Объём, м³</th><th title="Час валового производства (или потребления) товаров этого типа">Нужно на час, м³</th><th>Покрытие</th></tr></thead><tbody>${storage}</tbody></table>` : ''}
          ${partsTable(r.parts)}
          <h3>Стоимость постройки</h3>
          ${costTable(r.buildcost, r.buildvalue, r.price, r.buildtime)}
        </section>
      </div>`;
    ShipBuild.render(st, $('#shipbuild'), () => { if (S.page === 'stations' && S.view === 'station' && station() === st) { save(); renderMain(); } });
    Logistics.render(st, $('#logistics'), () => { if (S.page === 'stations' && S.view === 'station' && station() === st) { save(); renderMain(); } });
    renderPick();
  }

  // races that make station turrets / shields (when the weapon data is loaded), else the main ones
  function loadoutRaces() {
    if (StationLoadout.ready()) {
      const s = new Set(Military.api.items().filter(w => w.kind === 'turret' && w.ware && w.race && !['xenon', 'khaak'].includes(w.race)).map(w => w.race));
      return [...s].sort((a, b) => Game.raceName(a).localeCompare(Game.raceName(b)));
    }
    return ['argon', 'paranid', 'teladi', 'split', 'terran', 'boron'];
  }
  function raceOptions() {
    const races = new Set();
    for (const m of Game.D.modules.values()) if (m.makerrace) races.add(m.makerrace);
    return [...races].sort((a, b) => Game.raceName(a).localeCompare(Game.raceName(b))).map(r => `<option value="${r}" ${S.filter.race === r ? 'selected' : ''}>${esc(Game.raceName(r))}</option>`).join('');
  }

  // the module list reaches down to the bottom of the window (at least 260 px), whatever is above it
  function fitPick() {
    const el = $('#pick');
    if (!el || el.dataset.userSized) return;
    const top = el.getBoundingClientRect().top + ($('#main').scrollTop || 0) - ($('#main').getBoundingClientRect().top || 0);
    const avail = $('#main').clientHeight - top - 28;
    el.style.height = Math.max(260, avail) + 'px';
  }
  function renderPick() {
    const q = S.filter.q.toLowerCase();
    const out = [];
    for (const m of Game.D.modules.values()) {
      if (S.filter.cls && m.class !== S.filter.cls) continue;
      if (S.filter.race && m.makerrace !== S.filter.race) continue;
      const name = Game.text(m.name) || m.macro;
      if (q) {
        const wares = m.queue.map(x => Game.wareName(x.ware)).join(' ');
        if (!(name.toLowerCase().includes(q) || m.macro.includes(q) || wares.toLowerCase().includes(q))) continue;
      }
      out.push([name, m]);
    }
    out.sort((a, b) => a[0].localeCompare(b[0]));
    $('#pick').innerHTML = out.slice(0, 300).map(([name, m]) => `<li data-add="${esc(m.macro)}" title="${esc(m.macro)}">
      <span>${esc(name)}</span><small>${esc(CLASS_NAMES[m.class] || m.class)} · ${esc(Game.raceName(m.makerrace))}${m.ext ? ' · ' + esc(m.ext.replace('ego_dlc_', '')) : ''}</small></li>`).join('')
      + (out.length > 300 ? `<li class="empty">… ещё ${out.length - 300}, уточните поиск</li>` : '') || '<li class="empty">Ничего не найдено</li>';
    fitPick();
  }

  function renderTotal(c) {
    // the build cost as costTable: the resources and the yard price are two estimates of the same thing (the turrets and
    // shields are in both), so two columns, not their sum
    const res = Planner.calcComplex(c, S.settings.period);
    const pname = PERIODS.find(p => p[0] == S.settings.period)[1];
    const sts = c.stations.map((s, i) => { const r = res.stations[i]; return `<tr><td class="nm">${esc(s.name)}</td><td>${s.modules.reduce((a, m) => a + (m.count || 0), 0)}</td>
      <td>${fmt(r.workers)} / ${fmt(r.need)}</td><td>${fmt(r.effect * 100, 1)}%</td><td class="${r.value[S.settings.price] < 0 ? 'neg' : 'pos'}">${fmt(r.value[S.settings.price])}</td><td>${fmt(r.buildvalue[S.settings.price])}</td><td>${fmt(r.price[S.settings.price])}</td></tr>`; }).join('');
    $('#body').innerHTML = `<div class="cols"><section>
      <h3>Станции</h3><table class="grid"><thead><tr><th>Станция</th><th>Модулей</th><th>Рабочие</th><th>Бонус</th><th>Кр в ${pname}</th><th>Ресурсы для постройки, Кр</th><th>Модули у верфи, Кр</th></tr></thead><tbody>${sts}</tbody></table>
      <h3>Стоимость постройки комплекса</h3>${costTable(res.total.buildcost, res.total.buildvalue, res.total.price, null)}
      </section><section class="results"><h3>Общий баланс в ${pname}</h3>${balanceTable(res.total.balance)}</section></div>`;
  }

  // ---------- events ----------
  function changed() { save(); renderSide(); if (page()) page().render($('#main')); else renderMain(); }

  function onClick(e) {
    const pg = e.target.closest('[data-page]');
    if (pg && S.loaded) { S.page = pg.dataset.page; render(); return; }
    const af = e.target.closest('[data-addfac]');
    if (af) {
      const c = cx(), st = station();
      if (!c || !st) { toast('Сначала создайте комплекс'); return; }
      Planner.addModule(st, af.dataset.addfac); save();
      toast(`${Game.moduleName(af.dataset.addfac)} → ${c.name} / ${st.name}`);
      return;
    }
    // a ware link from another page opens it on the wares page
    const gw = e.target.closest('[data-goware]');
    if (gw) { e.preventDefault(); Wares.F.sel = gw.dataset.goware; Wares.F.kind = 'all'; Wares.F.group = ''; Wares.F.transport = ''; Wares.F.q = ''; S.page = 'wares'; render(); return; }
    if (page() && e.target.closest('#main')) {
      if (e.target.closest('a[href="#"]')) e.preventDefault();
      if (page().click(e.target, $('#main'))) return;
    }
    if (!page() && e.target.closest('#logistics')) {
      const st0 = station();
      if (st0 && Logistics.click(e.target, st0)) { changed(); return; }
    }
    if (!page() && e.target.closest('#shipbuild')) {
      const st0 = station();
      if (st0 && ShipBuild.click(e.target, st0)) {
        changed();
        // "everything for the building": the yard modules are in, now the expanding with its preview
        if (e.target.closest('[data-sball]')) { const s1 = station(); showExpand(s1); calcExpand(); }
        return;
      }
    }
    if (page() && e.target.closest('[data-cx]')) { S.cur = e.target.closest('[data-cx]').dataset.cx; S.st = null; save(); renderSide(); toast('Модули будут добавляться в «' + cx().name + '»'); return; }
    const t = e.target.closest('[data-cx],[data-st],[data-act],[data-add],[data-rm],[data-inc],[data-dec],[data-plan]');
    if (!t) return;
    const c = cx(), st = station();
    if (t.dataset.cx) { S.cur = t.dataset.cx; S.view = 'station'; S.st = null; changed(); return; }
    if (t.dataset.st) { S.st = t.dataset.st; S.view = 'station'; renderMain(); return; }
    if (t.dataset.add && st) { Planner.addModule(st, t.dataset.add); changed(); return; }
    if (t.dataset.rm != null && st) { st.modules.splice(+t.dataset.rm, 1); changed(); return; }
    if (t.dataset.inc != null && st) { st.modules[+t.dataset.inc].count++; changed(); return; }
    if (t.dataset.dec != null && st) { const m = st.modules[+t.dataset.dec]; m.count = Math.max(0, m.count - 1); changed(); return; }
    if (t.dataset.plan) {
      const p = S.gamePlans.find(x => x.id === t.dataset.plan);
      if (p && c) { const s = Planner.newStation(Game.text(p.name) || p.id); for (const m of p.modules) Planner.addModule(s, m.macro, m.count); c.stations.push(s); S.st = s.id; S.view = 'station'; S.page = 'stations'; render(); save(); }
      return;
    }
    switch (t.dataset.act) {
      case 'newCx': { const n = Planner.newComplex('Комплекс ' + (S.complexes.length + 1)); S.complexes.push(n); S.cur = n.id; S.view = 'station'; changed(); break; }
      case 'delCx': if (c && confirm(`Удалить комплекс «${c.name}»?`)) { S.complexes = S.complexes.filter(x => x !== c); S.cur = S.complexes[0] ? S.complexes[0].id : null; changed(); } break;
      case 'dupCx': if (c) { const n = JSON.parse(JSON.stringify(c)); n.id = Planner.uid(); n.name += ' (копия)'; n.stations.forEach(s => (s.id = Planner.uid())); S.complexes.push(n); S.cur = n.id; changed(); } break;
      case 'exportCx': if (c) IO.download(`${c.name}.x4builder.json`, JSON.stringify({ format: 'x4builderweb', version: 1, complexes: [c] }, null, 1)); break;
      case 'exportAll': IO.download('x4builder-complexes.json', JSON.stringify({ format: 'x4builderweb', version: 1, complexes: S.complexes }, null, 1)); break;
      case 'importCx': importCx(); break;
      case 'importPlans': importPlans(); break;
      case 'addStation': if (c) { const s = Planner.newStation('Станция ' + (c.stations.length + 1)); c.stations.push(s); S.st = s.id; S.view = 'station'; changed(); } break;
      case 'dupStation': if (c && st) { const s = JSON.parse(JSON.stringify(st)); s.id = Planner.uid(); s.name += ' (копия)'; c.stations.push(s); S.st = s.id; changed(); } break;
      case 'delStation': if (c && st && confirm(`Удалить станцию «${st.name}»?`)) { c.stations = c.stations.filter(x => x !== st); S.st = null; changed(); } break;
      case 'total': S.view = 'total'; renderMain(); break;
      case 'exportPlan':
      case 'exportPlanTo':
        if (st) savePlanUI(st, t.dataset.act === 'exportPlanTo');
        break;
      case 'layout': if (st) showLayout(st); break;
      case 'baseLoad': if (st) loadBase(st, false, !!st.base); break;
      case 'baseGrant': if (st) IO.grantPlans().then(ok => { if (ok) loadBase(st, false); else toast('Доступ к папке планов не дан.'); }); break;
      case 'planDir': $('#planDirInput').click(); break;
      case 'baseOpen': if (st) loadBase(st, false, true); else alert('Сначала откройте станцию, к которой относится чертёж'); break;
      case 'baseOff': if (st && confirm('Забыть чертёж-основу? Раскладка будет с нуля.')) { delete st.base; delete st.layoutMode; changed(); } break;
      case 'extensions': showExtensions(); break;
      case 'expand': if (st) showExpand(st); break;
      case 'reload': pickFolder(); break;
    }
  }

  function onInput(e) {
    const t = e.target, c = cx(), st = station();
    if (page() && page().input(t, $('#main'))) return;
    if (!page() && ShipBuild.input(t)) { const pos = t.selectionStart; renderMain(); const n = $('#sbq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
    if (t.id === 'fq') { S.filter.q = t.value; renderPick(); return; }
    if (t.id === 'planQ') { renderSide(); return; }
  }

  function onChange(e) {
    const t = e.target, c = cx(), st = station();
    if (page() && page().change(t, $('#main'))) return;
    if (!page() && t.closest && t.closest('#shipbuild') && st && ShipBuild.change(t, st)) { changed(); return; }
    if (!page() && t.closest && t.closest('#logistics') && st && Logistics.change(t, st)) { changed(); return; }
    if (t.id === 'cxName' && c) { c.name = t.value || 'Комплекс'; save(); renderSide(); return; }
    if (t.id === 'stName' && st) { st.name = t.value || 'Станция'; changed(); return; }
    if (t.id === 'stExtend' && st) {
      if (t.checked && !st.base) { t.checked = false; loadBase(st, false); return; }
      st.layoutMode = t.checked ? 'extend' : 'scratch'; changed(); return;
    }
    if (t.id === 'fcls') { S.filter.cls = t.value; renderPick(); return; }
    if (t.id === 'frace') { S.filter.race = t.value; renderPick(); return; }
    if (t.dataset.en != null && st) { st.modules[+t.dataset.en].enabled = t.checked; changed(); return; }
    if (t.dataset.cnt != null && st) { st.modules[+t.dataset.cnt].count = Math.max(0, parseInt(t.value, 10) || 0); changed(); return; }
    if (t.id === 'layOn' && st) { st.layoutOn = t.checked; save(); return; }
    if ((t.id === 'ldMode' || t.id === 'ldRace' || t.id === 'ldMissile') && st) {
      st.loadout = Object.assign({ mode: 'none', race: 'argon' }, st.loadout || {});
      if (t.id === 'ldMode') st.loadout.mode = t.value; else if (t.id === 'ldMissile') st.loadout.missile = t.checked; else st.loadout.race = t.value;
      changed(); return;
    }
    if ((t.id === 'ldMisRate' || t.id === 'ldDroneRate') && st) {
      st.loadout = Object.assign({ mode: 'none', race: 'argon' }, st.loadout || {});
      const v = Math.max(0, parseInt(t.value, 10) || 0);
      if (t.id === 'ldMisRate') st.loadout.misRate = v; else st.loadout.droneRate = v;
      changed(); return;
    }
    if (t.id === 'workers' && st) { st.workers = t.value === '' ? null : Math.max(0, parseInt(t.value, 10) || 0); changed(); return; }
    if (t.id === 'sunlight' && st) { st.sunlight = Math.max(0, parseFloat(t.value) || 0); changed(); return; }
    if (t.id === 'hull' && st) { st.hull = Math.min(100, Math.max(0, parseFloat(t.value) || 0)); changed(); return; }
    if (t.id === 'period') { S.settings.period = +t.value; changed(); return; }
    if (t.id === 'priceMode') { S.settings.price = t.value; changed(); return; }
    if (t.id === 'lang') { S.settings.lang = t.value; save(); Game.loadTexts(t.value, status).then(render); return; }
  }

  async function importCx() {
    const f = await IO.pickFile('.json,application/json');
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = Array.isArray(data) ? data : data.complexes || [data];
      let n = 0;
      for (const c0 of list) {
        // only the known fields, of the right types: the file's values go into the page and the calculation
        const c = Planner.normComplex(c0);
        if (!c) continue;
        c.id = Planner.uid(); c.stations.forEach(s => (s.id = Planner.uid()));
        S.complexes.push(c); S.cur = c.id; n++;
      }
      changed(); alert(`Загружено комплексов: ${n}`);
    } catch (e) { alert('Не удалось прочитать файл: ' + e.message); }
  }

  async function importPlans() {
    const f = await IO.pickFile('.xml,application/xml,text/xml');
    if (!f) return;
    try {
      const plans = IO.parsePlans(await f.text());
      if (!plans.length) { alert('В файле нет планов'); return; }
      const c = Planner.newComplex(f.name.replace(/\.xml$/i, ''));
      // the plan's entries are kept as the base: the layout can then change the plan instead of building from scratch
      c.stations = plans.map(p => { const s = Planner.newStation(p.name); for (const m of p.modules) Planner.addModule(s, m.macro, m.count);
        if (p.base && p.base.length) { s.base = { name: p.name, entries: p.base }; s.layoutMode = 'extend'; } return s; });
      S.complexes.push(c); S.cur = c.id; S.view = 'station'; S.st = null; changed();
    } catch (e) { alert('Не удалось прочитать план: ' + e.message); }
  }

  function showExtensions() {
    const d = $('#extDlg');
    d.querySelector('ul').innerHTML = CatFS.extensions.map(e => `<li><label><input type="checkbox" value="${esc(e.id)}" ${e.active ? 'checked' : ''} ${e.hasData ? '' : 'disabled'}>
      ${esc(e.name)} <small>${esc(e.id)}${e.version ? ' · ' + esc(e.version) : ''}${e.hasData ? '' : ' · нет данных'}</small></label></li>`).join('');
    d.showModal();
  }

  async function applyExtensions() {
    const ids = [...$('#extDlg').querySelectorAll('input:checked')].map(i => i.value);
    S.settings.extensions = ids; save();
    $('#extDlg').close();
    $('#app').hidden = true; $('#start').hidden = false;
    $('#start').classList.add('busy');
    try {
      await CatFS.mount(new Set(ids), status);
      await Game.loadAll(S.settings.lang, status);
      for (const p of Object.values(PAGES)) if (p.reset) p.reset();
      S.gamePlans = await IO.gamePlans().catch(() => []);
      $('#start').hidden = true; $('#app').hidden = false; render();
    } catch (e) { status('Ошибка загрузки: ' + e.message); }
    finally { $('#start').classList.remove('busy'); }
  }

  // ---------- plan and layout ----------
  // the modules of the base plan the station has fewer of (they stay anyway: the plan is not changed)
  function baseMissing(st) {
    const need = new Map();
    for (const e of st.base.entries) if (!/^struct_/.test(e.macro)) need.set(e.macro, (need.get(e.macro) || 0) + 1);
    const out = [];
    for (const [m, n] of need) { const have = st.modules.filter(x => x.macro === m && x.enabled).reduce((t, x) => t + x.count, 0); if (have < n) out.push(m); }
    return out;
  }
  // a game plan (XML) as the base of the station: its entries stay, the station gets at least its modules
  // own: the station's plan file in the plans folder first (the plan the station was saved as); else / pick: a file
  async function loadBase(st, preview = true, pick = false) {
    let text = null;
    if (!pick) {
      const own = await IO.readOwnPlan(st);
      if (own.text != null) text = own.text;
      else { toast(`Не удалось прочитать «${own.name}» из папки планов: ${own.error}. Откройте чертёж кнопкой «Чертёж для достройки (XML)» или сохраните план — сохранённый план станет основой.`); renderMain(); return; }
    }
    if (text == null) {
      const f = await IO.pickFile('.xml,application/xml,text/xml');
      if (!f) return;
      text = await f.text();
    }
    try {
      const plans = IO.parsePlans(text).filter(p => p.base && p.base.length);
      if (!plans.length) { alert('В файле нет планов с модулями'); return; }
      const p = plans.find(x => x.name === st.name) || plans[0];
      st.base = { name: p.name, entries: p.base }; st.layoutMode = 'extend';
      for (const m of p.modules) {
        const have = st.modules.filter(x => x.macro === m.macro && x.enabled).reduce((t, x) => t + x.count, 0);
        if (have < m.count) Planner.addModule(st, m.macro, m.count - have);
      }
      save(); renderMain(); if (preview) showLayout(st); else toast(`Чертёж «${p.name}» взят основой: ${p.base.length} записей останутся на месте.`);
    } catch (e) { alert('Не удалось прочитать план: ' + e.message); }
  }
  function savePlanUI(st, change) {
    toast('Расстановка модулей…');
    IO.savePlan(st, change, t => toast(t)).then(r => {
      if (!r) return;
      save(); renderMain(); // the saved plan is the station's base now (io.savePlan)
      const L = r.L, extra = L ? ` Соединено модулей: ${L.entries.length - L.connectors}${L.connectors ? `, добавлено соединителей: ${L.connectors}` : ''}${L.unplaced.length ? `, не встали: ${L.unplaced.length}` : ''}.` : '';
      toast((r.where === 'folder' ? `План «${r.name}» сохранён в папку «${r.folder}».` : `План «${r.name}» скачан: положите его в папку профиля игры constructionplan.`) + extra + ' В игре: редактор станции → загрузить план.');
    });
  }
  // the layout preview: boxes from above (x, z) and from the side (x, y); docks and connectors in their colours
  async function showLayout(st) {
    const d = $('#layDlg');
    $('#layBody').innerHTML = '<p class="hint">Расстановка…</p>';
    d.showModal();
    if (st.loadout && st.loadout.mode !== 'none' && StationLoadout.ready()) StationLoadout.compute(st);
    const L = await Layout.make(st, t => { $('#layBody').innerHTML = `<p class="hint">${esc(t)}</p>`; });
    const view = (ax, ay, title) => {
      const xs = L.entries.flatMap(e => [e.box.lo[ax], e.box.hi[ax]]), ys = L.entries.flatMap(e => [e.box.lo[ay], e.box.hi[ay]]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), pad = 200;
      const rects = L.entries.map(e => {
        const m = Game.D.modules.get(e.macro), cls = e.connector ? 'c' : m && (m.class === 'dockarea' || m.class === 'pier') ? 'd' : m && m.class === 'habitation' ? 'h' : m && m.class === 'storage' ? 's' : 'p';
        const y = ay === 2 ? -e.box.hi[ay] : -e.box.hi[ay];
        return `<rect class="${cls}" x="${e.box.lo[ax]}" y="${y}" width="${e.box.hi[ax] - e.box.lo[ax]}" height="${e.box.hi[ay] - e.box.lo[ay]}"><title>${esc(Game.moduleName(e.macro))}</title></rect>`;
      }).join('');
      return `<figure><figcaption>${title}</figcaption><svg class="lay" viewBox="${x0 - pad} ${-y1 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}">${rects}</svg></figure>`;
    };
    const km = v => fmt(v / 1000, 1);
    const ci = L.connectorMacro ? Layout.connectorInfo(L.connectorMacro) : null;
    const auto = Layout.stationRace(st);
    const nb = st.base ? st.base.entries.filter(e => !/^struct_/.test(e.macro)).length : 0;
    const modeSel = `<fieldset><legend>Чертёж</legend>${st.base ? `
        <label class="inl"><input type="radio" name="layMode" value="extend" ${st.layoutMode !== 'scratch' ? 'checked' : ''}> изменить чертёж «${esc(st.base.name)}» (достройка: его ${nb} модулей и соединители остаются на месте, новые пристыковываются к ним)</label><br>
        <label class="inl"><input type="radio" name="layMode" value="scratch" ${st.layoutMode === 'scratch' ? 'checked' : ''}> строить с нуля</label>
        <button id="layBaseOff" class="small">забыть чертёж</button>` : '<span class="small">станция раскладывается с нуля</span>'}
        <button id="layBaseLoad" class="small">${st.base ? 'другой чертёж…' : 'достроить существующий чертёж…'}</button></fieldset>`;
    const raceSel = `<label class="inl">соединители: <select id="layConnRace"><option value="">авто (${esc(Game.raceName(auto))})</option>${Object.keys(Layout.crosses()).sort((a, b) => Game.raceName(a).localeCompare(Game.raceName(b)))
      .map(r => `<option value="${r}" ${st.connRace === r ? 'selected' : ''}>${esc(Game.raceName(r))}</option>`).join('')}</select></label>`;
    $('#layBody').innerHTML = modeSel + (!L.entries.length ? '<p class="hint">Нет модулей с точками стыковки.</p>' : `
      ${L.base ? `<p class="small">Достройка: ${L.base} записей чертежа без изменений, новых модулей ${L.entries.length - L.base - (L.connectors - L.entries.slice(0, L.base).filter(e => e.connector).length)}, новых соединителей ${L.connectors - L.entries.slice(0, L.base).filter(e => e.connector).length}.${(() => { const miss = baseMissing(st); return miss.length ? ` <span class="warn">В станции меньше модулей, чем в чертеже (${miss.map(x => esc(Game.moduleName(x))).join(', ')}): они всё равно останутся — чертёж не меняется.</span>` : ''; })()}</p>` : ''}
      <p>${raceSel}${ci ? ` <span class="small">${esc(ci.name)}${ci.owners.length ? ' · чертёж: ' + esc(ci.owners.map(o => Game.factionName(o)).join(', ')) : ''}</span>` : ''}</p>
      <p>Модулей: ${L.entries.length - L.connectors}${L.connectors ? ` + соединителей ${L.connectors} (${esc(ci ? ci.name : L.connectorMacro)}${ci && ci.price ? `, ≈ ${fmt(ci.price.avg * L.connectors)} Кр` : ''})` : ''} · размер ${km(L.size[0])} × ${km(L.size[1])} × ${km(L.size[2])} км (X × высота × Z)
        ${L.unplaced.length ? `<br><span class="warn">Не встали: ${L.unplaced.map(m => esc(Game.moduleName(m))).join(', ')} — их надо поставить в редакторе станции.</span>` : ''}</p>
      <div class="lays">${view(0, 2, 'Сверху')}${view(0, 1, 'Сбоку')}</div>
      <p class="small"><span class="lg"><i class="p"></i>производство</span> <span class="lg"><i class="h"></i>жильё</span> <span class="lg"><i class="s"></i>склады</span> <span class="lg"><i class="d"></i>доки и причалы</span> <span class="lg"><i class="c"></i>соединители</span>
        · Прямоугольники — габариты модулей.</p>
      <p class="small">Модули поворачиваются только по yaw и roll шагами по 90°, как в планах самой игры.</p>`);
    d.querySelectorAll('[name=layMode]').forEach(r => { r.onchange = () => { st.layoutMode = r.value; save(); showLayout(st); }; });
    if ($('#layBaseOff')) $('#layBaseOff').onclick = () => { if (confirm('Забыть чертёж-основу? Раскладка будет с нуля.')) { delete st.base; delete st.layoutMode; save(); showLayout(st); } };
    $('#layBaseLoad').onclick = () => loadBase(st, true, !!st.base);
    if ($('#layConnRace')) $('#layConnRace').onchange = e => { st.connRace = e.target.value || null; save(); showLayout(st); };
    $('#laySave').onclick = () => { d.close(); savePlanUI(st, false); };
  }

  // ---------- station expanding ----------
  let EX = null; // {st, opt, result}
  function showExpand(st) {
    EX = { st, opt: Expand.options(st, EX && EX.st === st ? EX.opt : null), result: null };
    renderExpand();
    $('#expResult').innerHTML = '';
    $('#expApply').disabled = true;
    $('#expDlg').showModal();
  }
  function renderExpand() {
    const o = EX.opt;
    const raceSel = (id, races, val) => `<select id="${id}">${races.sort((a, b) => Game.raceName(a).localeCompare(Game.raceName(b))).map(r => `<option value="${r}" ${r === val ? 'selected' : ''}>${esc(Game.raceName(r))}</option>`).join('')}</select>`;
    const res = [...o.resources.values()].sort((a, b) => (a.ref === 'workforce') - (b.ref === 'workforce') || Game.wareName(a.id).localeCompare(Game.wareName(b.id)));
    $('#expBody').innerHTML = `
      <fieldset><legend><label><input type="checkbox" id="exWf" ${o.workforce ? 'checked' : ''}> Жильё для рабочих</label></legend>
        Раса жильцов ${raceSel('exHabRace', Expand.habRaces(), o.habRace)}</fieldset>
      ${o.shipMods ? `<fieldset><legend><label><input type="checkbox" id="exShipMods" ${o.shipMods.on ? 'checked' : ''}> Модули верфи для заказанных кораблей</label></legend>
        ${o.shipMods.list.length ? 'Не хватает: ' + o.shipMods.list.map(([m, n]) => esc(Game.moduleName(m)) + ' ×' + n).join(', ') + '. Ресурсы кораблей и их цепочки — в «Производстве недостающих товаров».' : 'Модулей верфи хватает; ресурсы кораблей и их цепочки — в «Производстве недостающих товаров».'}</fieldset>` : ''}
      ${o.alloy ? `<fieldset><legend><label><input type="checkbox" id="exAlloy" ${o.alloy.on ? 'checked' : ''}> Аллографен для верфи</label></legend>
        На станции есть модули строительства или обслуживания кораблей: модулей «${esc(Game.moduleName(o.alloy.macro))}» не меньше
        <input type="number" id="exAlloyN" min="1" max="50" step="1" value="${esc(o.alloy.n)}" style="width:4em">
        (уже стоящие считаются), с цепочкой: металлолом ха'ак, энергия; обломки ха'ак — буксирами, нивидий — шахтёрами.
        <div class="small">Аллографен — универсальная замена любых деталей при постройке кораблей (курс замены задан в движке игры).
        ${o.alloy.full ? `Заказанные корабли расходуют ресурсов на ${fmt(o.alloy.value)} Кр/ч: заменить их все по стоимости — около ${o.alloy.full} модулей.` : 'Укажите корабли в блоке строительства — будет оценка, сколько модулей заменят их ресурсы.'}</div></fieldset>` : ''}
      <fieldset><legend><label><input type="checkbox" id="exRes" ${o.resourcesOn ? 'checked' : ''}> Производство недостающих товаров</label></legend>
        ${res.length ? `<table class="grid"><tbody>${res.map(x => `<tr><td><input type="checkbox" data-exr="${esc(x.id)}" ${x.enabled ? 'checked' : ''}></td>
          <td class="nm">${esc(Game.wareName(x.id))}${x.ref === 'workforce' ? ' <small>(рабочим)</small>' : x.ref === 'alloy' ? ' <small>(аллографен)</small>' : ''}</td>
          <td>${x.methods.length > 1 ? `<select data-exm="${esc(x.id)}">${x.methods.map(m => `<option value="${esc(m)}" ${m === x.method ? 'selected' : ''}>${esc(Game.text(Game.production(x.id, m).name) || m)}</option>`).join('')}</select>` : esc(Game.text(Game.production(x.id, x.method).name) || x.method)}</td>
          <td class="small">${(() => { const fm = Expand.factory(x.id, x.method); return fm ? esc(Game.moduleName(fm.macro)) + (fm.owners && fm.owners.length ? ` <span title="Кто продаёт чертёж">· чертёж: ${esc(fm.owners.map(o => Game.factionName(o)).join(', '))}</span>` : '') : ''; })()}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">Недостающих товаров нет.</p>'}</fieldset>
      <fieldset><legend><label><input type="checkbox" id="exSt" ${o.storagesOn ? 'checked' : ''}> Склады</label></legend>
        запас на <input type="number" id="exStHours" min="1" max="48" step="1" value="${esc(o.storageHours)}" style="width:4em"> ч потока каждого товара (не меньше 5000 м³ на товар) + место под разгрузку двух больших трюмов, если тип груза привозят корабли<br>
        Раса складов ${raceSel('exStRace', Expand.storageRaces(), o.storageRace)}
        ${o.transports.map(t => `<label class="inl"><input type="checkbox" data-ext="${esc(t.id)}" ${t.enabled ? 'checked' : ''}> ${esc(TRANSPORT[t.id] || t.id)}</label>`).join('')}</fieldset>
      <fieldset><legend>Стыковка (если на станции её нет)</legend>
        <label class="inl"><input type="checkbox" id="exDock" ${o.dockOn ? 'checked' : ''}> док для S/M</label>
        <label class="inl"><input type="checkbox" id="exPier" ${o.pierOn ? 'checked' : ''}> причал для L/XL</label>
        <span class="inl">раса ${raceSel('exDockRace', Expand.dockRaces(), o.dockRace)}</span></fieldset>`;
  }
  function readExpand() {
    const o = EX.opt, d = $('#expDlg');
    o.workforce = $('#exWf').checked; o.habRace = $('#exHabRace').value;
    if (o.shipMods) o.shipMods.on = $('#exShipMods').checked;
    if (o.alloy) { o.alloy.on = $('#exAlloy').checked; o.alloy.n = Math.max(1, Math.min(50, parseInt($('#exAlloyN').value, 10) || 1)); }
    o.resourcesOn = $('#exRes').checked; o.storagesOn = $('#exSt').checked; o.storageHours = Math.max(1, Math.min(48, parseInt($('#exStHours').value, 10) || 3)); EX.st.storageHours = o.storageHours; o.storageRace = $('#exStRace').value;
    o.dockOn = $('#exDock').checked; o.pierOn = $('#exPier').checked; o.dockRace = $('#exDockRace').value;
    d.querySelectorAll('[data-exr]').forEach(i => { o.resources.get(i.dataset.exr).enabled = i.checked; });
    d.querySelectorAll('[data-exm]').forEach(i => { o.resources.get(i.dataset.exm).method = i.value; });
    d.querySelectorAll('[data-ext]').forEach(i => { const t = o.transports.find(x => x.id === i.dataset.ext); if (t) t.enabled = i.checked; });
    o.transportsOff = new Set(o.transports.filter(t => !t.enabled).map(t => t.id));
  }
  function calcExpand() {
    readExpand();
    const opt = Object.assign({}, EX.opt, { transports: EX.opt.transports.map(t => Object.assign({}, t)) });
    EX.result = Expand.run(EX.st, opt);
    const a = [...EX.result.added];
    const r = Planner.calcStation(EX.result.station, S.settings.period);
    const neg = [...r.balance.values()].filter(b => b.net < 0);
    $('#expResult').innerHTML = `<h3>Будет добавлено</h3>${a.length ? `<table class="grid"><tbody>${a.map(([m, n]) => `<tr><td class="nm">${esc(Game.moduleName(m))}</td><td>+${n}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">Добавлять нечего.</p>'}
      <p class="small">После достройки: рабочих ${fmt(r.workers)} из ${fmt(r.need)}, мест ${fmt(r.capacity)}, доход ${fmt(r.value[S.settings.price])} Кр в ${PERIODS.find(p => p[0] == S.settings.period)[1]}.
      ${neg.length ? 'Остаются в минусе: ' + neg.map(b => esc(Game.wareName(b.id))).join(', ') + '.' : 'Минусов нет.'}</p>
      ${EX.result.notes.map(n => `<p class="warn">${esc(n)}</p>`).join('')}`;
    $('#expApply').disabled = !a.length;
  }
  function applyExpand() {
    if (!EX || !EX.result) return;
    for (const [m, n] of EX.result.added) Planner.addModule(EX.st, m, n);
    if (EX.opt.workforce) EX.st.workers = null;
    $('#expDlg').close();
    changed();
  }

  function init() {
    $('#layClose').onclick = () => $('#layDlg').close();
    $('#expCalc').onclick = calcExpand;
    $('#expApply').onclick = applyExpand;
    $('#expClose').onclick = () => $('#expDlg').close();
    $('#expDlg').addEventListener('change', e => {
      $('#expApply').disabled = true;
      // another race of the residents: their food is another list of wares
      if (e.target.id === 'exHabRace' && EX) { readExpand(); EX.opt = Expand.options(EX.st, EX.opt); renderExpand(); }
    });
    $('#pickBtn').onclick = pickFolder;
    $('#altPickBtn').onclick = e => { e.preventDefault(); $('#dirInput').click(); };
    if (!window.showDirectoryPicker) $('#altPick').hidden = true;
    $('#dirInput').onchange = e => { if (e.target.files.length) startLoad([...e.target.files]); };
    $('#planDirInput').onchange = e => {
      const n = IO.setPlanFiles([...e.target.files]); e.target.value = '';
      const st = station();
      toast(n ? `Папка чертежей: ${n} планов. «Достройка» берёт чертёж станции из неё до перезагрузки страницы.` : 'В выбранной папке нет XML-планов.');
      if (n && st && !st.base) loadBase(st, false);
    };
    $('#extApply').onclick = applyExtensions;
    $('#extCancel').onclick = () => $('#extDlg').close();
    $('#lang').value = S.settings.lang;
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    if (!window.showDirectoryPicker) $('#pickNote').hidden = false;
    resume();
    window.addEventListener('resize', fitPick);
    // a list the player resized by hand keeps its height
    document.addEventListener('mouseup', e => { const el = $('#pick'); if (el && e.target === el && el.style.height && el.offsetHeight !== parseInt(el.style.height, 10)) el.dataset.userSized = '1'; });
  }

  // startLoad is also the entry for a list of File objects from elsewhere (drag and drop, tests)
  // a complex made elsewhere (the savegame page): kept and shown in the planner
  function addComplex(c) { S.complexes.push(c); S.cur = c.id; S.st = null; S.view = 'station'; S.page = 'stations'; save(); render(); toast(`Комплекс «${c.name}»: станций ${c.stations.length}`); }

  // the sunlight of a sector (map page) for the current station
  function setSunlight(pc) { const c = cx(), st = station(); if (!st) { toast('Нет текущей станции'); return; } st.sunlight = pc; save(); toast(`Солнце ${pc}% → ${c.name} / ${st.name}`); }

  return { init, S, active, load: startLoad, addComplex, setSunlight };
})();

document.addEventListener('DOMContentLoaded', UI.init);
