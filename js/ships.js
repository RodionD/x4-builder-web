/*
  X4 Builder Web - ships (the original's module_ship, page_ShipList / page_ShipProperties / page_ShipComparison).
  Ship macros (assets/units/size_*, with "alias" inheritance as module_ship.Load_Ship), their component's connections
  as slots (engine / shield / weapon / turret / missile by size), storage macros (cargo by transport), dock areas and
  ship storages (landing pads and hangar places by size), crew, missiles, drones, price and build cost from the ware.
  Engines and shields: props macros with the tags of their component's connection (setEquipmentConnectionTags); a part
  fits a slot when every tag of one is in the other, without the tags the original skips (IsEquipmentCompatible with
  "advanced platformcollision component hittable unhittable venture"; "standard" of the slot is free); Xenon / Kha'ak
  parts only on their own ships. Speed = engines' forward thrust / forward drag; boost and travel multiply it.
*/
'use strict';

const Ships = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const F = { q: '', cls: '', type: '', race: '', sel: null, sort: 'name', desc: false, compare: [], view: 'list', engine: {}, shield: {} };
  let S = null; // {ships: Map, engines: [], shields: []}
  let loading = null;

  const kids = (el, tag) => (el ? [...el.children].filter(c => !tag || c.tagName === tag) : []);
  const childEl = (el, tag) => kids(el, tag)[0] || null;
  const A = (el, n) => (el ? el.getAttribute(n) : null);
  const N = v => (v == null || v === '' ? 0 : Number(v));
  const SIZES = ['extralarge', 'large', 'medium', 'small'];
  const SZ = { extralarge: 'XL', large: 'L', medium: 'M', small: 'S', dock_xl: 'XL', dock_l: 'L', dock_m: 'M', dock_s: 'S', dock_xs: 'XS' };
  const CLASSES = { ship_xl: 'XL', ship_l: 'L', ship_m: 'M', ship_s: 'S' };
  // "advanced" is not skipped: a part tagged advanced (ship turrets / shields for advanced slots) only fits an advanced
  // slot - the game refused teladi ship turrets on the standard slots of station modules ("incompatible equipment")
  const SKIP = new Set(['platformcollision', 'component', 'hittable', 'unhittable', 'venture', 'symmetry', 'symmetry_left', 'symmetry_right', 'symmetry_1', 'symmetry_2']);
  const TRANSPORT = { container: 'Контейнеры', solid: 'Твёрдые', liquid: 'Жидкие', condensate: 'Конденсат' };
  const TYPES = { fighter: 'Истребитель', heavyfighter: 'Тяжёлый истребитель', interceptor: 'Перехватчик', bomber: 'Бомбардировщик', scout: 'Разведчик',
    corvette: 'Корвет', frigate: 'Фрегат', gunboat: 'Канонерка', destroyer: 'Эсминец', battleship: 'Линкор', carrier: 'Авианосец', resupplier: 'Снабженец',
    courier: 'Курьер', transporter: 'Транспорт', freighter: 'Грузовик', miner: 'Шахтёр', largeminer: 'Большой шахтёр', builder: 'Строитель',
    scavenger: 'Сборщик металлолома', tug: 'Буксир', police: 'Полиция', personalvehicle: 'Личный транспорт', compactor: 'Компактор', expeditionary: 'Экспедиционный' };
  const PURPOSE = { fight: 'бой', trade: 'торговля', mine: 'добыча', build: 'строительство', auxiliary: 'снабжение', salvage: 'утилизация', dismantling: 'разборка' };

  async function readXml(path) {
    if (!path) return null;
    const text = await CatFS.read(path.replace(/\\/g, '/') + '.xml');
    if (!text) return null;
    try { return XmlDiff.parse(text, path); } catch (e) { return null; }
  }
  const macroPath = name => Game.D.macros.get(String(name || '').toLowerCase());
  const compPath = name => Game.D.components.get(String(name || '').toLowerCase());

  // the connection tags of a component (cached): [{name, tags: []}]
  const compCache = new Map();
  function compConnections(ref) {
    if (!compCache.has(ref)) compCache.set(ref, (async () => {
      const doc = await readXml(compPath(ref));
      if (!doc) return [];
      const root = doc.getElementsByTagName('component')[0];
      const conns = root ? childEl(root, 'connections') : null;
      return kids(conns, 'connection').map(c => ({ name: A(c, 'name'), tags: (A(c, 'tags') || '').split(/\s+/).filter(Boolean) }));
    })());
    return compCache.get(ref);
  }

  // a part fits when every tag of the part (but the skipped ones and "standard") is in the slot's tags; so an
  // "advanced" part needs an "advanced" slot, a "standard" one fits both: a turret slot
  // tagged "turret large standard missile combat" takes laser and missile turrets, a slot with a ship's own tag
  // ("arg_destroyer_01") only the part that carries it
  function fits(slotTags, partTags) {
    const s = slotTags.filter(t => !SKIP.has(t)), p = partTags.filter(t => !SKIP.has(t));
    if (slotTags.includes('mandatory') && !partTags.includes('mandatory')) return false;
    for (const t of p) if (t !== 'standard' && !s.includes(t)) return false;
    return true;
  }

  async function loadEquipment(kind, re, read) {
    const out = [];
    const list = [...Game.D.macros].filter(([n, v]) => re.test(n) && /props\\|props\//i.test(v));
    await Promise.all(list.map(async ([n]) => {
      const doc = await readXml(macroPath(n));
      const mac = doc && doc.getElementsByTagName('macro')[0];
      if (!mac) return;
      const props = childEl(mac, 'properties');
      const ident = childEl(props, 'identification');
      const comp = A(childEl(mac, 'component'), 'ref');
      const conns = comp ? await compConnections(comp) : [];
      const own = conns.find(c => c.tags.includes(kind));
      if (!own) return;
      const ware = Game.D.wares.get(Game.D.wareByComponent.get(A(mac, 'name')));
      out.push({ macro: A(mac, 'name'), name: A(ident, 'name'), race: A(ident, 'makerrace'), mk: N(A(ident, 'mk')), tags: own.tags, size: SIZES.find(z => own.tags.includes(z)), ware, ...read(props) });
    }));
    return out;
  }

  async function dockInfo(ref) {
    // a dockingbay macro (pads / hangar) or a dock area holding dockingbays
    const doc = await readXml(macroPath(ref));
    const mac = doc && doc.getElementsByTagName('macro')[0];
    if (!mac) return null;
    const props = childEl(mac, 'properties');
    const ds = A(childEl(props, 'docksize'), 'tags');
    if (ds) {
      const d = childEl(props, 'dock');
      return [{ sizes: ds.split(/\s+/), capacity: N(A(d, 'capacity')), storage: A(d, 'storage') === '1' || (A(mac, 'name') || '').includes('storage'), external: A(d, 'external') }];
    }
    const out = [];
    for (const c of kids(childEl(mac, 'connections'), 'connection')) {
      const r = A(childEl(c, 'macro'), 'ref');
      if (r && /dock|bay/i.test(r)) { const x = await dockInfo(r); if (x) out.push(...x); }
    }
    return out;
  }

  async function loadShip(name, path, all) {
    const doc = await readXml(path);
    const mac = doc && doc.getElementsByTagName('macro')[0];
    if (!mac || !/^ship_(s|m|l|xl)$/.test(A(mac, 'class') || '')) return null;
    let props = childEl(mac, 'properties');
    // alias: the properties of the macro it is a variant of
    const alias = A(mac, 'alias');
    if (alias && (!props || !childEl(props, 'hull'))) {
      const ad = await readXml(macroPath(alias));
      const am = ad && ad.getElementsByTagName('macro')[0];
      if (am) props = childEl(am, 'properties') || props;
    }
    const ident = childEl(props, 'identification');
    const ship = {
      macro: A(mac, 'name'), class: A(mac, 'class'), name: A(ident, 'name'), basename: A(ident, 'basename'), variation: A(ident, 'shortvariation') || A(ident, 'variation'),
      race: A(ident, 'makerrace'), description: A(ident, 'description'), type: A(childEl(props, 'ship'), 'type'), purpose: A(childEl(props, 'purpose'), 'primary'),
      hull: N(A(childEl(props, 'hull'), 'max')), crew: N(A(childEl(props, 'people'), 'capacity')),
      missiles: N(A(childEl(props, 'storage'), 'missile')), units: N(A(childEl(props, 'storage'), 'unit')), deployables: N(A(childEl(props, 'storage'), 'deployable')),
      countermeasures: N(A(childEl(props, 'storage'), 'countermeasure')),
      mass: N(A(childEl(props, 'physics'), 'mass')), drag: {}, slots: {}, cargo: {}, pads: {}, hangar: {}, ext: (path.match(/^extensions\\([^\\]+)/i) || [])[1] || null,
    };
    const drag = childEl(childEl(props, 'physics'), 'drag');
    if (drag) for (const a of drag.attributes) ship.drag[a.name] = N(a.value);
    const comp = A(childEl(mac, 'component'), 'ref');
    for (const c of (comp ? await compConnections(comp) : [])) {
      const kind = ['engine', 'shield', 'turret', 'missile', 'weapon'].find(k => c.tags.includes(k));
      if (!kind || c.tags.includes('part')) continue;
      const k = kind === 'weapon' && c.tags.includes('missile') ? 'missile' : kind;
      const size = SIZES.find(z => c.tags.includes(z)) || 'small';
      ship.slots[k] = ship.slots[k] || {};
      ship.slots[k][size] = (ship.slots[k][size] || 0) + 1;
      (ship.slotTags = ship.slotTags || {})[k] = ship.slotTags[k] || c.tags;
      ship.slotTagsBy = ship.slotTagsBy || {};
      (ship.slotTagsBy[k] = ship.slotTagsBy[k] || {})[size] = ship.slotTagsBy[k][size] || c.tags;
    }
    for (const c of kids(childEl(mac, 'connections'), 'connection')) {
      const r = A(childEl(c, 'macro'), 'ref');
      if (!r) continue;
      if (/^storage_/i.test(r)) {
        const sd = await readXml(macroPath(r));
        const cg = sd && sd.getElementsByTagName('cargo')[0];
        if (cg) for (const t of (A(cg, 'tags') || '').split(/\s+/)) ship.cargo[t] = (ship.cargo[t] || 0) + N(A(cg, 'max'));
      } else if (/dock|shipstorage/i.test(r)) {
        for (const b of (await dockInfo(r)) || []) for (const z of b.sizes) {
          if (!SZ[z]) continue;
          if (b.storage) ship.hangar[z] = (ship.hangar[z] || 0) + (b.capacity || 1);
          else ship.pads[z] = (ship.pads[z] || 0) + 1;
        }
      }
    }
    const wid = Game.D.wareByComponent.get(ship.macro);
    ship.ware = wid ? Game.D.wares.get(wid) : null;
    return ship;
  }

  async function load(progress) {
    if (S) return;
    if (loading) return loading;
    loading = (async () => {
      const s = { ships: new Map(), engines: [], shields: [] };
      progress('Двигатели и щиты…');
      s.engines = await loadEquipment('engine', /^engine_.*_macro$/, p => {
        const th = childEl(p, 'thrust'), b = childEl(p, 'boost'), t = childEl(p, 'travel');
        return { forward: N(A(th, 'forward')), reverse: N(A(th, 'reverse')), boost: N(A(b, 'thrust')), boostTime: N(A(b, 'duration')), travel: N(A(t, 'thrust')), travelCharge: N(A(t, 'charge')) };
      });
      s.shields = await loadEquipment('shield', /^shield_.*_macro$/, p => {
        const r = childEl(p, 'recharge');
        return { capacity: N(A(r, 'max')), rate: N(A(r, 'rate')), delay: N(A(r, 'delay')) };
      });
      const list = [...Game.D.macros].filter(([n, v]) => /^ship_.*_macro$/.test(n) && /units\\size_|units\/size_/i.test(v));
      let done = 0;
      const queue = list.slice();
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (queue.length) {
          const [n, v] = queue.shift();
          try { const sh = await loadShip(n, v); if (sh) s.ships.set(sh.macro, sh); } catch (e) { /* a broken macro */ }
          if (++done % 25 === 0) progress(`Корабли: ${done} из ${list.length}`);
        }
      }));
      S = s;
    })();
    return loading;
  }

  // parts that fit a ship's slot kind, best Mk of its race first
  function partsFor(ship, kind, list, size) {
    const tags = size ? ship.slotTagsBy && ship.slotTagsBy[kind] && ship.slotTagsBy[kind][size] : ship.slotTags && ship.slotTags[kind];
    if (!tags) return [];
    const own = ship.race === 'xenon' || ship.race === 'khaak';
    return list.filter(p => fits(tags, p.tags) && (own ? p.race === ship.race : !['xenon', 'khaak'].includes(p.race)))
      .sort((a, b) => (b.race === ship.race) - (a.race === ship.race) || (kind === 'engine' ? b.forward - a.forward : b.capacity - a.capacity));
  }
  const slotCount = (ship, kind) => Object.values(ship.slots[kind] || {}).reduce((a, b) => a + b, 0);

  // speeds and shields with the chosen (or default: the best of its race) parts
  function stats(ship) {
    const engines = partsFor(ship, 'engine', S.engines), shields = partsFor(ship, 'shield', S.shields);
    const e = engines.find(x => x.macro === F.engine[ship.macro]) || engines[0] || null;
    const sh = shields.find(x => x.macro === F.shield[ship.macro]) || shields[0] || null;
    const ne = slotCount(ship, 'engine');
    const speed = e && ship.drag.forward ? (e.forward * ne) / ship.drag.forward : 0;
    // shields by slot size: the chosen one where it fits, else the best of that size
    let shield = 0, recharge = 0;
    for (const [size, n] of Object.entries(ship.slots.shield || {})) {
      const l = partsFor(ship, 'shield', S.shields, size);
      const p = (sh && l.find(x => x.macro === sh.macro)) || l[0];
      if (p) { shield += p.capacity * n; recharge += p.rate * n; }
    }
    return { engines, shields, e, sh, speed, boost: e ? speed * e.boost : 0, travel: e ? speed * e.travel : 0, shield, recharge };
  }

  const sizesText = o => SIZES.concat(['dock_xl', 'dock_l', 'dock_m', 'dock_s', 'dock_xs']).filter(k => o && o[k]).map(k => `${SZ[k]}×${o[k]}`).join(' ');
  const cargoTotal = s => Math.max(0, ...Object.values(s.cargo));
  const shipName = s => Game.text(s.name) || s.macro;

  const COLS = [
    ['name', 'Корабль', s => shipName(s)],
    ['class', 'Кл.', s => CLASSES[s.class]],
    ['type', 'Тип', s => TYPES[s.type] || s.type || ''],
    ['hull', 'Корпус', s => s.hull, true],
    ['shield', 'Щиты', s => stats(s).shield, true],
    ['speed', 'Скорость', s => stats(s).speed, true],
    ['cargo', 'Трюм', s => cargoTotal(s), true],
    ['crew', 'Экипаж', s => s.crew, true],
    ['price', 'Цена', s => (s.ware ? s.ware.price.avg : 0), true],
  ];

  function filtered() {
    const q = F.q.toLowerCase();
    const out = [];
    for (const s of S.ships.values()) {
      if (F.cls && s.class !== F.cls) continue;
      if (F.type && s.type !== F.type) continue;
      if (F.race && s.race !== F.race) continue;
      if (q && !shipName(s).toLowerCase().includes(q) && !s.macro.includes(q)) continue;
      out.push(s);
    }
    const col = COLS.find(c => c[0] === F.sort) || COLS[0];
    out.sort((a, b) => { const x = col[2](a), y = col[2](b); const r = col[3] ? (x || 0) - (y || 0) : String(x).localeCompare(String(y)); return F.desc ? -r : r; });
    return out;
  }

  function card(s) {
    const st = stats(s);
    const w = s.ware;
    const opt = (list, cur, kind) => `<select data-part="${kind}" data-ship="${esc(s.macro)}">${list.map(p => `<option value="${esc(p.macro)}" ${cur && p.macro === cur.macro ? 'selected' : ''}>${esc(Game.text(p.name) || p.macro)}</option>`).join('')}</select>`;
    const slots = ['engine', 'shield', 'weapon', 'turret', 'missile'].filter(k => s.slots[k]).map(k => `<tr><td>${{ engine: 'Двигатели', shield: 'Щиты', weapon: 'Орудия', turret: 'Турели', missile: 'Ракетные установки' }[k]}</td><td>${sizesText(s.slots[k])}</td></tr>`).join('');
    const cargo = Object.entries(s.cargo).map(([t, v]) => `${TRANSPORT[t] || t} ${fmt(v)} м³`).join(', ');
    const p = w && w.productions[0];
    const build = p ? p.primary.map(r => `<a href="#" data-goware="${esc(r.ware)}">${esc(Game.wareName(r.ware))}</a> ×${fmt(r.amount)}`).join(', ') : '';
    return `<h2>${esc(shipName(s))}</h2>
      <p class="small">${esc(CLASSES[s.class])} · ${esc(TYPES[s.type] || s.type || '')} · ${esc(PURPOSE[s.purpose] || s.purpose || '')} · ${esc(Game.raceName(s.race))}
        <button data-cmp="${esc(s.macro)}">${F.compare.includes(s.macro) ? '− из сравнения' : '+ к сравнению'}</button></p>
      <table class="grid facts"><tbody>
        <tr><td>Идентификатор</td><td><code>${esc(s.macro)}</code>${s.ext ? ` <span class="tag">${esc(s.ext)}</span>` : ''}</td></tr>
        <tr><td>Корпус</td><td>${fmt(s.hull)}</td></tr>
        <tr><td>Двигатель</td><td>${st.engines.length ? opt(st.engines, st.e, 'engine') : '—'}</td></tr>
        <tr><td>Скорость</td><td>${fmt(st.speed)} м/с · форсаж ${fmt(st.boost)} · маршевый ${fmt(st.travel)}${st.e && st.e.boostTime ? ` <small>(форсаж ${fmt(st.e.boostTime, 1)} с)</small>` : ''}</td></tr>
        <tr><td>Щит</td><td>${st.shields.length ? opt(st.shields, st.sh, 'shield') : '—'}</td></tr>
        <tr><td>Щиты</td><td>${fmt(st.shield)} · восстановление ${fmt(st.recharge)}/с${st.sh ? `, задержка ${fmt(st.sh.delay, 1)} с` : ''}</td></tr>
        ${slots}
        ${cargo ? `<tr><td>Трюм</td><td>${cargo}</td></tr>` : ''}
        ${sizesText(s.pads) ? `<tr><td>Посадка</td><td>${sizesText(s.pads)}</td></tr>` : ''}
        ${sizesText(s.hangar) ? `<tr><td>Ангар</td><td>${sizesText(s.hangar)}</td></tr>` : ''}
        <tr><td>Экипаж</td><td>${fmt(s.crew)}</td></tr>
        <tr><td>Ракеты / дроны</td><td>${fmt(s.missiles)} / ${fmt(s.units)}${s.deployables ? ` · развёртываемые ${fmt(s.deployables)}` : ''}${s.countermeasures ? ` · ловушки ${fmt(s.countermeasures)}` : ''}</td></tr>
        <tr><td>Масса</td><td>${fmt(s.mass, 1)} т · сопротивление ${fmt(s.drag.forward, 1)}</td></tr>
        ${w ? `<tr><td>Цена</td><td>${fmt(w.price.min)} / <b>${fmt(w.price.avg)}</b> / ${fmt(w.price.max)} Кр</td></tr>` : ''}
        ${build ? `<tr><td>Постройка</td><td class="small">${build}${p.time ? ` · ${fmt(p.time)} с` : ''}</td></tr>` : ''}
        ${w && w.owners.length ? `<tr><td>Продают</td><td class="small">${w.owners.map(o => esc(Game.factionName(o))).join(', ')}</td></tr>` : ''}
      </tbody></table>
      ${Game.text(s.description) ? `<p class="small desc">${esc(Game.text(s.description))}</p>` : ''}`;
  }

  function compareView() {
    const list = F.compare.map(m => S.ships.get(m)).filter(Boolean);
    if (!list.length) return '<p class="hint">Добавьте корабли кнопкой «+ к сравнению».</p>';
    const rows = [
      ['Класс', s => CLASSES[s.class]], ['Тип', s => TYPES[s.type] || s.type], ['Раса', s => Game.raceName(s.race)],
      ['Корпус', s => s.hull, 1], ['Щиты', s => stats(s).shield, 1], ['Восстановление щитов', s => stats(s).recharge, 1],
      ['Скорость', s => stats(s).speed, 1], ['Форсаж', s => stats(s).boost, 1], ['Маршевый', s => stats(s).travel, 1],
      ['Двигатели', s => sizesText(s.slots.engine)], ['Орудия', s => sizesText(s.slots.weapon)], ['Турели', s => sizesText(s.slots.turret)],
      ['Ракетные установки', s => sizesText(s.slots.missile)], ['Трюм', s => cargoTotal(s), 1], ['Посадка', s => sizesText(s.pads)], ['Ангар', s => sizesText(s.hangar)],
      ['Экипаж', s => s.crew, 1], ['Ракеты', s => s.missiles, 1], ['Дроны', s => s.units, 1], ['Цена', s => (s.ware ? s.ware.price.avg : 0), -1],
    ];
    return `<table class="grid cmp"><thead><tr><th></th>${list.map(s => `<th>${esc(shipName(s))}<br><button data-cmp="${esc(s.macro)}">убрать</button></th>`).join('')}</tr></thead><tbody>${
      rows.map(([n, f, numeric]) => {
        const vals = list.map(f);
        // the best value: the largest, or the smallest for a price (numeric = -1)
        const nz = vals.map(v => v || 0);
        const best = numeric ? (numeric < 0 ? Math.min(...nz.filter(v => v > 0)) : Math.max(...nz)) : null;
        return `<tr><td>${n}</td>${vals.map(v => `<td class="${numeric && v === best && list.length > 1 && v ? 'pos' : ''}">${numeric ? fmt(v) : esc(v || '')}</td>`).join('')}</tr>`;
      }).join('')}</tbody></table>`;
  }

  async function render(root) {
    if (!S) {
      root.innerHTML = '<p class="hint" id="shipLoad">Загрузка кораблей…</p>';
      await load(t => { const e = root.querySelector('#shipLoad'); if (e) e.textContent = t; });
      if (!UI.active('ships')) return; // the player went to another page meanwhile
    }
    const types = [...new Set([...S.ships.values()].map(s => s.type).filter(Boolean))].sort((a, b) => (TYPES[a] || a).localeCompare(TYPES[b] || b));
    const races = [...new Set([...S.ships.values()].map(s => s.race).filter(Boolean))].sort((a, b) => Game.raceName(a).localeCompare(Game.raceName(b)));
    const list = filtered();
    if (!F.sel || !S.ships.has(F.sel)) F.sel = list[0] ? list[0].macro : null;
    const head = COLS.map(c => `<th data-ssort="${c[0]}">${c[1]}${F.sort === c[0] ? (F.desc ? ' ▼' : ' ▲') : ''}</th>`).join('');
    const body = list.slice(0, 500).map(s => `<tr data-ship="${esc(s.macro)}" class="${s.macro === F.sel ? 'on' : ''}">${COLS.map((c, i) => `<td class="${i ? '' : 'nm'}">${c[3] ? fmt(c[2](s)) : esc(c[2](s))}</td>`).join('')}</tr>`).join('');
    root.innerHTML = `<div class="filters ships-top">
        <button data-sview="list" class="${F.view === 'list' ? 'on' : ''}">Список</button>
        <button data-sview="compare" class="${F.view === 'compare' ? 'on' : ''}">Сравнение (${F.compare.length})</button>
      </div>
      ${F.view === 'compare' ? compareView() : `<div class="wares wide">
      <section class="wlist">
        <div class="filters">
          <input id="sq" placeholder="Поиск корабля" value="${esc(F.q)}">
          <select id="scls"><option value="">Все классы</option>${Object.entries(CLASSES).map(([k, v]) => `<option value="${k}" ${F.cls === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <select id="stype"><option value="">Все типы</option>${types.map(t => `<option value="${esc(t)}" ${F.type === t ? 'selected' : ''}>${esc(TYPES[t] || t)}</option>`).join('')}</select>
          <select id="srace"><option value="">Все расы</option>${races.map(r => `<option value="${esc(r)}" ${F.race === r ? 'selected' : ''}>${esc(Game.raceName(r))}</option>`).join('')}</select>
        </div>
        <table class="grid wtab stab"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
        <p class="small">${list.length} из ${S.ships.size}${list.length > 500 ? ', показаны первые 500' : ''}. Скорость и щиты — с лучшими деталями расы корабля.</p>
      </section>
      <section class="wcard">${F.sel ? card(S.ships.get(F.sel)) : ''}</section></div>`}`;
  }

  function click(t, root) {
    const c = t.closest('[data-cmp]');
    if (c) { const m = c.dataset.cmp; F.compare = F.compare.includes(m) ? F.compare.filter(x => x !== m) : F.compare.concat(m).slice(-6); render(root); return true; }
    const v = t.closest('[data-sview]');
    if (v) { F.view = v.dataset.sview; render(root); return true; }
    const so = t.closest('[data-ssort]');
    if (so) { if (F.sort === so.dataset.ssort) F.desc = !F.desc; else { F.sort = so.dataset.ssort; F.desc = !!(COLS.find(x => x[0] === F.sort) || [])[3]; } render(root); return true; }
    const s = t.closest('tr[data-ship]');
    if (s) { F.sel = s.dataset.ship; render(root); return true; }
    return false;
  }
  function change(t, root) {
    if (t.dataset.part) { (t.dataset.part === 'engine' ? F.engine : F.shield)[t.dataset.ship] = t.value; render(root); return true; }
    const map = { scls: 'cls', stype: 'type', srace: 'race' };
    if (map[t.id]) { F[map[t.id]] = t.value; render(root); return true; }
    return false;
  }
  function input(t, root) {
    if (t.id === 'sq') { F.q = t.value; const pos = t.selectionStart; render(root).then(() => { const n = root.querySelector('#sq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); return true; }
    return false;
  }
  function reset() { S = null; loading = null; compCache.clear(); }

  // for the ship building of the planner: the data, a ship, the parts of a kind that fit it
  const api = {
    load: progress => load(progress || (() => {})),
    get loaded() { return !!S; },
    ships: () => (S ? [...S.ships.values()] : []),
    ship: m => (S ? S.ships.get(m) : null),
    parts: (ship, kind, size) => partsFor(ship, kind, kind === 'engine' ? S.engines : S.shields, size),
    shields: () => (S ? S.shields : []),
    slotCount, shipName,
  };
  return { render, click, change, input, reset, F, fits, api };
})();
