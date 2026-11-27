/*
  X4 Builder Web - station expanding (the original's form_StationExpanding / module_Station.SetStationExpanding).
  Repeated until nothing is missing (StationHasExpanding):
   - habitation: the workforce the production needs; only the largest (L) habitation of the chosen race, as many as
     cover it, rounded up (the original picked the size that fits the rest);
   - resources: every enabled ware with a negative balance gets ceil(deficit / output of one module) modules of its
     factory for the chosen method; one module's output = trunc(amount * 3600 / (sum of the queue's times) * queue), * (1 + work product)
     when the workforce is expanded too (SetWaresExpanding). The list is the deficit wares, their inputs down the chain
     and the workforce food (ExpandingResources / ExpandingWareResources);
   - storages: per transport, the capacity must hold one hour of the gross production (or consumption) volume of the
     wares of that transport (GetStationCargos limit_volume >= 1); only the largest (L) storage of the chosen race, rounded
     up (the original picked the size that fits the rest).
*/
'use strict';

const Expand = (() => {
  // modules of a class by race, one per capacity (NormalizeExpendingCollection), sorted by capacity
  function habitations(race) {
    const byCap = new Map();
    for (const m of Game.D.modules.values()) {
      // plain habitation modules: not landmarks (unique spires and the like)
      if (m.class !== 'habitation' || m.habRace !== race || !m.habCapacity || /landmark/.test(m.macro)) continue;
      if (!byCap.has(m.habCapacity) || (byCap.get(m.habCapacity).ext && !m.ext)) byCap.set(m.habCapacity, m);
    }
    // only the largest (size L): the count is rounded up to whole L modules (the player, 2026-11-16: "не подбирать
    // объёмы жилых и складов, округлять до размера L")
    return [...byCap.values()].sort((a, b) => a.habCapacity - b.habCapacity).slice(-1);
  }
  function storages(race, transport) {
    const byCap = new Map();
    for (const m of Game.D.modules.values()) {
      if (m.class !== 'storage' || !m.cargoTags || !m.cargoTags.split(/\s+/).includes(transport)) continue;
      if (race && m.makerrace !== race) continue;
      if (/landmark|tradestation/.test(m.macro)) continue; // plain storages, not those of trading stations
      if (!byCap.has(m.cargoMax)) byCap.set(m.cargoMax, m);
    }
    return [...byCap.values()].sort((a, b) => a.cargoMax - b.cargoMax).slice(-1); // only the largest (L), as habitations
  }
  function habRaces() {
    const s = new Set();
    for (const m of Game.D.modules.values()) if (m.class === 'habitation' && m.habRace) s.add(m.habRace);
    return [...s];
  }
  function storageRaces() {
    const s = new Set();
    for (const m of Game.D.modules.values()) if (m.class === 'storage' && m.makerrace) s.add(m.makerrace);
    return [...s];
  }

  // the race of a module: its makerrace, else the race part of the macro name (dock macros have no makerrace)
  const PREFIX = { arg: 'argon', tel: 'teladi', par: 'paranid', spl: 'split', ter: 'terran', atf: 'terran', bor: 'boron', xen: 'xenon', kha: 'khaak', pir: 'pirate' };
  const raceOf = m => m.makerrace || PREFIX[(m.macro.match(/^[a-z]+_([a-z]{3})_/) || [])[1]] || null;
  // docks and piers of a race (or any), with their landing pads (gamedata moduleParts)
  function dockModules(race, kind) {
    return [...Game.D.modules.values()].filter(m => (kind === 'pier' ? m.class === 'pier' : m.class === 'dockarea') && m.parts && !/landmark|tradestation|_hq_/.test(m.macro)
      && (!race || raceOf(m) === race) && (kind === 'pier' ? (m.parts.docks.dock_l || m.parts.docks.dock_xl) : m.parts.docks.dock_m))
      .sort((a, b) => a.price.avg - b.price.avg);
  }
  function dockRaces() {
    const s = new Set();
    for (const m of Game.D.modules.values()) if ((m.class === 'dockarea' || m.class === 'pier') && raceOf(m)) s.add(raceOf(m));
    return [...s];
  }
  // the factory of a ware for a method: a production module whose queue makes it with that method
  function factory(wareId, method) {
    let best = null;
    for (const m of Game.D.modules.values()) {
      if (!m.isProduction) continue;
      // the production the module really uses (a queue method the ware does not have falls back to default, as the game)
      const q = m.queue.find(x => { if (x.ware !== wareId) return false; const p = Game.production(x.ware, x.method); return p && p.method === (method || 'default'); });
      if (!q) continue;
      // a single-ware module first, then without an extension
      const score = (m.queue.length === 1 ? 0 : 2) + (m.ext ? 1 : 0);
      if (!best || score < best.score) best = { m, score };
    }
    return best ? best.m : null;
  }
  function methods(wareId) {
    const w = Game.D.wares.get(wareId);
    if (!w) return [];
    return w.productions.filter(p => factory(wareId, p.method)).map(p => p.method);
  }

  // storage need by transport (the player, 2026-11-20: the yard's modules stood still, their products had nowhere to go -
  // the game gives every ware its own share of a storage type, so one hour of the station's total flow was far too little):
  // the sum over the wares of HOURS of the ware's gross flow (the larger of what is made and used, so intermediates count
  // once with their full flow), at least STORE_MIN m3 a ware; and for a transport brought in by ships (a ware of it with
  // a deficit: ore, gas, ice, scrap, bought wares) room for two full holds of a large ship (a miner L unloads ~60 000 m3
  // at once - the yard's gas miners could not unload into 31 000 free)
  const STORE_MIN = 5000, HOLD_RESERVE = 2 * 62000;
  const storeHours = st => (st && st.storageHours > 0 ? st.storageHours : 3);
  function storageDemand(r, hours = 3) {
    const need = new Map(), inbound = new Set();
    for (const b of r.balance.values()) {
      if (!b.transport || b.transport === 'workunit') continue;
      const flow = Math.max(b.produced || 0, b.consumed || 0) * (b.volume || 1);
      if (!flow) continue;
      need.set(b.transport, (need.get(b.transport) || 0) + Math.max(flow * hours, STORE_MIN));
      if (b.net < 0) inbound.add(b.transport);
    }
    for (const t of inbound) need.set(t, need.get(t) + HOLD_RESERVE);
    return need;
  }

  // the options of the dialog for a station: deficit wares and their chains, food, transports
  function options(st, prev) {
    const r = Planner.calcStation(st, 3600);
    const res = new Map();
    const firstRace = r.races[0] ? r.races[0].race : 'argon';
    const keep = (id, ref) => {
      const w = Game.D.wares.get(id);
      if (!w || res.has(id) || !methods(id).length) return;
      const p = prev && prev.resources.get(id);
      const ms = methods(id);
      const def = ms.includes(Game.D.wares.get(id) && raceMethodId(id, firstRace)) ? raceMethodId(id, firstRace) : (ms.includes('default') ? 'default' : ms[0]);
      res.set(id, { id, ref, enabled: p ? p.enabled : true, method: p && ms.includes(p.method) ? p.method : def, methods: ms });
      const prod = Game.production(id, res.get(id).method);
      if (prod) for (const x of prod.primary) keep(x.ware, ref);
    };
    for (const b of r.balance.values()) if (b.net < 0) keep(b.id, null);
    // Kha'ak alloy for a station with build modules (shipyard, wharf, equipment dock: they trade it as a ship construction
    // ware, md.InitUniverse / basket construction_ships): its recycling modules and their chain (the player, 2026-11-19)
    const build = st.modules.some(sm => sm.enabled !== false && (Game.D.modules.get(sm.macro) || {}).class === 'buildmodule');
    const alloyMod = factory('khaakalloy', 'recycling');
    const alloy = build && alloyMod ? { on: prev && prev.alloy ? prev.alloy.on : true, n: prev && prev.alloy ? prev.alloy.n : 1, macro: alloyMod.macro } : null;
    if (alloy) {
      const p = Game.production('khaakalloy', 'recycling');
      if (p) for (const x of p.primary) keep(x.ware, 'alloy');
      // it is transmutable: the yard may build any part of a ship from it (subtract_build_resources allowtransmute; the
      // rate is in the engine) - estimate by value: the modules that would replace all resources of the ordered ships
      // (shipbuild.js st.shipDemand, per hour)
      const w = Game.D.wares.get('khaakalloy');
      if (p && w && w.price.avg && st.shipOrders && st.shipOrders.length && st.shipDemand && st.shipDemand.wares) {
        let value = 0;
        for (const [id, a] of Object.entries(st.shipDemand.wares)) { const x = Game.D.wares.get(id); if (x) value += a * x.price.avg; }
        const work = p.effects.find(e => e.type === 'work');
        const out = Math.trunc(p.amount * (1 + (work ? work.product : 0))) * (3600 / p.time);
        if (value > 0 && out > 0) { alloy.full = Math.ceil(value / (w.price.avg * out)); alloy.value = value; }
      }
    }
    // the food of the chosen race only (ExpandingResources: the workforce method's wares)
    const habRace = prev ? prev.habRace : firstRace;
    const food = Game.raceMethod('workunit_busy', habRace);
    if (food) for (const x of food.primary) keep(x.ware, 'workforce');
    const transports = new Set([...storageDemand(r, storeHours(st)).keys()]);
    for (const [id, x] of res) {
      const ids = [id, ...((Game.production(id, x.method) || { primary: [] }).primary.map(p => p.ware))];
      for (const i of ids) { const w = Game.D.wares.get(i); if (w && w.transport && w.transport !== 'workunit') transports.add(w.transport); }
    }
    return {
      alloy,
      // build modules for the ordered ships (shipbuild.js), then their resources by the chains below
      shipMods: typeof ShipBuild !== 'undefined' && (st.shipOrders || []).length ? { on: prev && prev.shipMods ? prev.shipMods.on : true, list: ShipBuild.missingModules(st) } : null,
      workforce: prev ? prev.workforce : true,
      habRace,
      resourcesOn: prev ? prev.resourcesOn : true,
      resources: res,
      storagesOn: prev ? prev.storagesOn : true,
      storageHours: prev && prev.storageHours ? prev.storageHours : storeHours(st),
      // docking: a dock with M / S pads and a pier for L / XL traders when the station has none
      dockOn: prev ? prev.dockOn : true,
      pierOn: prev ? prev.pierOn : true,
      dockRace: prev ? prev.dockRace : (dockRaces().includes(firstRace) ? firstRace : 'argon'),
      storageRace: prev ? prev.storageRace : (storageRaces().includes(firstRace) ? firstRace : 'argon'),
      transports: [...transports].filter(t => t !== 'condensate').map(t => ({ id: t, enabled: prev && prev.transportsOff && prev.transportsOff.has(t) ? false : true })),
    };
  }
  function raceMethodId(wareId, race) {
    const w = Game.D.wares.get(wareId);
    if (!w) return null;
    const p = w.productions.find(p => Game.D.methodRace.get(p.method) === race || p.method === race);
    return p ? p.method : null;
  }

  // greedy pick from a sorted list by capacity: the first that covers what is left, else the largest one not above it
  function pick(list, cap, left) {
    for (let i = 0; i < list.length; i++) {
      if (cap(list[i]) >= left || i === list.length - 1 || cap(list[i + 1]) > left) return list[i];
    }
    return list[list.length - 1];
  }

  const fmtPct = v => Math.round(v * 1000) / 10;

  // run on a copy: returns {added: Map(macro -> count), station: the expanded copy, notes}
  function run(st, opt) {
    const work = JSON.parse(JSON.stringify(st));
    const added = new Map();
    const notes = [];
    const add = (m, n = 1) => { if (n <= 0) return; Planner.addModule(work, m.macro, n); added.set(m.macro, (added.get(m.macro) || 0) + n); };
    const habs = opt.workforce ? habitations(opt.habRace) : [];
    if (opt.workforce && !habs.length) notes.push(`Нет жилых модулей расы ${Game.raceName(opt.habRace)}`);
    const doHabs = () => {
      if (!habs.length) return false;
      let r = Planner.calcStation(work, 3600), changed = false, guard = 0;
      let left = r.need - r.capacity;
      while (left > 0 && guard++ < 200) {
        const h = pick(habs, x => x.habCapacity, left);
        add(h); left -= h.habCapacity; changed = true;
      }
      if (opt.workforce) work.workers = null; // as the original: the workforce = the need
      return changed;
    };
    // the build modules the ordered ships need (shipbuild.js), first: the ships' resources are in the balance already
    if (opt.shipMods && opt.shipMods.on) for (const [mac, n] of ShipBuild.missingModules(work)) { const m = Game.D.modules.get(mac); if (m) add(m, n); }
    // Kha'ak alloy: at least opt.alloy.n recycling modules (the ones already there count)
    if (opt.alloy && opt.alloy.on) {
      const have = (work.modules.find(x => x.macro === opt.alloy.macro) || { count: 0 }).count;
      const m = Game.D.modules.get(opt.alloy.macro);
      if (m && opt.alloy.n > have) add(m, opt.alloy.n - have);
    }
    let iter = 0, changed = true;
    const refreshLoadout = () => { if (typeof StationLoadout !== 'undefined' && StationLoadout.ready()) StationLoadout.compute(work); };
    while (changed && iter++ < 60) {
      changed = false;
      if (iter === 1 && opt.workforce) changed = doHabs() || changed;
      if (opt.resourcesOn) {
        refreshLoadout();
        const r = Planner.calcStation(work, 3600);
        for (const res of opt.resources.values()) {
          if (!res.enabled) continue;
          const b = r.balance.get(res.id);
          if (!b || b.net >= 0) continue;
          const m = factory(res.id, res.method);
          const p = Game.production(res.id, res.method);
          if (!m || !p || !p.time) continue;
          // the output of one module as Planner.calcStation: efficiency = hull * (1 + work effect) (* sunlight for wares
          // with a sunlight effect), product = trunc(amount * efficiency) * cycles * queue amount; the work effect in
          // full when the workforce is planned (workers = the need)
          const hull = (work.hull == null ? 100 : work.hull) / 100, sun = (work.sunlight == null ? 100 : work.sunlight) / 100;
          let eff = hull;
          if (opt.workforce) for (const e of p.effects) if (e.type === 'work') eff = hull * (1 + e.product);
          if (p.effects.some(e => e.type === 'sunlight')) eff *= sun;
          // cycles as Planner: the module makes its queue's wares one after another, so the hour is divided by the sum of
          // the queue's production times (not by this ware's alone), and the queue item's amount wins over the method's
          const prods = m.queue.map(q => ({ q, p: Game.production(q.ware, q.method) })).filter(x => x.p);
          const sumTime = prods.reduce((s, x) => s + x.p.time, 0) || p.time;
          const own = prods.find(x => x.q.ware === res.id);
          const amount = own && own.q.amount != null ? own.q.amount : p.amount;
          const out = Math.trunc(amount * eff) * (3600 / sumTime) * (m.queueAmount || 1);
          if (out <= 0) {
            const note = `«${Game.wareName(res.id)}»: ${Game.moduleName(m.macro)} ничего не производит (солнце ${fmtPct(sun)}%, корпус ${fmtPct(hull)}%), модули не добавлены`;
            if (!notes.includes(note)) notes.push(note);
            continue;
          }
          add(m, Math.max(1, Math.ceil(-b.net / out)));
          changed = true;
        }
      }
      if (opt.workforce) changed = doHabs() || changed;
      if (opt.storagesOn) {
        const r = Planner.calcStation(work, 3600);
        const need = storageDemand(r, opt.storageHours || storeHours(work));
        // every transport the station has now (new inputs such as ore or ice appear while expanding), unless switched off
        const off = opt.transportsOff || new Set(opt.transports.filter(t => !t.enabled).map(t => t.id));
        for (const t of [...need.keys()].filter(k => k !== 'condensate' && !off.has(k)).map(id => ({ id, enabled: true }))) {
          const demand = need.get(t.id) || 0;
          const cap = r.storage.get(t.id) || 0;
          if (cap >= demand && cap > 0) continue;
          let list = storages(opt.storageRace, t.id);
          if (!list.length) list = storages(null, t.id);
          if (!list.length) { notes.push(`Нет складов для «${t.id}»`); off.add(t.id); continue; }
          let left = Math.max(demand - cap, 1), guard = 0;
          while (left > 0 && guard++ < 200) { const s = pick(list, x => x.cargoMax, left); add(s); left -= s.cargoMax; }
          changed = true;
        }
      }
    }
    if (iter >= 60) notes.push('Расчёт остановлен после 60 шагов: проверьте цепочку товаров.');
    // as ApplyStationExpanding: the habitations and storages added step by step are packed again from the final need
    const repack = cls => {
      for (const [mac, n] of [...added]) {
        const m = Game.D.modules.get(mac);
        if (!m || m.class !== cls) continue;
        const sm = work.modules.find(x => x.macro === mac);
        sm.count -= n; if (sm.count <= 0) work.modules.splice(work.modules.indexOf(sm), 1);
        added.delete(mac);
      }
    };
    if (opt.workforce && habs.length) {
      repack('habitation');
      const r = Planner.calcStation(work, 3600);
      let left = r.need - r.capacity, guard = 0;
      while (left > 0 && guard++ < 200) { const h = pick(habs, x => x.habCapacity, left); add(h); left -= h.habCapacity; }
    }
    if (opt.storagesOn) {
      repack('storage');
      const r = Planner.calcStation(work, 3600);
      const need = storageDemand(r, opt.storageHours || storeHours(work));
      const off = opt.transportsOff || new Set(opt.transports.filter(t => !t.enabled).map(t => t.id));
      for (const [t, demand] of need) {
        if (t === 'condensate' || off.has(t)) continue;
        const cap = r.storage.get(t) || 0;
        if (cap >= demand && cap > 0) continue;
        let list = storages(opt.storageRace, t);
        if (!list.length) list = storages(null, t);
        if (!list.length) continue;
        let left = Math.max(demand - cap, 1), guard = 0;
        while (left > 0 && guard++ < 200) { const x = pick(list, y => y.cargoMax, left); add(x); left -= x.cargoMax; }
      }
    }
    // docking (the player, 2026-11-16: not one dock and one pier, but places for the ships the station needs and a
    // reserve for other ships): the freighters and miners of the logistics block (logistics.js: its ship size and
    // trip times) - an M ship needs an M pad (S pads are not counted), an L ship an L/XL place - plus DOCK_RESERVE M pads and PIER_RESERVE L/XL
    // places for traders that come to buy and sell; at least one of each. Without the ship data loaded: one of each.
    const DOCK_RESERVE = 2, PIER_RESERVE = 1;
    const pads = () => { const r = Planner.calcStation(work, 3600); return r.parts.docks; };
    let needM = 0, needL = 0;
    if (typeof Logistics !== 'undefined' && typeof Ships !== 'undefined' && Ships.api.loaded) {
      for (const x of Logistics.compute(work)) {
        if (!x.ship || !x.n) continue;
        if (x.ship.class === 'ship_m' || x.ship.class === 'ship_s') needM += x.n; else needL += x.n;
      }
    } else notes.push('Данные кораблей не загружены: доки и причалы по одному (откройте блок «Грузовики, шахтёры и буксиры»)');
    needM = Math.max(1, needM + DOCK_RESERVE);
    needL = Math.max(1, needL + PIER_RESERVE);
    const fill = (kind, have, need, msg) => {
      let list = dockModules(opt.dockRace, kind).length ? dockModules(opt.dockRace, kind) : dockModules(null, kind);
      // docks: the most M pads first (a 1M6S dock is mostly S pads - trade does not come in S ships), then the cheapest
      if (kind === 'dock') list = list.slice().sort((a, b) => (b.parts.docks.dock_m || 0) - (a.parts.docks.dock_m || 0) || a.price.avg - b.price.avg);
      if (!list[0]) { notes.push(msg); return; }
      let guard = 0;
      while (have() < need && guard++ < 100) add(list[0]);
    };
    if (opt.dockOn) {
      fill('dock', () => (pads().dock_m || 0), needM, 'Не найден док с местами M');
      notes.push(`Доки: мест M нужно ${needM} (кораблей M станции ${needM - DOCK_RESERVE > 0 ? needM - DOCK_RESERVE : 0} + запас ${DOCK_RESERVE})`);
    }
    if (opt.pierOn) {
      fill('pier', () => { const d = pads(); return (d.dock_l || 0) + (d.dock_xl || 0); }, needL, 'Не найден причал для L/XL');
      notes.push(`Причалы: мест L/XL нужно ${needL} (кораблей L станции ${needL - PIER_RESERVE > 0 ? needL - PIER_RESERVE : 0} + запас ${PIER_RESERVE})`);
    }
    refreshLoadout();
    return { added, station: work, notes };
  }

  return { options, run, habRaces, storageRaces, dockRaces, methods, factory, storageDemand, storeHours };
})();
