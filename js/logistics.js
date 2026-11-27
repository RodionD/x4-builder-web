/*
  X4 Builder Web - the station's logistics (not in the original X4 Builder): how many freighters and miners the station
  needs for its balance. From the hourly balance (Planner.calcStation for 3600 s): every ware with a deficit is brought
  in, every surplus taken out, in m³ by its transport type. Minable wares (tag "minable": ore, silicon, ice, nividium,
  hydrogen, helium, methane) are brought by miners of their type (solid / liquid); everything else by freighters
  (container). A ship moves its hold once per round trip (the player sets the trip time: it depends on the distances in
  his sector), so ships = ceil(m³ per hour / (hold × 60 / trip minutes)). Freighters carry the in- and the outgoing
  volume (a trip sells and buys, but not always both: counted separately, the sure side). The ship of each group is the
  largest hold of the chosen race and size (the player can pick another); the price is the hull's.
*/
'use strict';

const Logistics = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  // the groups: transport of the wares, kind of ship, default trip minutes
  const GROUPS = [
    { id: 'trade', name: 'Грузовики', transport: 'container', mine: false, trip: 20 },
    { id: 'solid', name: 'Шахтёры (руда, кремний, лёд, нивидий)', transport: 'solid', mine: true, trip: 30 },
    { id: 'liquid', name: 'Шахтёры газа (водород, гелий, метан)', transport: 'liquid', mine: true, trip: 30 },
    // raw scrap (rawscrap, rawkhaakscrap: tag "recycling", no production) comes from wrecks the station's tugs bring in
    { id: 'salvage', name: 'Буксиры (обломки для переработки)', transport: 'solid', mine: true, salvage: true, trip: 30 },
  ];
  const SIZES = { ship_m: 'M', ship_l: 'L' };
  let loading = '';

  const opts = st => {
    const o = st.logistics = st.logistics || {};
    if (!o.size) o.size = 'ship_l';
    if (!o.trip) o.trip = {};
    if (!o.ship) o.ship = {};
    return o;
  };

  const hold = s => Math.max(0, ...Object.values(s.cargo || {}));
  // ships of a group: sold, of a race (not Xenon / Kha'ak), of the size, with a hold for its transport
  function candidates(g, size) {
    // salvage ships, any size: tugs (purpose salvage, M: tow wrecks) and compactors (purpose dismantling, L: crush wrecks into
    // their hold) - the game's SalvageRoutine of a station takes both; counted by the hold, whatever its transport (the raw
    // scrap of a towed wreck is not in the hold, so for a tug this is an estimate)
    if (g.salvage) return Ships.api.ships().filter(s => s.ware && s.race && s.race !== 'xenon' && ['salvage', 'dismantling'].includes(s.purpose)
      && hold(s) > 0);
    return Ships.api.ships().filter(s => s.ware && s.race && !['xenon', 'khaak'].includes(s.race) && s.class === size
      && (g.mine ? s.purpose === 'mine' : s.purpose === 'trade' && (s.type === 'freighter' || s.type === 'transporter'))
      && (s.cargo[g.transport] || 0) > 0);
  }

  // m³ per hour in and out by group, with the wares
  function demand(st) {
    const r = Planner.calcStation(st, 3600);
    const out = {};
    for (const g of GROUPS) out[g.id] = { in: 0, out: 0, wares: [] };
    for (const b of r.balance.values()) {
      if (!b.net || !b.transport) continue;
      const w = Game.D.wares.get(b.id);
      const minable = w && w.tags.includes('minable');
      const scrap = w && w.tags.includes('recycling') && !(w.productions && w.productions.length);
      const g = scrap ? GROUPS.find(x => x.salvage) : minable ? GROUPS.find(x => x.transport === b.transport && !x.salvage) : b.transport === 'container' ? GROUPS[0] : null;
      if (!g) continue;
      const v = Math.abs(b.net) * b.volume;
      if (b.net < 0) out[g.id].in += v; else out[g.id].out += v;
      out[g.id].wares.push({ id: b.id, v, dir: b.net < 0 ? 'in' : 'out' });
    }
    return out;
  }

  function compute(st) {
    const o = opts(st), d = demand(st);
    const race = o.race || (typeof Layout !== 'undefined' ? Layout.stationRace(st) : null) || 'argon';
    return GROUPS.map(g => {
      const dd = d[g.id];
      const cap = s => g.salvage ? hold(s) : s.cargo[g.transport];
      const cand = candidates(g, o.size).sort((a, b) => g.salvage ? (b.purpose === 'salvage') - (a.purpose === 'salvage') || cap(b) - cap(a) : (b.race === race) - (a.race === race) || cap(b) - cap(a));
      const ship = cand.find(s => s.macro === o.ship[g.id]) || cand[0] || null;
      const trip = o.trip[g.id] || g.trip;
      // miners only bring in; freighters both ways, the larger side decides
      const vol = g.mine ? dd.in : Math.max(dd.in, dd.out);
      const perShip = ship ? cap(ship) * 60 / trip : 0;
      // salvage: one ship per primary processing module (scrap works) of the station (the player, 2026-11-19)
      const proc = g.salvage ? st.modules.reduce((t, sm) => t + ((sm.enabled !== false && (Game.D.modules.get(sm.macro) || {}).class === 'processingmodule') ? sm.count || 0 : 0), 0) : 0;
      const n = g.salvage ? (vol > 0 ? proc : 0) : vol > 0 && perShip ? Math.ceil(vol / perShip - 1e-9) : 0;
      return { g, d: dd, cand, ship, trip, vol, perShip: g.salvage ? 0 : perShip, n, proc, price: ship && n ? ship.ware.price.avg * n : 0, race };
    }).filter(x => x.vol > 0 || x.d.out > 0);
  }

  async function ensure(rerender) {
    if (Ships.api.loaded || loading) return;
    loading = 'Загрузка кораблей…';
    try { await Ships.api.load(t => { loading = t; }); } finally { loading = ''; }
    rerender();
  }

  function render(st, el, rerender) {
    const o = opts(st);
    const head = `<h3>Грузовики, шахтёры и буксиры <button data-lgtoggle class="small">${o.open ? 'скрыть' : 'показать'}</button></h3>`;
    if (!o.open) { el.innerHTML = head; return; }
    if (!Ships.api.loaded) { el.innerHTML = head + `<p class="hint">${esc(loading || 'Нужны данные кораблей…')}</p>`; ensure(rerender); return; }
    const rows = compute(st);
    if (!rows.length) { el.innerHTML = head + '<p class="hint">Станции нечего возить: баланс товаров нулевой.</p>'; return; }
    const races = [...new Set(Ships.api.ships().filter(s => s.ware && s.race && (s.purpose === 'trade' || s.purpose === 'mine')).map(s => s.race))].filter(r => !['xenon', 'khaak'].includes(r));
    const race = rows[0].race;
    let total = 0;
    const body = rows.map(x => {
      total += x.price;
      const wares = x.d.wares.sort((a, b) => b.v - a.v).map(w => `${w.dir === 'in' ? '↓' : '↑'} ${esc(Game.wareName(w.id))} ${fmt(w.v)}`).join(', ');
      const sel = x.cand.length ? `<select data-lgship="${x.g.id}">${x.cand.map(s => `<option value="${esc(s.macro)}" ${x.ship === s ? 'selected' : ''}>${esc(Ships.api.shipName(s))} · ${fmt(x.g.salvage ? hold(s) : s.cargo[x.g.transport])} м³</option>`).join('')}</select>` : '<span class="warn">нет кораблей</span>';
      const note = x.g.salvage ? `<div class="small">по кораблю на каждый модуль первичной переработки (${x.proc})</div>` : x.g.mine && x.d.out ? '<div class="small warn">излишек этого сырья шахтёры не вывозят</div>' : '';
      const inout = x.g.mine ? `ввоз ${fmt(x.d.in)} м³/ч` : `ввоз ${fmt(x.d.in)} · вывоз ${fmt(x.d.out)} м³/ч`;
      return `<div class="lgcard">
        <div class="lghead"><b>${esc(x.g.name)}</b><span class="lgneed">нужно <b>${x.n}</b>${x.price ? ` · ${fmt(x.price)} Кр` : ''}</span></div>
        <div class="small">${inout}${x.perShip ? ` · загрузка ${fmt(x.vol / x.perShip * 100 / Math.max(1, x.n))}%` : ''}</div>
        <div class="lgctl">${sel}${x.g.salvage ? '' : `<label>рейс, мин <input type="number" min="1" max="600" step="1" value="${esc(x.trip)}" data-lgtrip="${x.g.id}" title="Минут на рейс туда и обратно (у шахтёра — с добычей)"></label>`}</div>
        <div class="small lgwares">${wares} м³/ч</div>${note}</div>`;
    }).join('');
    el.innerHTML = head + `<div class="filters">
        <label>раса <select id="lgRace">${races.sort((a, b) => Game.raceName(a).localeCompare(Game.raceName(b))).map(r => `<option value="${esc(r)}" ${r === race ? 'selected' : ''}>${esc(Game.raceName(r))}</option>`).join('')}</select></label>
        <label>размер <select id="lgSize">${Object.entries(SIZES).map(([k, v]) => `<option value="${k}" ${o.size === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
      ${body}
      <p class="small">Оценка: корабль за рейс перевозит полный трюм; время рейса зависит от расстояний в вашем секторе — поправьте его.
        Грузовики считаются по большему из ввоза и вывоза. Цена — корпус без оснащения${total ? `, всего ≈ ${fmt(total)} Кр` : ''}.</p>`;
  }

  // events (from ui.js); true when handled
  function click(t, st) {
    if (t.closest('[data-lgtoggle]')) { const o = opts(st); o.open = !o.open; return true; }
    return false;
  }
  function change(t, st) {
    const o = opts(st);
    if (t.id === 'lgRace') { o.race = t.value; o.ship = {}; return true; }
    if (t.id === 'lgSize') { o.size = t.value; o.ship = {}; return true; }
    if (t.dataset.lgship) { o.ship[t.dataset.lgship] = t.value; return true; }
    if (t.dataset.lgtrip) { o.trip[t.dataset.lgtrip] = Math.max(1, Number(t.value) || 1); return true; }
    return false;
  }

  return { render, click, change, compute };
})();
