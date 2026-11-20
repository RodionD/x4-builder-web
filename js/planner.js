/*
  X4 Builder Web - station calculation, as the original's module_Station.SetStationCalculation / SetStationBalance,
  module_modules.GetProductionModuleBalance / GetFabricProductionEffects_New and module_Station.GetFoodConsumption:
   - workforce need = sum of <workforce max> of enabled production / build modules; capacity = sum of habitation
     <workforce capacity> by race; workers = the player's figure (default: need, at most the capacity);
     effect = min(1, round(workers / need, 6));
   - a production module makes the wares of its queue one after another: cycles per period = period / sum of their
     production times; product = trunc(amount * efficiency) * cycles * queue amount, efficiency = hull state *
     (1 + work effect product * workforce effect) (* sunlight for wares with a sunlight effect); resources =
     ceil(amount * cycles * queue amount) (no efficiency);
   - food: per race, the workunit_busy production of that race: resource = ceil(round(amount / (prod amount / workers /
     (period / prod time)), 5)).
  Workers are spread over the races up to each race's capacity, one by one (SetStationWorkforces).
*/
'use strict';

const Planner = (() => {
  const uid = () => Math.random().toString(36).slice(2, 10);

  function newStation(name) {
    return { id: uid(), name: name || 'Станция', modules: [], workers: null, sunlight: 100, hull: 100 };
  }
  function newComplex(name) {
    return { id: uid(), name: name || 'Комплекс', stations: [newStation('Станция 1')], created: Date.now() };
  }

  // ---------- clean-up of complexes from a JSON file or localStorage ----------
  // only the known fields, of the right types (numbers via Number() with defaults, strings via String()): a file may hold
  // anything, and its values go into the page's HTML and into the calculation
  const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
  const numOr = (v, d, lo = -Infinity, hi = Infinity) => { const n = Number(v); return v == null || v === '' || !isFinite(n) ? d : Math.min(hi, Math.max(lo, n)); };
  const strOr = (v, d) => (v == null || isObj(v) || Array.isArray(v) ? d : String(v));
  const numMap = v => { const o = {}; if (isObj(v)) for (const [k, x] of Object.entries(v)) { const n = Number(x); if (isFinite(n)) o[k] = n; } return o; };
  const strMap = v => { const o = {}; if (isObj(v)) for (const [k, x] of Object.entries(v)) if (x != null && !isObj(x)) o[k] = String(x); return o; };
  const idOr = v => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : uid()); // ids go into data-* attributes as they are
  const prices = v => ({ min: numOr(v && v.min, 0), avg: numOr(v && v.avg, 0), max: numOr(v && v.max, 0) });
  function normStation(s, i) {
    if (!isObj(s)) return null;
    const st = {
      id: idOr(s.id), name: strOr(s.name, 'Станция ' + (i + 1)),
      modules: (Array.isArray(s.modules) ? s.modules : []).filter(m => isObj(m) && m.macro != null && !isObj(m.macro))
        .map(m => ({ macro: String(m.macro), count: Math.floor(numOr(m.count, 1, 0)), enabled: m.enabled !== false })),
      workers: numOr(s.workers, null, 0) == null ? null : Math.floor(numOr(s.workers, null, 0)), // not a number: the default (the need)
      sunlight: numOr(s.sunlight, 100, 0), hull: numOr(s.hull, 100, 0, 100),
    };
    if (s.layoutOn === false) st.layoutOn = false;
    if (s.connRace != null) st.connRace = strOr(s.connRace, null);
    if (s.sector != null) st.sector = strOr(s.sector, '');
    if (isObj(s.loadout)) st.loadout = { mode: ['none', 'mk1', 'mk2', 'best'].includes(s.loadout.mode) ? s.loadout.mode : 'none', race: strOr(s.loadout.race, 'argon'), ...(s.loadout.missile != null ? { missile: s.loadout.missile !== false } : {}), ...(s.loadout.misRate != null ? { misRate: numOr(s.loadout.misRate, 0, 0) } : {}), ...(s.loadout.droneRate != null ? { droneRate: numOr(s.loadout.droneRate, 0, 0) } : {}) };
    if (s.shipOpen) st.shipOpen = true;
    if (Array.isArray(s.shipOrders)) st.shipOrders = s.shipOrders.filter(o => isObj(o) && o.macro != null && !isObj(o.macro))
      .map(o => ({ macro: String(o.macro), perDay: numOr(o.perDay, 1, 0), loadout: ['hull', 'mk1', 'best'].includes(o.loadout) ? o.loadout : 'mk1' }));
    // the computed ship demand and the station's loadout (ShipBuild.compute / StationLoadout.compute redo them; kept so
    // that the balance and the plan have them before the ship and weapon data are loaded)
    if (isObj(s.shipDemand)) st.shipDemand = { wares: numMap(s.shipDemand.wares), need: numMap(s.shipDemand.need), busy: numMap(s.shipDemand.busy), detail: [] };
    if (isObj(s.loadoutCalc)) {
      const pm = {};
      if (isObj(s.loadoutCalc.perModule)) for (const [mac, groups] of Object.entries(s.loadoutCalc.perModule)) {
        if (!Array.isArray(groups)) continue;
        pm[mac] = groups.filter(isObj).map(g => ({ group: strOr(g.group, ''), shield: strOr(g.shield, null), turret: strOr(g.turret, null),
          shieldN: numOr(g.shieldN, 0, 0), turretN: numOr(g.turretN, 0, 0) }));
      }
      st.loadoutCalc = { perModule: pm, wares: numMap(s.loadoutCalc.wares), price: prices(s.loadoutCalc.price), count: numMap(s.loadoutCalc.count), missileTurrets: numOr(s.loadoutCalc.missileTurrets, 0, 0) };
    }
    if (isObj(s.logistics)) {
      const o = s.logistics;
      st.logistics = { open: !!o.open, size: strOr(o.size, 'ship_l'), trip: {}, ship: strMap(o.ship) };
      for (const [k, v] of Object.entries(numMap(o.trip))) if (v >= 1) st.logistics.trip[k] = v;
      if (o.race != null) st.logistics.race = strOr(o.race, null);
    }
    return st;
  }
  // a complex (or null when it is not one); the ids are kept (Ui gives new ones to imported complexes)
  function normComplex(c) {
    if (!isObj(c) || !Array.isArray(c.stations)) return null;
    const out = { id: idOr(c.id), name: strOr(c.name, 'Комплекс'), stations: c.stations.map(normStation).filter(Boolean), created: numOr(c.created, Date.now()) };
    if (!out.stations.length) out.stations.push(newStation('Станция 1'));
    return out;
  }

  function addModule(st, macro, count = 1) {
    const ex = st.modules.find(m => m.macro === macro);
    if (ex) ex.count += count;
    else st.modules.push({ macro, count, enabled: true });
  }

  function addWare(bal, id, amount, kind) {
    if (!amount) return;
    let b = bal.get(id);
    if (!b) { b = { id, produced: 0, consumed: 0, food: 0 }; bal.set(id, b); }
    if (kind === 'p') b.produced += amount;
    else if (kind === 'f') { b.consumed += amount; b.food += amount; }
    else if (kind === 'b') { b.consumed += amount; b.build = (b.build || 0) + amount; }
    else b.consumed += amount;
  }

  // spread workers over races, one at a time, up to each race's capacity (as SetStationWorkforces)
  function spread(total, races) {
    const out = {};
    for (const r of races) out[r.race] = 0;
    let left = total, moved = true;
    while (left > 0 && moved) {
      moved = false;
      // whole rounds at once for speed: the smallest room left among races that still have room
      const open = races.filter(r => out[r.race] < r.capacity);
      if (!open.length) break;
      const room = Math.min(...open.map(r => r.capacity - out[r.race]));
      const step = Math.max(1, Math.min(room, Math.floor(left / open.length)));
      for (const r of open) {
        if (left <= 0) break;
        const add = Math.min(step, r.capacity - out[r.race], left);
        if (add > 0) { out[r.race] += add; left -= add; moved = true; }
      }
    }
    return out;
  }

  function calcStation(st, period = 3600) {
    const D = Game.D;
    const r = {
      need: 0, capacity: 0, races: [], workers: 0, effect: 0, modules: [], balance: new Map(),
      storage: new Map(), buildcost: new Map(), buildtime: 0, price: { min: 0, avg: 0, max: 0 }, counts: {}, missing: [],
      volumes: new Map(),
      parts: { turret: {}, shield: {}, docks: {}, dockCapacity: {}, drones: 0 },
    };
    const hull = (st.hull == null ? 100 : st.hull) / 100;
    const sun = (st.sunlight == null ? 100 : st.sunlight) / 100;
    const raceCap = new Map();
    for (const sm of st.modules) {
      const m = D.modules.get(sm.macro);
      if (!m) { r.missing.push(sm.macro); continue; }
      const n = sm.count || 0;
      r.counts[m.class] = (r.counts[m.class] || 0) + n;
      // build cost counts every module, enabled or not
      for (const w of m.buildcost.wares) r.buildcost.set(w.ware, (r.buildcost.get(w.ware) || 0) + w.amount * n);
      r.buildtime += (m.buildcost.time || 0) * n;
      r.price.min += m.price.min * n; r.price.avg += m.price.avg * n; r.price.max += m.price.max * n;
      if (!sm.enabled) continue;
      // turrets, shields, docking places and drone capacity of the enabled modules
      if (m.parts) {
        for (const k of ['turret', 'shield', 'docks', 'dockCapacity']) for (const [z, v] of Object.entries(m.parts[k])) r.parts[k][z] = (r.parts[k][z] || 0) + v * n;
        r.parts.drones += m.parts.drones * n;
      }
      if (m.isProduction || m.class === 'buildmodule') r.need += m.workforceMax * n;
      if (m.class === 'habitation' && m.habRace) {
        raceCap.set(m.habRace, (raceCap.get(m.habRace) || 0) + m.habCapacity * n);
        r.capacity += m.habCapacity * n;
      }
      if (m.cargoMax && m.cargoTags) {
        for (const t of m.cargoTags.split(/\s+/)) r.storage.set(t, (r.storage.get(t) || 0) + m.cargoMax * n);
      }
    }
    r.races = [...raceCap].map(([race, capacity]) => ({ race, capacity }));
    // workers: the player's figure, else as the original's default (the need, at most the capacity)
    let workers = st.workers == null ? Math.min(r.need, r.capacity) : st.workers;
    workers = Math.max(0, Math.min(workers, r.capacity));
    r.workers = workers;
    r.effect = r.need ? Math.min(1, Math.round((workers / r.need) * 1e6) / 1e6) : 0;
    r.spread = spread(workers, r.races);

    for (const sm of st.modules) {
      const m = D.modules.get(sm.macro);
      if (!m || !sm.enabled || !m.isProduction) continue;
      const n = sm.count || 0;
      const prods = m.queue.map(q => ({ q, p: Game.production(q.ware, q.method) })).filter(x => x.p);
      const sumTime = prods.reduce((s, x) => s + x.p.time, 0);
      if (!sumTime) continue;
      const cycles = period / sumTime;
      const qa = m.queueAmount || 1;
      const mod = { macro: m.macro, count: n, wares: [] };
      for (const { q, p } of prods) {
        let work = -1, sunl = -1;
        for (const e of p.effects) {
          if (e.type === 'work') work = Math.round(e.product * Math.round(r.effect * 1e6) / 1e6 * 1e6) / 1e6;
          else if (e.type === 'sunlight') sunl = sun;
        }
        let eff = work === -1 ? hull : hull * (1 + work);
        if (sunl !== -1) eff *= sunl;
        const amount = (q.amount != null ? q.amount : p.amount);
        const made = Math.trunc(amount * eff) * cycles * qa * n;
        addWare(r.balance, q.ware, made, 'p');
        mod.wares.push({ ware: q.ware, method: p.method, made, eff, time: p.time });
        for (const list of [p.primary, p.secondary]) for (const res of list) {
          const need = Math.ceil(Math.round(res.amount * cycles * qa * 1e9) / 1e9) * n;
          addWare(r.balance, res.ware, need, 'c');
        }
      }
      r.modules.push(mod);
    }
    // food and medicine of the workforce
    r.food = [];
    for (const [race, v] of Object.entries(r.spread)) {
      if (!v) continue;
      const p = Game.raceMethod('workunit_busy', race);
      if (!p || !p.amount) continue;
      const per = p.amount / v / (period / p.time);
      for (const res of p.primary) {
        const amt = Math.ceil(Math.round((res.amount / per) * 1e5) / 1e5);
        addWare(r.balance, res.ware, amt, 'f');
        r.food.push({ race, workers: v, ware: res.ware, amount: amt });
      }
    }
    // ship building (shipbuild.js keeps st.shipDemand: resources per hour of the ordered ships); only while there are
    // orders: the demand of the last removed order stays in st.shipDemand until the next compute
    if (st.shipOrders && st.shipOrders.length && st.shipDemand && st.shipDemand.wares) for (const [w, a] of Object.entries(st.shipDemand.wares)) addWare(r.balance, w, Math.ceil(a * period / 3600), 'b');
    // the station's own missiles and defence drones (stationloadout.js supply: their build resources per hour)
    if (typeof StationLoadout !== 'undefined' && st.loadout && st.loadout.mode && st.loadout.mode !== 'none') for (const [w, a] of Object.entries(StationLoadout.supply(st))) addWare(r.balance, w, Math.ceil(a * period / 3600), 'b');
    // values and volumes
    r.value = { min: 0, avg: 0, max: 0 };
    for (const b of r.balance.values()) {
      const w = D.wares.get(b.id);
      b.net = b.produced - b.consumed;
      b.price = w ? w.price : { min: 0, avg: 0, max: 0 };
      b.transport = w ? w.transport : null;
      b.volume = w ? w.volume : 1;
      r.value.min += b.net * b.price.min; r.value.avg += b.net * b.price.avg; r.value.max += b.net * b.price.max;
      if (b.transport) {
        const v = r.volumes.get(b.transport) || { in: 0, out: 0 };
        if (b.net > 0) v.out += b.net * b.volume; else v.in += -b.net * b.volume;
        r.volumes.set(b.transport, v);
      }
    }
    // the station's turrets and shields (stationloadout.js keeps st.loadoutCalc): their resources and prices
    if (st.loadoutCalc) {
      for (const [w, a] of Object.entries(st.loadoutCalc.wares)) r.buildcost.set(w, (r.buildcost.get(w) || 0) + a);
      for (const k of ['min', 'avg', 'max']) r.price[k] += st.loadoutCalc.price[k] || 0;
    }
    r.buildvalue = { min: 0, avg: 0, max: 0 };
    for (const [id, a] of r.buildcost) {
      const w = D.wares.get(id);
      if (w) { r.buildvalue.min += a * w.price.min; r.buildvalue.avg += a * w.price.avg; r.buildvalue.max += a * w.price.max; }
    }
    return r;
  }

  function calcComplex(cx, period = 3600) {
    const res = cx.stations.map(s => calcStation(s, period));
    const total = { balance: new Map(), value: { min: 0, avg: 0, max: 0 }, buildvalue: { min: 0, avg: 0, max: 0 }, buildcost: new Map(), price: { min: 0, avg: 0, max: 0 } };
    for (const r of res) {
      for (const b of r.balance.values()) {
        const t = total.balance.get(b.id) || { id: b.id, produced: 0, consumed: 0, food: 0, price: b.price, transport: b.transport, volume: b.volume };
        t.produced += b.produced; t.consumed += b.consumed; t.food += b.food; if (b.build) t.build = (t.build || 0) + b.build; t.net = t.produced - t.consumed;
        total.balance.set(b.id, t);
      }
      for (const k of ['min', 'avg', 'max']) { total.value[k] += r.value[k]; total.buildvalue[k] += r.buildvalue[k]; total.price[k] += r.price[k]; }
      for (const [id, a] of r.buildcost) total.buildcost.set(id, (total.buildcost.get(id) || 0) + a);
    }
    return { stations: res, total };
  }

  return { newStation, newComplex, normComplex, addModule, calcStation, calcComplex, uid };
})();
