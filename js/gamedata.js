/*
  X4 Builder Web - game data: texts, races, wares (production methods), the macro index and the station modules.
  Same sources as the original (module_translate, module_ware, module_modules.load_Station_Module):
    t/0001-lNNN.xml, libraries/races.xml, libraries/wares.xml, index/macros.xml, the module macros under
    assets/structures/*, each kept only when a ware builds it (<component ref="macro"/>), as the original does.
*/
'use strict';

const Game = (() => {
  const D = {
    lang: '7',
    texts: new Map(),       // "page,id" -> raw text
    races: new Map(),       // id -> {id, name}
    factions: new Map(),    // id -> {id, name, short}
    wares: new Map(),       // id -> ware
    wareByComponent: new Map(), // macro name -> ware id
    groups: new Map(),      // ware group id -> {id, name, tier}
    users: new Map(),       // ware id -> [{ware, method, amount}] wares whose production takes it
    methodRace: new Map(),  // production method id -> race id
    macros: new Map(),      // macro name -> path (no .xml)
    components: new Map(),  // component name -> path (no .xml)
    modules: new Map(),     // macro name -> module
    log: [],
  };

  const log = m => { D.log.push(m); };

  // ---------- texts ----------
  async function loadTexts(lang, progress) {
    progress && progress(`Тексты (язык ${lang})`);
    D.texts = new Map();
    const add = doc => {
      if (!doc) return;
      for (const page of doc.getElementsByTagName('page')) {
        const pid = page.getAttribute('id');
        for (const t of page.getElementsByTagName('t')) D.texts.set(pid + ',' + t.getAttribute('id'), t.textContent);
      }
    };
    // Language-neutral base first, then English as fallback, then the chosen language over it
    add(await XmlDiff.loadPatched('t/0001.xml', log));
    if (lang !== '44') add(await XmlDiff.loadPatched('t/0001-l044.xml', log));
    add(await XmlDiff.loadPatched(`t/0001-l${lang.padStart(3, '0')}.xml`, log));
    D.lang = lang;
  }

  // "{page,id}" references (nested), "(comments)" removed, "\(" kept
  function text(s, depth = 0) {
    if (s == null) return '';
    s = String(s);
    if (depth > 8) return s;
    const out = s.replace(/\{\s*(\d+)\s*,\s*(\d+)\s*\}/g, (m, p, i) => {
      const t = D.texts.get(+p + ',' + +i);
      return t == null ? m : text(t, depth + 1);
    });
    if (depth > 0) return out;
    // remove (comments) that are not escaped
    let r = '', lvl = 0;
    for (let k = 0; k < out.length; k++) {
      const c = out[k];
      if (c === '\\' && k + 1 < out.length) { if (!lvl) r += out[k + 1] === 'n' ? '\n' : out[k + 1] === 't' ? '\t' : out[k + 1]; k++; continue; }
      if (c === '(') { lvl++; continue; }
      if (c === ')' && lvl) { lvl--; continue; }
      if (!lvl) r += c;
    }
    return r.trim();
  }

  // ---------- races / factions ----------
  async function loadRaces() {
    D.races = new Map();
    const doc = await XmlDiff.loadPatched('libraries/races.xml', log);
    if (doc) for (const r of doc.getElementsByTagName('race')) {
      D.races.set(r.getAttribute('id'), { id: r.getAttribute('id'), name: r.getAttribute('name') });
    }
    D.factions = new Map();
    const fd = await XmlDiff.loadPatched('libraries/factions.xml', log);
    if (fd) for (const f of fd.getElementsByTagName('faction')) {
      if (f.parentNode.tagName !== 'factions') continue;
      D.factions.set(f.getAttribute('id'), { id: f.getAttribute('id'), name: f.getAttribute('name'), short: f.getAttribute('shortname'), race: f.getAttribute('primaryrace'), el: f });
    }
  }

  // ---------- wares ----------
  const num = v => (v == null || v === '' ? null : Number(v));
  const wareList = el => [...el.children].filter(c => c.tagName === 'ware').map(c => ({ ware: c.getAttribute('ware'), amount: num(c.getAttribute('amount')) || 0 }));

  async function loadWares(progress) {
    progress && progress('Товары');
    D.wares = new Map(); D.wareByComponent = new Map(); D.methodRace = new Map();
    const doc = await XmlDiff.loadPatched('libraries/wares.xml', log);
    if (!doc) throw new Error('libraries/wares.xml не найден');
    const root = doc.documentElement;
    for (const p of root.children) {
      if (p.tagName !== 'production') continue;
      for (const m of p.getElementsByTagName('method')) {
        const d = m.getElementsByTagName('default')[0];
        D.methodRace.set(m.getAttribute('id'), d ? d.getAttribute('race') : null);
      }
    }
    D.groups = new Map();
    const gd = await XmlDiff.loadPatched('libraries/waregroups.xml', log);
    if (gd) for (const g of gd.getElementsByTagName('group')) D.groups.set(g.getAttribute('id'), { id: g.getAttribute('id'), name: g.getAttribute('name'), tier: num(g.getAttribute('tier')) || 99 });
    for (const w of root.children) {
      if (w.tagName !== 'ware') continue;
      const id = w.getAttribute('id');
      const price = w.getElementsByTagName('price')[0];
      const ware = {
        id, name: w.getAttribute('name'), shortname: w.getAttribute('shortname'), description: w.getAttribute('description'),
        group: w.getAttribute('group'), transport: w.getAttribute('transport'),
        volume: num(w.getAttribute('volume')) || 1, tags: (w.getAttribute('tags') || '').split(/\s+/).filter(Boolean),
        price: price ? { min: num(price.getAttribute('min')) || 0, avg: num(price.getAttribute('average')) || 0, max: num(price.getAttribute('max')) || 0 } : { min: 0, avg: 0, max: 0 },
        productions: [], owners: [], component: null, ext: w.getAttribute('_ext'), factories: [],
        illegal: (w.getAttribute('illegal') || '').split(/\s+/).filter(Boolean),
      };
      for (const c of w.children) {
        if (c.tagName === 'production') {
          const pr = {
            method: c.getAttribute('method') || 'default', time: num(c.getAttribute('time')) || 0, amount: num(c.getAttribute('amount')) || 0,
            name: c.getAttribute('name'), primary: [], secondary: [], effects: [], research: [],
          };
          for (const s of c.children) {
            if (s.tagName === 'primary') pr.primary = wareList(s);
            else if (s.tagName === 'secondary') pr.secondary = wareList(s);
            else if (s.tagName === 'effects') for (const e of s.children) pr.effects.push({ type: e.getAttribute('type'), product: num(e.getAttribute('product')) || 0 });
            else if (s.tagName === 'research') for (const e of s.children) if (e.getAttribute('ware')) pr.research.push(e.getAttribute('ware'));
          }
          ware.productions.push(pr);
        } else if (c.tagName === 'component') {
          ware.component = c.getAttribute('ref');
        } else if (c.tagName === 'owner') {
          ware.owners.push(c.getAttribute('faction'));
        } else if (c.tagName === 'illegal' && c.getAttribute('factions')) {
          ware.illegal.push(...c.getAttribute('factions').split(/\s+/).filter(Boolean));
        }
      }
      D.wares.set(id, ware);
      if (ware.component) D.wareByComponent.set(ware.component.toLowerCase(), id);
    }
    // who uses each ware (primary and secondary resources of every production)
    D.users = new Map();
    for (const w of D.wares.values()) for (const p of w.productions) for (const r of [...p.primary, ...p.secondary]) {
      if (!D.users.has(r.ware)) D.users.set(r.ware, []);
      D.users.get(r.ware).push({ ware: w.id, method: p.method, amount: r.amount, time: p.time });
    }
  }

  // the production of a ware by method, as module_ware.GetWareByMethod: the method, else "default", else the first
  function production(wareId, method) {
    const w = D.wares.get(wareId);
    if (!w || !w.productions.length) return null;
    return w.productions.find(p => p.method === (method || 'default')) || w.productions.find(p => p.method === 'default') || w.productions[0];
  }

  // the workforce food method of a race: the method whose <default race> is that race, else default
  function raceMethod(wareId, race) {
    const w = D.wares.get(wareId);
    if (!w) return null;
    for (const p of w.productions) if (D.methodRace.get(p.method) === race || p.method === race) return p;
    return production(wareId, 'default');
  }

  // ---------- macros ----------
  async function loadMacroIndex(progress) {
    progress && progress('Индекс макросов');
    D.macros = new Map();
    const doc = await XmlDiff.loadPatched('index/macros.xml', log);
    if (!doc) throw new Error('index/macros.xml не найден');
    for (const e of doc.getElementsByTagName('entry')) D.macros.set(e.getAttribute('name').toLowerCase(), e.getAttribute('value'));
  }

  async function loadComponentIndex() {
    D.components = new Map();
    const doc = await XmlDiff.loadPatched('index/components.xml', log);
    if (doc) for (const e of doc.getElementsByTagName('entry')) D.components.set(e.getAttribute('name').toLowerCase(), e.getAttribute('value'));
  }

  // turrets and shields: the component's connections tagged turret / shield with a size (SetDefenceParts);
  // docks: the macro's dockingbay connections by docksize, capacity (internal "storage" bays count only in capacity)
  // (SetDockParts); drones: <storage unit> of the macro
  const SIZES = ['extralarge', 'large', 'medium', 'small'];
  const partCache = new Map();
  async function readXml(path) {
    if (!path) return null;
    try { return await XmlDiff.loadPatched(path.replace(/\\/g, '/') + '.xml', log); } catch (e) { log(e.message); return null; }
  }
  async function componentParts(ref) {
    const key = 'c:' + ref;
    if (partCache.has(key)) return partCache.get(key);
    const p = (async () => {
      // groups: the slot groups of the plan's <upgrades> (group -> {shield, turret: {size, tags, count}})
      const out = { turret: {}, shield: {}, groups: {} };
      const doc = await readXml(D.components.get((ref || '').toLowerCase()));
      if (!doc) return out;
      for (const c of doc.getElementsByTagName('connection')) {
        const tags = ' ' + (c.getAttribute('tags') || '') + ' ';
        const kind = tags.includes(' shield') || /\bshield\b/.test(tags) ? 'shield' : (/\bturret\b/.test(tags) ? 'turret' : null);
        if (!kind) continue;
        const size = SIZES.find(z => new RegExp('\\b' + z + '\\b').test(tags));
        if (!size) continue;
        out[kind][size] = (out[kind][size] || 0) + 1;
        const g = (c.getAttribute('group') || '').trim(); // some components write "group01 " 
        if (g) {
          const gg = out.groups[g] = out.groups[g] || {};
          if (!gg[kind]) gg[kind] = { size, tags: tags.trim().split(/\s+/), count: 0 };
          gg[kind].count++;
        }
      }
      return out;
    })();
    partCache.set(key, p);
    return p;
  }
  async function dockbay(ref) {
    const key = 'd:' + ref;
    if (partCache.has(key)) return partCache.get(key);
    const p = (async () => {
      const doc = await readXml(D.macros.get((ref || '').toLowerCase()));
      if (!doc) return null;
      const mac = doc.getElementsByTagName('macro')[0];
      const props = mac && child(mac, 'properties');
      const ds = attr(child(props, 'docksize'), 'tags');
      if (!ds) return null;
      return { sizes: ds.split(/\s+/), capacity: num(attr(child(props, 'dock'), 'capacity')) || 0, storage: (mac.getAttribute('name') || '').includes('storage') };
    })();
    partCache.set(key, p);
    return p;
  }
  async function moduleParts(m, macroEl) {
    const parts = { turret: {}, shield: {}, docks: {}, dockCapacity: {}, drones: 0 };
    const props = child(macroEl, 'properties');
    parts.drones = num(attr(child(props, 'storage'), 'unit')) || 0;
    const comp = child(macroEl, 'component');
    if (comp) {
      const c = await componentParts(comp.getAttribute('ref'));
      parts.turret = Object.assign({}, c.turret); parts.shield = Object.assign({}, c.shield); parts.groups = c.groups;
    }
    const conns = child(macroEl, 'connections');
    if (conns) for (const c of conns.children) {
      const mr = child(c, 'macro');
      const ref = mr && mr.getAttribute('ref');
      if (!ref || !/dock|shipstorage/i.test(ref)) continue;
      const bay = await dockbay(ref);
      if (!bay) continue;
      for (const z of bay.sizes) {
        if (!/^dock_(s|m|l|xl)$/.test(z)) continue;
        let cap = bay.capacity;
        if ((z === 'dock_l' || z === 'dock_xl') && !cap) cap = 1;
        parts.dockCapacity[z] = (parts.dockCapacity[z] || 0) + cap;
        if (!bay.storage) parts.docks[z] = (parts.docks[z] || 0) + 1;
      }
    }
    return parts;
  }

  const MODULE_CLASSES = new Set(['production', 'habitation', 'storage', 'dockarea', 'pier', 'defencemodule', 'welfaremodule',
    'processingmodule', 'buildmodule', 'radar', 'connectionmodule']);

  function attr(el, name) { return el ? el.getAttribute(name) : null; }
  function child(el, name) { if (!el) return null; for (const c of el.children) if (c.tagName === name) return c; return null; }

  function parseModule(macroEl, ext) {
    const cls = macroEl.getAttribute('class');
    const name = macroEl.getAttribute('name');
    const props = child(macroEl, 'properties');
    const ident = child(props, 'identification');
    const m = {
      macro: name, class: cls, ext,
      name: attr(ident, 'name'), shortname: attr(ident, 'shortname'), description: attr(ident, 'description'),
      makerrace: attr(ident, 'makerrace'), size: attr(ident, 'size'),
      hull: num(attr(child(props, 'hull'), 'max')) || 0,
      workforceMax: 0, habRace: null, habCapacity: 0, cargoMax: 0, cargoTags: null,
      queue: [], queueAmount: 1,
    };
    const wf = child(props, 'workforce');
    if (wf) {
      if (cls === 'habitation') { m.habRace = attr(wf, 'race'); m.habCapacity = num(attr(wf, 'capacity')) || 0; }
      else m.workforceMax = num(attr(wf, 'max')) || 0;
    }
    // a build module: the ship classes it builds (<builder classes="ship_s ship_m">)
    const builder = child(props, 'builder');
    if (cls === 'buildmodule' && attr(builder, 'classes')) m.builderClasses = attr(builder, 'classes').split(/\s+/).filter(c => /^ship_/.test(c));
    const cargo = child(props, 'cargo');
    if (cargo) { m.cargoMax = num(attr(cargo, 'max')) || 0; m.cargoTags = attr(cargo, 'tags'); }
    // production: <production wares=".."><queue ware method/></production> (as GetFabricWares), or 9.x <products><product ware amount/>
    const prod = child(props, 'production');
    if (prod) {
      const queues = [...prod.children].filter(c => c.tagName === 'queue');
      if (queues.length) {
        for (const q of queues) {
          const items = [...q.children].filter(c => c.tagName === 'item');
          if (items.length) for (const it of items) m.queue.push({ ware: attr(it, 'ware'), method: attr(it, 'method') || 'default' });
          else if (attr(q, 'ware')) m.queue.push({ ware: attr(q, 'ware'), method: attr(q, 'method') || 'default' });
          if (attr(q, 'amount')) m.queueAmount = num(attr(q, 'amount')) || 1;
        }
      } else if (attr(prod, 'wares')) {
        for (const w of attr(prod, 'wares').split(/\s+/).filter(Boolean)) m.queue.push({ ware: w, method: attr(prod, 'method') || 'default' });
      }
    }
    const products = child(props, 'products');
    if (products && !m.queue.length) {
      // processing modules (scrap works) write <products><ware ware amount/>: amount = units processed per cycle of the
      // ware's processing production (inputs scale with it), so it is the queue amount, not the product amount
      for (const p of products.children) {
        if (p.tagName !== 'product' && p.tagName !== 'ware') continue;
        const a = num(attr(p, 'amount')) || 1;
        if (cls === 'processingmodule') { m.queue.push({ ware: attr(p, 'ware'), method: 'processing' }); m.queueAmount = a; }
        else m.queue.push({ ware: attr(p, 'ware'), method: 'default', amount: a });
      }
    }
    if (m.queue.length && cls !== 'buildmodule') m.isProduction = true;
    return m;
  }

  async function loadModules(progress) {
    D.modules = new Map();
    const paths = [];
    for (const [name, value] of D.macros) {
      const v = value.replace(/\\/g, '/').toLowerCase();
      if (/(^|\/)assets\/structures\//.test(v) && /\/macros\//.test(v)) paths.push([name, v]);
    }
    let done = 0;
    const work = async ([name, v]) => {
      let doc;
      try { doc = await XmlDiff.loadPatched(v + '.xml', log); } catch (e) { log(e.message); doc = null; }
      done++;
      if (progress && done % 40 === 0) progress(`Модули станций: ${done} из ${paths.length}`);
      if (!doc) return;
      const ext = (v.match(/^extensions\/([^/]+)\//) || [])[1] || null;
      for (const mac of doc.getElementsByTagName('macro')) {
        const cls = mac.getAttribute('class');
        if (!MODULE_CLASSES.has(cls) || cls === 'connectionmodule') continue;
        const m = parseModule(mac, ext);
        const wid = D.wareByComponent.get((m.macro || '').toLowerCase());
        if (!wid) continue; // as the original: modules nobody builds (no ware) are skipped
        const ware = D.wares.get(wid);
        m.ware = wid;
        m.owners = ware.owners;
        m.noblueprint = ware.tags.includes('noblueprint') || ware.tags.includes('noplayerblueprint');
        m.price = ware.price;
        const bp = production(wid, 'default');
        m.buildcost = bp ? { time: bp.time, wares: bp.primary } : { time: 0, wares: [] };
        for (const q of m.queue) { const w = D.wares.get(q.ware); if (w && !w.factories.includes(m.macro)) w.factories.push(m.macro); }
        try { m.parts = await moduleParts(m, mac); } catch (e) { log(m.macro + ': ' + e.message); m.parts = null; }
        D.modules.set(m.macro, m);
      }
    };
    // a few reads at a time
    const queue = paths.slice();
    const workers = Array.from({ length: 8 }, async () => { while (queue.length) await work(queue.shift()); });
    await Promise.all(workers);
  }

  async function loadAll(lang, progress) {
    D.log = [];
    // other extensions or another game folder: the parts read from the old files and the layout geometry are stale
    partCache.clear();
    if (typeof Layout !== 'undefined' && Layout.reset) Layout.reset();
    await loadTexts(lang, progress);
    await loadRaces();
    await loadWares(progress);
    await loadMacroIndex(progress);
    await loadComponentIndex();
    await loadModules(progress);
    progress && progress(`Готово: модулей ${D.modules.size}, товаров ${D.wares.size}`);
  }

  // display helpers
  const wareName = id => { const w = D.wares.get(id); return w ? text(w.name) || id : id; };
  const moduleName = mac => { const m = D.modules.get(mac); return m ? text(m.name) || mac : mac; };
  const raceName = id => { const r = D.races.get(id); return r ? text(r.name) || id : (id || ''); };
  const factionName = id => { const f = D.factions.get(id); return f ? text(f.name) || id : id; };
  const groupName = id => { const g = D.groups.get(id); return g ? text(g.name) || id : (id || ''); };

  return { D, loadAll, loadTexts, text, production, raceMethod, wareName, moduleName, raceName, factionName, groupName };
})();
