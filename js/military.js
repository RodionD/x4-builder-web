/*
  X4 Builder Web - weapons (the original's module_military / page_Military): weapons and turrets (props macros with
  their bullet macro) and missiles, with the values the original computes in CalculateStandartWeaponOrTurret (no
  modification, full hull):
   rate = reload rate (with charge time: 1 / (1/rate + charge)) or 1 / (reload time + charge);
   with a magazine: shots per second = ammo / ((ammo - 1) / rate + ammo reload);
   beams (range): uptime = lifetime / (reload time + charge), the beam lasts lifetime;
   heat: time to overheat = overheat / ((initial + heat) * rate * barrels) (or the initial-heat variant), cool-down =
   overheat / coolrate + cooldelay + overheat cooldelay - charge; sustained share = heating / (heating + cooling);
   peak DPS = damage * bullets * barrels * rate (* beam time); sustained = peak * share;
   range = beam range or bullet speed * lifetime.
  Missiles (load_Missile): damage = explosion * amount, DPS = damage / reload time, range from <missile range>.
*/
'use strict';

const Military = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const F = { q: '', kind: '', size: '', race: '', sel: null, sort: 'peak', desc: true };
  let M = null; let loading = null;
  const kids = (el, tag) => (el ? [...el.children].filter(c => !tag || c.tagName === tag) : []);
  const childEl = (el, tag) => kids(el, tag)[0] || null;
  const A = (el, n) => (el ? el.getAttribute(n) : null);
  const V = v => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
  const SIZES = ['extralarge', 'large', 'medium', 'small'];
  const SZ = { extralarge: 'XL', large: 'L', medium: 'M', small: 'S' };
  const KINDS = { weapon: 'Орудие', turret: 'Турель', missilelauncher: 'Ракетная установка', missileturret: 'Ракетная турель', missile: 'Ракета' };
  // the original's fixed multipliers of sustained DPS for four weapons
  const SPECIAL = { weapon_gen_m_shieldpierce_01_mk1_macro: 0.3788319, weapon_xen_m_beam_01_mk1_macro: 0.28065, weapon_atf_xl_battleship_01_mk1_macro: 0.175996, weapon_kha_l_beam_01_mk1_macro: 0.528125 };

  async function readXml(path) {
    if (!path) return null;
    const text = await CatFS.read(path.replace(/\\/g, '/') + '.xml');
    if (!text) return null;
    try { return XmlDiff.parse(text, path); } catch (e) { return null; }
  }
  const macroEl = async name => { const d = await readXml(Game.D.macros.get(String(name || '').toLowerCase())); return d ? d.getElementsByTagName('macro')[0] : null; };
  // properties as a flat map "tag.attr" -> value (as the original's xml_node paths)
  function flat(props) {
    const o = {};
    const walk = (el, p) => { for (const c of el.children) { const k = p ? p + '.' + c.tagName : c.tagName; for (const a of c.attributes) o[k + '.' + a.name] = a.value; walk(c, k); } };
    if (props) walk(props, '');
    return o;
  }

  function calcWeapon(name, w, b) {
    const n14 = Math.round(V(b['bullet.amount'])) || 1, n15 = Math.round(V(b['bullet.barrelamount'])) || 1;
    let n16 = V(b['bullet.speed']); const n17 = V(b['bullet.lifetime']), n18 = Math.round(V(b['bullet.range'])), n19 = Math.round(V(b['ammunition.value'])), n20 = V(b['ammunition.reload']);
    const n21 = V(b['damage.value']), n22 = V(b['damage.hull']), n23 = V(b['damage.shield']), n24 = V(b['damage.noshield']), n25 = Math.round(V(b['damage.multiplier.mining']));
    const n26 = V(b['areadamage.value']), n27 = V(b['areadamage.shield']), n28 = V(b['areadamage.noshield']);
    let n29 = V(b['reload.rate']); const n30 = V(b['reload.time']), n31 = V(b['bullet.chargetime']);
    if (n29 === 0 && n30 === 0) n29 = 1;
    const n32 = V(b['heat.value']), n33 = Math.round(V(b['heat.initial'])), n34 = Math.round(V(w['heat.overheat'])), n35 = V(w['heat.cooldelay']), n36 = V(w['heat.overheatcooldelay']), n37 = V(w['heat.coolrate']);
    const special = SPECIAL[name] || 1;
    const n4 = n29 > 0 ? (n31 > 0 ? 1 / (1 / n29 + n31) : n29) : (n30 > 0 ? 1 / (n30 + n31) : 1 / n31);
    if (!n4 || !isFinite(n4)) return null;
    let n7 = 1;
    if (n18 <= 0) n7 = n19 <= 0 ? n4 : n19 / ((n19 - 1) / n4 + n20);
    else if (n19 > 0) n7 = n19 / ((n19 - 1) / n4 + n20);
    if (!n7) return null;
    let n5 = 1; if (n18 > 0 && n30 > 0) n5 = n17 / (n30 + n31);
    if (!n5) return null;
    let n6 = 1; if (n18 > 0 && n19 > 0) n6 = n17;
    if (!n6) return null;
    let n8 = 0;
    if (n32 > 0 && n18 === 0) n8 = n34 / ((n33 + n32) * n7 * (n14 > 0 ? n15 : 1));
    else if (n33 > 0) { const n39 = n18 > 0 ? n33 : 0, n40 = n32 > 0 ? Math.round(n32) : n33; n8 = (n34 - n39) / (n40 * n7 * n15); }
    n8 = n8 / n14 + n31;
    n8 = Math.trunc(n8 * 1e5) / 1e5;
    const n10 = n36 > 0 ? n36 : n35;
    let n11 = 0;
    if (n34 > 0 && n37 > 0) n11 = Math.trunc((n34 / n37 + n35 + n10 - n31) * 1e5) / 1e5;
    let n9 = 1;
    if (n5 === 1) { if (n8 > 0) n9 = n8 / (n8 + n11); }
    else if (n33 > 0 && n30 > 0) { const a = n34 / (n32 / n30 * n7 * n15), c = n34 / (n37 + n35); n9 = a / (a + c); }
    n9 = Math.trunc(n9 * 1e5) / 1e5;
    const n13 = n21 + n22 + n23 + n24 + n26 + n27 + n28;
    let n44 = n14 * n15 * n7 * n6;
    if (n6 === 1) n44 *= n5;
    const peak = n13 * n44, sustained = peak * n9 * special;
    let shield = n13;
    if (n21 > 0 && n27 === 0) shield = n23 + n21; else if (n26 > 0) shield = n26 + n27;
    shield *= n14 * n15;
    let hull = n13;
    if (n21 > 0) hull = n21 + n22 + n24; else if (n26 > 0) hull = n26 + n28;
    hull *= n14 * n15;
    if (n24 > 0) hull = n13;
    let range;
    if (n18 > 0) { n16 = -1; range = n18 / 1000; } else range = n16 * n17 / 1000;
    range = Math.trunc(range * 100) / 100;
    let heatRate = -1;
    if (n32 > 0) { heatRate = n32 * n7; if ((n30 > 0 || n31 > 0) && n18 > 0) heatRate /= n30 + n31; }
    return {
      peak, sustained, shield, hull, range, speed: n16 > 0 ? n16 : null, rate: n18 === 0 ? Math.trunc(n7 * 100) / 100 : null,
      heatRate: heatRate > 0 ? heatRate : null, overheat: n34 || null, uptime: n9, mining: n25 > 0 ? peak * n25 : null, beam: n18 > 0,
    };
  }

  async function load(progress) {
    if (M) return;
    if (loading) return loading;
    loading = (async () => {
      const items = [];
      const names = [...Game.D.macros].filter(([n, v]) => /^(weapon|turret|missile)_.*_macro$/.test(n) && /props\\|props\//i.test(v)).map(([n]) => n);
      const bullets = new Map();
      let done = 0;
      const queue = names.slice();
      await Promise.all(Array.from({ length: 8 }, async () => {
        while (queue.length) {
          const n = queue.shift();
          if (++done % 40 === 0) progress(`Вооружение: ${done} из ${names.length}`);
          const mac = await macroEl(n);
          if (!mac) continue;
          const cls = A(mac, 'class');
          const props = childEl(mac, 'properties');
          const ident = childEl(props, 'identification');
          const w = flat(props);
          const ware = Game.D.wares.get(Game.D.wareByComponent.get(A(mac, 'name')));
          const base = { macro: A(mac, 'name'), name: A(ident, 'name'), race: A(ident, 'makerrace'), mk: V(A(ident, 'mk')), description: A(ident, 'description'), ware, hullMax: V(w['hull.max']) || null, rotation: V(w['rotationspeed.max']) || null };
          // the size from the component's own connection tags
          const comp = A(childEl(mac, 'component'), 'ref');
          let tags = [];
          if (comp) {
            const cd = await readXml(Game.D.components.get(comp.toLowerCase()));
            const root = cd && cd.getElementsByTagName('component')[0];
            const own = root ? kids(childEl(root, 'connections'), 'connection').find(c => /\b(weapon|turret|missile)\b/.test(A(c, 'tags') || '')) : null;
            tags = own ? (A(own, 'tags') || '').split(/\s+/).filter(Boolean) : [];
          }
          base.size = SIZES.find(z => tags.includes(z)) || null;
          base.tags = tags;
          if (cls === 'missile') {
            const dmg = V(w['explosiondamage.value']) * (V(w['missile.amount']) || 1);
            const rt = V(w['reload.time']) || 1;
            items.push({ ...base, kind: 'missile', peak: dmg / rt, sustained: dmg / rt, damage: dmg, range: V(w['missile.range']) / 1000 || null, guided: w['missile.guided'] === '1', lock: V(w['lock.time']) || null, mtags: w['missile.tags'] || '' });
            continue;
          }
          if (!['weapon', 'turret', 'missileturret', 'missilelauncher'].includes(cls)) continue;
          const bc = w['bullet.class'];
          const kind = cls === 'missileturret' ? 'missileturret' : cls === 'missilelauncher' ? 'missilelauncher' : cls;
          if (kind === 'missileturret' || kind === 'missilelauncher' || (bc && /^missile/.test(bc))) {
            items.push({ ...base, kind: kind === 'weapon' ? 'missilelauncher' : kind === 'turret' ? 'missileturret' : kind, capacity: V(w['storage.capacity']) || null });
            continue;
          }
          if (!bc) continue;
          if (!bullets.has(bc)) bullets.set(bc, (async () => { const bm = await macroEl(bc); return bm ? flat(childEl(bm, 'properties')) : null; })());
          const b = await bullets.get(bc);
          const calc = b ? calcWeapon(A(mac, 'name'), w, b) : null;
          if (calc) items.push({ ...base, kind, ...calc });
        }
      }));
      M = items;
    })();
    return loading;
  }

  const COLS = [
    ['name', 'Название', x => Game.text(x.name) || x.macro],
    ['kind', 'Вид', x => KINDS[x.kind]],
    ['size', 'Р.', x => SZ[x.size] || ''],
    ['peak', 'Урон/с пик', x => x.peak, 1],
    ['sustained', 'Урон/с длит.', x => x.sustained, 1],
    ['range', 'Дальность, км', x => x.range, 2],
    ['price', 'Цена', x => (x.ware ? x.ware.price.avg : 0), 1],
  ];

  function card(x) {
    const rows = [];
    const add = (k, v) => { if (v != null && v !== '' && !(typeof v === 'number' && isNaN(v))) rows.push(`<tr><td>${k}</td><td>${v}</td></tr>`); };
    add('Вид', esc(KINDS[x.kind]) + (x.size ? ' · ' + SZ[x.size] : '') + (x.beam ? ' · луч' : ''));
    add('Раса', esc(Game.raceName(x.race)));
    if (x.peak != null) add('Урон в секунду', `пик <b>${fmt(x.peak, 1)}</b> · длительно <b>${fmt(x.sustained, 1)}</b>`);
    if (x.shield != null) add('Урон за выстрел', `по щитам ${fmt(x.shield, 1)} · по корпусу ${fmt(x.hull, 1)}`);
    if (x.damage != null) add('Урон ракеты', fmt(x.damage));
    if (x.rate != null) add('Выстрелов в секунду', fmt(x.rate, 2));
    if (x.uptime != null && x.uptime < 1) add('Доля стрельбы без перегрева', fmt(x.uptime * 100, 1) + '%');
    if (x.heatRate != null) add('Нагрев', `${fmt(x.heatRate, 1)}/с до ${fmt(x.overheat)}`);
    if (x.range != null) add('Дальность', fmt(x.range, 2) + ' км');
    if (x.speed != null) add('Скорость снаряда', fmt(x.speed) + ' м/с');
    if (x.mining != null) add('Добыча', fmt(x.mining, 1) + '/с');
    if (x.guided != null) add('Наведение', x.guided ? `да${x.lock ? `, захват ${fmt(x.lock, 1)} с` : ''}` : 'нет');
    if (x.capacity) add('Ракет в установке', fmt(x.capacity));
    if (x.rotation) add('Поворот', fmt(x.rotation, 1) + '°/с');
    if (x.hullMax) add('Прочность', fmt(x.hullMax));
    if (x.ware) add('Цена', `${fmt(x.ware.price.min)} / <b>${fmt(x.ware.price.avg)}</b> / ${fmt(x.ware.price.max)} Кр`);
    const p = x.ware && x.ware.productions[0];
    if (p) add('Изготовление', `<span class="small">${p.primary.map(r => `<a href="#" data-goware="${esc(r.ware)}">${esc(Game.wareName(r.ware))}</a> ×${fmt(r.amount)}`).join(', ')}</span>`);
    if (x.ware && x.ware.owners.length) add('Продают', `<span class="small">${x.ware.owners.map(o => esc(Game.factionName(o))).join(', ')}</span>`);
    return `<h2>${esc(Game.text(x.name) || x.macro)}</h2>
      <table class="grid facts"><tbody><tr><td>Идентификатор</td><td><code>${esc(x.macro)}</code></td></tr>${rows.join('')}</tbody></table>
      ${Game.text(x.description) ? `<p class="small desc">${esc(Game.text(x.description))}</p>` : ''}`;
  }

  async function render(root) {
    if (!M) { root.innerHTML = '<p class="hint" id="milLoad">Загрузка вооружения…</p>'; await load(t => { const e = root.querySelector('#milLoad'); if (e) e.textContent = t; }); if (!UI.active('military')) return; }
    const q = F.q.toLowerCase();
    const races = [...new Set(M.map(x => x.race).filter(Boolean))].sort((a, b) => Game.raceName(a).localeCompare(Game.raceName(b)));
    const list = M.filter(x => (!F.kind || x.kind === F.kind) && (!F.size || x.size === F.size) && (!F.race || x.race === F.race) && (!q || (Game.text(x.name) || '').toLowerCase().includes(q) || x.macro.includes(q)));
    const col = COLS.find(c => c[0] === F.sort) || COLS[0];
    list.sort((a, b) => { const p = col[2](a), r = col[2](b); const d = col[3] ? (p || 0) - (r || 0) : String(p).localeCompare(String(r)); return F.desc ? -d : d; });
    if (!F.sel || !M.some(x => x.macro === F.sel)) F.sel = list[0] ? list[0].macro : null;
    const head = COLS.map(c => `<th data-msort="${c[0]}">${c[1]}${F.sort === c[0] ? (F.desc ? ' ▼' : ' ▲') : ''}</th>`).join('');
    const body = list.slice(0, 600).map(x => `<tr data-mil="${esc(x.macro)}" class="${x.macro === F.sel ? 'on' : ''}">${COLS.map((c, i) => `<td class="${i ? '' : 'nm'}">${c[3] ? fmt(c[2](x), c[0] === 'range' ? 2 : 0) : esc(c[2](x))}</td>`).join('')}</tr>`).join('');
    root.innerHTML = `<div class="wares wide">
      <section class="wlist">
        <div class="filters">
          <input id="mlq" placeholder="Поиск" value="${esc(F.q)}">
          <select id="mlkind"><option value="">Всё вооружение</option>${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${F.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <select id="mlsize"><option value="">Все размеры</option>${SIZES.map(z => `<option value="${z}" ${F.size === z ? 'selected' : ''}>${SZ[z]}</option>`).join('')}</select>
          <select id="mlrace"><option value="">Все расы</option>${races.map(r => `<option value="${esc(r)}" ${F.race === r ? 'selected' : ''}>${esc(Game.raceName(r))}</option>`).join('')}</select>
        </div>
        <table class="grid wtab stab"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
        <p class="small">${list.length} из ${M.length}</p>
      </section>
      <section class="wcard">${F.sel ? card(M.find(x => x.macro === F.sel)) : ''}</section></div>`;
  }

  function click(t, root) {
    const so = t.closest('[data-msort]');
    if (so) { if (F.sort === so.dataset.msort) F.desc = !F.desc; else { F.sort = so.dataset.msort; F.desc = !!(COLS.find(c => c[0] === F.sort) || [])[3]; } render(root); return true; }
    const r = t.closest('[data-mil]');
    if (r) { F.sel = r.dataset.mil; render(root); return true; }
    return false;
  }
  function change(t, root) {
    const map = { mlkind: 'kind', mlsize: 'size', mlrace: 'race' };
    if (map[t.id]) { F[map[t.id]] = t.value; render(root); return true; }
    return false;
  }
  function input(t, root) {
    if (t.id === 'mlq') { F.q = t.value; const pos = t.selectionStart; render(root).then(() => { const n = root.querySelector('#mlq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); return true; }
    return false;
  }
  function reset() { M = null; loading = null; }

  return { render, click, change, input, reset, F, calcWeapon, api: { load: p => load(p || (() => {})), items: () => M || [] } };
})();
