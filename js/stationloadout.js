/*
  X4 Builder Web - turrets and shields of a station (not in the original X4 Builder's plans). The player picks the
  level - none, Mk1, Mk2, the best - and the race; every slot group of every module (the component's connections
  with group="groupNN", see gamedata) gets one shield and one turret that fit its slots (the ships' tag rule,
  Ships.fits) - as the game's construction plan stores them: <upgrades><groups><shields macro group/>
  <turrets macro group/>. One turret group of every module gets a guided missile turret (it can be switched off; the station buys the missiles). The parts' build resources and
  prices go to the station's build cost (Planner reads st.loadoutCalc).
*/
'use strict';

const StationLoadout = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const MODES = { none: 'без оснащения', mk1: 'Mk1', mk2: 'Mk2', best: 'лучшее' };
  let loading = '';

  const ready = () => Ships.api.loaded && Military.api.items().length > 0;

  async function ensure(rerender) {
    if (ready() || loading) return;
    loading = 'Загрузка щитов и турелей…';
    await Ships.api.load(t => { loading = t; });
    await Military.api.load(t => { loading = t; });
    loading = '';
    rerender();
  }

  // a part for a slot group: fits, sold (has a ware), of the race (else any but Xenon / Kha'ak), by the level
  function pick(list, tags, mode, race, value) {
    // hittable / unhittable must match too (Ships.fits skips them): ship turrets are "unhittable" (turret_*_guided_01),
    // station slots "hittable" (turret_*_guided_02) - the game called a plan with guided_01 on station modules
    // "incompatible equipment"
    const hit = p => ['hittable', 'unhittable'].every(h => !(p.tags || []).includes(h) || tags.includes(h));
    let fit = list.filter(p => p.ware && Ships.fits(tags, p.tags) && hit(p) && !['xenon', 'khaak'].includes(p.race));
    if (!fit.length) return null;
    const own = fit.filter(p => p.race === race);
    if (own.length) fit = own;
    if (mode === 'best') return fit.slice().sort((a, b) => value(b) - value(a))[0];
    const want = mode === 'mk2' ? 2 : 1;
    return fit.slice().sort((a, b) => Math.abs((a.mk || 1) - want) - Math.abs((b.mk || 1) - want) || a.ware.price.avg - b.ware.price.avg)[0];
  }

  function compute(st) {
    const mode = (st.loadout && st.loadout.mode) || 'none';
    if (mode === 'none' || !ready()) { st.loadoutCalc = null; return null; }
    const race = st.loadout.race || 'argon';
    const shields = Ships.api.shields(), turrets = Military.api.items().filter(w => w.kind === 'turret');
    const calc = { perModule: {}, wares: {}, price: { min: 0, avg: 0, max: 0 }, count: {}, missileTurrets: 0 };
    const add = (part, n) => {
      if (!part || !n) return;
      calc.count[part.macro] = (calc.count[part.macro] || 0) + n;
      const p = Game.production(part.ware.id, 'default');
      if (p) for (const r of p.primary) calc.wares[r.ware] = (calc.wares[r.ware] || 0) + r.amount * n;
      for (const k of ['min', 'avg', 'max']) calc.price[k] += part.ware.price[k] * n;
    };
    // guided missile turrets (turret_*_guided_*): the last fitting turret group of every module gets one (the player)
    const guided = st.loadout.missile === false ? [] : Military.api.items().filter(w => w.kind === 'missileturret' && /_guided_/.test(w.macro));
    for (const sm of st.modules) {
      const m = Game.D.modules.get(sm.macro);
      if (!m || !sm.enabled || !m.parts || !m.parts.groups) continue;
      const groups = [];
      let missileGroup = null;
      if (guided.length) {
        // the LAST turret group of the module (in the component's order) where a guided missile turret fits (the player,
        // 2026-11-16: "в последний слот, и только у модулей, где такие слоты есть")
        const cand = Object.entries(m.parts.groups).filter(([, k]) => k.turret && pick(guided, k.turret.tags, mode, race, () => 0));
        if (cand.length) missileGroup = cand[cand.length - 1][0];
      }
      for (const [g, kinds] of Object.entries(m.parts.groups)) {
        const sh = kinds.shield ? pick(shields, kinds.shield.tags, mode, race, x => x.capacity) : null;
        const tu = kinds.turret ? (g === missileGroup ? pick(guided, kinds.turret.tags, mode, race, x => x.capacity || 0) : pick(turrets, kinds.turret.tags, mode, race, x => x.sustained || 0)) : null;
        if (!sh && !tu) continue;
        groups.push({ group: g, shield: sh ? sh.macro : null, turret: tu ? tu.macro : null, shieldN: kinds.shield ? kinds.shield.count : 0, turretN: kinds.turret ? kinds.turret.count : 0 });
        add(sh, kinds.shield ? kinds.shield.count * sm.count : 0);
        add(tu, kinds.turret ? kinds.turret.count * sm.count : 0);
        if (tu && g === missileGroup) calc.missileTurrets += (kinds.turret.count || 0) * sm.count;
      }
      if (groups.length) calc.perModule[m.macro] = groups;
    }
    st.loadoutCalc = calc;
    return calc;
  }

  // the controls and a summary for the station page
  function html(st, races) {
    const lo = st.loadout || { mode: 'none', race: 'argon' };
    const c = st.loadoutCalc;
    let sum = '';
    if (lo.mode !== 'none') {
      if (!ready()) sum = `<span class="small">${esc(loading || 'Нужны данные щитов и турелей…')}</span>`;
      else if (c) {
        const items = Object.entries(c.count).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${esc(Game.text((Military.api.items().find(x => x.macro === m) || Ships.api.shields().find(x => x.macro === m) || {}).name) || m)} ×${n}`);
        sum = `<span class="small">${items.length ? items.join(', ') : 'на модулях станции нет слотов'}${c.price.avg ? ` · ${fmt(c.price[(UI.S.settings || {}).price || 'avg'])} Кр` : ''}</span>`;
      }
    }
    return `<div class="ldrow"><label>Оснащение станции <select id="ldMode">${Object.entries(MODES).map(([k, v]) => `<option value="${k}" ${lo.mode === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${lo.mode !== 'none' ? `<label title="В каждом модуле одна группа турелей - с управляемыми ракетами (ракеты станция закупает сама)"><input type="checkbox" id="ldMissile" ${lo.missile !== false ? 'checked' : ''}> ракетная турель</label>` : ''}
      ${lo.mode !== 'none' ? `<label>раса <select id="ldRace">${races.map(r => `<option value="${esc(r)}" ${lo.race === r ? 'selected' : ''}>${esc(Game.raceName(r))}</option>`).join('')}</select></label>` : ''}
      ${sum}</div>
      ${lo.mode !== 'none' ? `<div class="ldrow small">расход станции в час: <label title="Управляемые ракеты (M), которые станция строит для своих ракетных турелей из компонентов ракет, энергии и смарт-чипов">ракет <input type="number" id="ldMisRate" min="0" max="10000" step="1" value="${esc(misRate(st))}" style="width:5em"></label>
        <label title="Оборонные дроны, которые станция строит взамен потерянных из компонентов дронов, энергии и смарт-чипов">дронов обороны <input type="number" id="ldDroneRate" min="0" max="1000" step="1" value="${esc(droneRate(st))}" style="width:4em"></label>
        <span>— их сырьё идёт в баланс, автодостройка добавит производство</span></div>` : ''}`;
  }
  // the station's own consumption per hour (the player, 2026-11-20: missile turrets need missile components, the defence
  // drone components): defaults 4 missiles an hour per missile turret, 2 defence drones an hour for an armed station
  const misRate = st => { const lo = st.loadout || {}; return lo.misRate != null ? lo.misRate : 4 * ((st.loadoutCalc && st.loadoutCalc.missileTurrets) || 0); };
  const droneRate = st => { const lo = st.loadout || {}; return lo.droneRate != null ? lo.droneRate : 2; };
  // -> {ware: amount per hour} of the missiles' and drones' build resources (station guided missile M, fighting drone)
  function supply(st) {
    const lo = st.loadout || {};
    if (!lo.mode || lo.mode === 'none') return {};
    const out = {};
    const take = (ware, n) => { if (!n) return; const p = Game.production(ware, 'default'); if (p) for (const r of p.primary) out[r.ware] = (out[r.ware] || 0) + r.amount * n; };
    if (lo.missile !== false) take('missile_gen_m_guided_01_mk1', misRate(st));
    take('ship_gen_s_fightingdrone_01_a', droneRate(st));
    return out;
  }

  // the plan's <upgrades> of one module macro (or '')
  function upgradesXml(st, macro, indent) {
    const groups = st.loadoutCalc && st.loadoutCalc.perModule[macro];
    if (!groups || !groups.length) return '';
    const e = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    let x = `${indent}<upgrades>\n${indent}  <groups>\n`;
    // exact: how many of the group's slots get the part - the game's own plans give every turret group its slot count
    // (exact="2" / "4") and shield groups with more than one slot too; without it the game fits a single one
    const ex = n => (n > 1 ? ` exact="${n}"` : '');
    for (const g of groups) if (g.shield) x += `${indent}    <shields macro="${e(g.shield)}" group="${e(g.group)}"${ex(g.shieldN)}/>\n`;
    for (const g of groups) if (g.turret) x += `${indent}    <turrets macro="${e(g.turret)}" group="${e(g.group)}"${ex(g.turretN)}/>\n`;
    return x + `${indent}  </groups>\n${indent}</upgrades>\n`;
  }

  // before a layout or a plan is written: the shield and turret data loaded first (else compute() gave nothing and the
  // plan went out without turrets - the player, 2026-11-21: "не срабатывает оснащение станции")
  async function prepare(st) {
    if (!st.loadout || st.loadout.mode === 'none') return null;
    if (!ready()) {
      if (!Ships.api.loaded) await Ships.api.load(() => {});
      if (!Military.api.items().length) await Military.api.load(() => {});
    }
    return compute(st);
  }

  return { compute, prepare, html, ensure, ready, upgradesXml, supply, MODES };
})();
