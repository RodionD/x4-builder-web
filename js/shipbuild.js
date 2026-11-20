/*
  X4 Builder Web - ship building of a station (not in the original X4 Builder: it priced build modules, not the
  ships they build). The player lists ships and how many a day; the loadout is the hull only, or Mk1 / the best
  parts of the ship's race in every engine / shield / weapon / turret slot (parts that fit the slot tags, as the
  ships page). The station then consumes the hull's and the parts' build resources (Planner adds st.shipDemand to
  the balance, so the expanding adds the production), and the build modules needed by class are counted:
  ceil(ships per hour * build time / 3600), the build time taken as the hull's plus every part's ware production
  time - an estimate: in the game it also depends on the build drones.
*/
'use strict';

const ShipBuild = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const LOADOUTS = { hull: 'только корпус', mk1: 'Mk1 расы', best: 'лучшее расы' };
  const CLASS = { ship_s: 'S', ship_m: 'M', ship_l: 'L', ship_xl: 'XL' };
  let q = '';
  let loadingNote = '';

  // the build modules by the ship classes they build (<builder classes>), from the module macros
  function builders() {
    const out = {};
    for (const m of Game.D.modules.values()) {
      if (m.class !== 'buildmodule' || !m.builderClasses) continue;
      for (const c of m.builderClasses) (out[c] = out[c] || []).push(m);
    }
    // the generic shipyard module first, then the cheapest
    for (const c in out) out[c].sort((a, b) => (/_gen_ships_/.test(b.macro) - /_gen_ships_/.test(a.macro)) || a.price.avg - b.price.avg);
    return out;
  }

  function pickPart(list, how) {
    list = list.filter(p => p.ware); // only parts that are sold / built
    if (!list.length) return null;
    if (how === 'best') return list[0];
    const own = list.filter(p => p.race === list[0].race);
    return (own.length ? own : list).slice().sort((a, b) => (a.mk || 9) - (b.mk || 9) || (a.ware ? a.ware.price.avg : 0) - (b.ware ? b.ware.price.avg : 0))[0];
  }
  function weaponsFor(ship, kind, how, size) {
    const tags = ship.slotTagsBy && ship.slotTagsBy[kind] && ship.slotTagsBy[kind][size];
    if (!tags) return null;
    const own = ship.race === 'xenon' || ship.race === 'khaak';
    const list = Military.api.items().filter(w => (kind === 'turret' ? w.kind === 'turret' : w.kind === 'weapon') && w.ware && Ships.fits(tags, w.tags)
      && (own ? w.race === ship.race : !['xenon', 'khaak'].includes(w.race)))
      .sort((a, b) => (b.race === ship.race) - (a.race === ship.race) || (how === 'best' ? b.sustained - a.sustained : (a.mk || 9) - (b.mk || 9) || a.ware.price.avg - b.ware.price.avg));
    return list[0] || null;
  }

  // one ship: [{ware, amount}] of resources and its build time
  function shipCost(macro, how) {
    const ship = Ships.api.ship(macro);
    if (!ship || !ship.ware) return null;
    const res = new Map(), parts = [];
    let time = 0;
    const take = (ware, n) => {
      const p = Game.production(ware.id, 'default');
      if (!p) return;
      for (const r of p.primary) res.set(r.ware, (res.get(r.ware) || 0) + r.amount * n);
      time += (p.time || 0) * n;
    };
    take(ship.ware, 1);
    if (how !== 'hull') {
      // every slot size of every kind gets its own part
      for (const kind of ['engine', 'shield', 'weapon', 'turret']) {
        for (const [size, n] of Object.entries(ship.slots[kind] || {})) {
          const part = kind === 'engine' || kind === 'shield' ? pickPart(Ships.api.parts(ship, kind, size), how) : weaponsFor(ship, kind, how, size);
          if (part && part.ware && n) { take(part.ware, n); parts.push([part.ware.id, n]); }
        }
      }
    }
    return { res, time, parts, cls: ship.class };
  }

  // st.shipOrders [{macro, perDay, loadout}] -> st.shipDemand {wares: {id: per hour}, need: {class: modules}, detail}
  function compute(st) {
    const wares = {}, need = {}, detail = [];
    const busy = {};
    for (const o of st.shipOrders || []) {
      const c = shipCost(o.macro, o.loadout);
      if (!c) continue;
      const perHour = (o.perDay || 0) / 24;
      for (const [w, a] of c.res) wares[w] = (wares[w] || 0) + a * perHour;
      busy[c.cls] = (busy[c.cls] || 0) + perHour * c.time / 3600;
      detail.push({ macro: o.macro, time: c.time, parts: c.parts, res: [...c.res] });
    }
    for (const [cls, b] of Object.entries(busy)) need[cls] = Math.ceil(b - 1e-9);
    st.shipDemand = { wares, need, busy, detail };
    return st.shipDemand;
  }

  // build modules of the station by the classes they build
  function present(st) {
    const out = {};
    for (const sm of st.modules) {
      const m = Game.D.modules.get(sm.macro);
      if (!m || !sm.enabled || !m.builderClasses) continue;
      for (const c of m.builderClasses) out[c] = (out[c] || 0) + sm.count;
    }
    return out;
  }

  async function ensureData(rerender) {
    if (Ships.api.loaded && Military.api.items().length) return true;
    if (loadingNote) return false;
    loadingNote = 'Загрузка кораблей и вооружения…';
    await Ships.api.load(t => { loadingNote = t; });
    await Military.api.load(t => { loadingNote = t; });
    loadingNote = '';
    rerender();
    return false;
  }

  function render(st, el, rerender) {
    // no shipyard modules and no orders: the block is folded to one line (and the ship data are not loaded)
    if (!st.shipOpen && !(st.shipOrders || []).length && !Object.keys(present(st)).length) {
      el.innerHTML = `<h3>Постройка кораблей <button data-sbopen class="small">показать</button></h3>
        <p class="hint">На станции нет модулей верфи. Откройте блок, чтобы выбрать корабли — модули верфи для них добавятся кнопкой.</p>`;
      return;
    }
    if (!Ships.api.loaded || !Military.api.items().length) {
      el.innerHTML = `<h3>Постройка кораблей</h3><p class="hint">${esc(loadingNote || 'Нужны данные кораблей…')}</p>`;
      ensureData(rerender);
      return;
    }
    const d = compute(st);
    const have = present(st), B = builders();
    const orders = (st.shipOrders || []).map((o, i) => {
      const ship = Ships.api.ship(o.macro);
      const det = d.detail.find(x => x.macro === o.macro);
      return `<tr><td class="nm">${esc(ship ? Ships.api.shipName(ship) : o.macro)} <small>${esc(CLASS[ship && ship.class] || '')}</small></td>
        <td><input type="number" min="0" step="1" value="${esc(o.perDay)}" data-sbday="${i}" title="Кораблей в сутки"></td>
        <td><select data-sblo="${i}">${Object.entries(LOADOUTS).map(([k, v]) => `<option value="${k}" ${o.loadout === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td class="small">${det ? fmt(det.time / 60, 1) + ' мин' : ''}</td><td><button data-sbrm="${i}">×</button></td></tr>`;
    }).join('');
    const classes = [...new Set([...Object.keys(d.need), ...Object.keys(have)])].sort((a, b) => ['ship_s', 'ship_m', 'ship_l', 'ship_xl'].indexOf(a) - ['ship_s', 'ship_m', 'ship_l', 'ship_xl'].indexOf(b));
    const lack = classes.filter(c => (d.need[c] || 0) > (have[c] || 0));
    const modRows = classes.map(c => `<tr><td>${CLASS[c] || c}</td><td>${fmt((d.busy[c] || 0) * 100)}%</td><td>${d.need[c] || 0}</td><td class="${(have[c] || 0) < (d.need[c] || 0) ? 'neg' : 'pos'}">${have[c] || 0}</td>
      <td class="small">${esc(B[c] && B[c][0] ? Game.moduleName(B[c][0].macro) : 'нет модуля')}</td></tr>`).join('');
    const ql = q.toLowerCase();
    const pick = ql.length >= 2 ? Ships.api.ships().filter(s => s.ware && (Ships.api.shipName(s).toLowerCase().includes(ql) || s.macro.includes(ql))).slice(0, 30) : [];
    const fold = !(st.shipOrders || []).length && !Object.keys(have).length ? ' <button data-sbclose class="small">скрыть</button>' : '';
    el.innerHTML = `<h3>Постройка кораблей${fold}</h3>
      ${orders ? `<table class="grid"><thead><tr><th>Корабль</th><th>В сутки</th><th>Оснащение</th><th title="Корпус + детали по данным игры; в игре зависит и от дронов верфи">Время ≈</th><th></th></tr></thead><tbody>${orders}</tbody></table>` : '<p class="hint">Добавьте корабли, которые станция будет строить.</p>'}
      <div class="filters"><input id="sbq" placeholder="Добавить корабль: поиск" value="${esc(q)}"></div>
      ${pick.length ? `<ul class="pick sbpick">${pick.map(s => `<li data-sbadd="${esc(s.macro)}"><span>${esc(Ships.api.shipName(s))}</span><small>${esc(CLASS[s.class])} · ${esc(Game.raceName(s.race))}</small></li>`).join('')}</ul>` : ''}
      ${modRows ? `<table class="grid"><thead><tr><th>Класс</th><th>Загрузка</th><th>Нужно модулей</th><th>Есть</th><th>Модуль верфи</th></tr></thead><tbody>${modRows}</tbody></table>
        <p>${lack.length ? `<button data-sbmods>Добавить недостающие модули верфи</button> ` : ''}<button data-sball title="Модули верфи по заказам и автодостройка: производство всей цепочки, жильё, склады">Всё для постройки</button></p>
        <p class="small">Ресурсы на постройку входят в баланс станции как потребление; «Автодостройка» добавит их производство.</p>` : ''}`;
  }

  // events (from ui.js); true when handled
  function click(t, st) {
    if (t.closest('[data-sbopen]')) { st.shipOpen = true; return true; }
    if (t.closest('[data-sbclose]')) { st.shipOpen = false; q = ''; return true; }
    const a = t.closest('[data-sbadd]');
    if (a) { (st.shipOrders = st.shipOrders || []).push({ macro: a.dataset.sbadd, perDay: 1, loadout: 'mk1' }); q = ''; return true; }
    const r = t.closest('[data-sbrm]');
    if (r) { st.shipOrders.splice(+r.dataset.sbrm, 1); return true; }
    if (t.closest('[data-sbmods]') || t.closest('[data-sball]')) {
      const d = compute(st), have = present(st), B = builders();
      for (const [c, n] of Object.entries(d.need)) {
        const add = n - (have[c] || 0);
        if (add > 0 && B[c] && B[c][0]) Planner.addModule(st, B[c][0].macro, add);
      }
      return true;
    }
    return false;
  }
  function change(t, st) {
    if (t.dataset.sbday != null) { st.shipOrders[+t.dataset.sbday].perDay = Math.max(0, Number(t.value) || 0); return true; }
    if (t.dataset.sblo != null) { st.shipOrders[+t.dataset.sblo].loadout = t.value; return true; }
    return false;
  }
  function input(t) { if (t.id === 'sbq') { q = t.value; return true; } return false; }

  // the build modules the ordered ships still need: [[macro, n]] (as the block's "add modules" button)
  function missingModules(st) {
    if (!(st.shipOrders || []).length || !Ships.api.loaded) return [];
    const d = compute(st), have = present(st), B = builders(), out = [];
    for (const [c, n] of Object.entries(d.need)) { const add = n - (have[c] || 0); if (add > 0 && B[c] && B[c][0]) out.push([B[c][0].macro, add]); }
    return out;
  }
  return { render, click, change, input, compute, missingModules };
})();
