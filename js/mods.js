/*
  X4 Builder Web - equipment mods (the original's module_equipment_mods, page_EquipModsList / page_EquipModsProperties):
  libraries/equipmentmods.xml (with the extensions' diffs) grouped as the original's resource equipmentmods_defaults:
  ship / engine / shield / weapon -> effect -> mods. A mod: its ware (name, quality, price, crafting recipe, research),
  the main effect's range and the bonus effects it may roll (chance, how many at most, their ranges).
  Values are factors: shown as a change in percent; "negative" effects are better when lower; "absolute" ones are counts.
*/
'use strict';

const Mods = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const F = { q: '', group: '', sel: null };
  let mods = null, loading = null; // [{id(ware), group, effect, quality, min, max, bonus: {chance, max, effects: [{effect, min, max}]}, ext}]

  const effectDef = (group, id) => {
    const g = MODS_DEFAULTS.find(x => x.id === group);
    return (g && g.effects.find(e => e.id === id)) || { id, name: id };
  };
  const effectName = (group, id) => { const d = effectDef(group, id); return Game.text(d.name) || id; };

  async function load() {
    if (mods) return;
    if (loading) return loading;
    loading = (async () => {
      try {
        const list = [];
        const doc = await XmlDiff.loadPatched('libraries/equipmentmods.xml');
        if (doc) {
          const num = v => (v == null ? null : Number(v));
          for (const g of doc.documentElement.children) {
            const group = g.tagName;
            for (const m of g.children) {
              const ware = m.getAttribute('ware');
              if (!ware) continue;
              const mod = { id: ware, group, effect: m.tagName, quality: num(m.getAttribute('quality')) || 1, min: num(m.getAttribute('min')), max: num(m.getAttribute('max')), bonus: null, ext: m.getAttribute('_ext') };
              const b = [...m.children].find(c => c.tagName === 'bonus');
              if (b) mod.bonus = { chance: num(b.getAttribute('chance')) || 0, max: num(b.getAttribute('max')) || 0, effects: [...b.children].map(e => ({ effect: e.tagName, min: num(e.getAttribute('min')), max: num(e.getAttribute('max')), weight: num(e.getAttribute('weight')) })) };
              list.push(mod);
            }
          }
        }
        mods = list;
      } finally { loading = null; }
    })();
    return loading;
  }

  // a factor as a change: +5..+20 % (or a count for absolute effects); good / bad by the effect's direction
  function range(group, effect, min, max) {
    const d = effectDef(group, effect);
    const lo = min == null ? max : min, hi = max == null ? min : max;
    if (d.absolute) {
      const av = v => (v == null ? '?' : `${v > 0 ? '+' : ''}${fmt(v)}`);
      return { text: lo === hi ? av(lo) : `${av(lo)}…${av(hi)}`, good: (hi || 0) > 0 };
    }
    // noncalc (radar cloak, region damage, hidden cargo): the value itself is the share, as GetEquipmentModEffectParams
    if (d.noncalc) {
      const pv = v => (v == null ? '?' : `${v >= 0 ? '+' : ''}${fmt(v * 100, 1)}%`);
      return { text: lo === hi ? pv(lo) : `${pv(lo)} … ${pv(hi)}`, good: !d.negative };
    }
    const pc = v => (v == null ? '?' : `${v >= 1 ? '+' : ''}${fmt((v - 1) * 100, 1)}%`);
    const better = d.negative ? hi < 1 : lo > 1;
    return { text: lo === hi ? pc(lo) : `${pc(lo)} … ${pc(hi)}`, good: better };
  }

  const QUALITY = { 1: 'Mk1', 2: 'Mk2', 3: 'Mk3' };

  function card(m) {
    const w = Game.D.wares.get(m.id);
    const name = w ? Game.text(w.name) || m.id : m.id;
    const main = range(m.group, m.effect, m.min, m.max);
    const p = w && w.productions[0];
    const recipe = p ? p.primary.map(r => `<tr><td><a href="#" data-goware="${esc(r.ware)}">${esc(Game.wareName(r.ware))}</a></td><td>${fmt(r.amount)}</td></tr>`).join('') : '';
    const bonus = m.bonus ? `<h3>Дополнительные свойства</h3>
      <p>Шанс ${fmt(m.bonus.chance * 100)}%, не больше ${fmt(m.bonus.max)} из списка:</p>
      <table class="grid"><tbody>${m.bonus.effects.map(e => { const r = range(m.group, e.effect, e.min, e.max); return `<tr><td>${esc(effectName(m.group, e.effect))}</td><td class="${r.good ? 'pos' : 'neg'}">${esc(r.text)}</td>${e.weight != null ? `<td class="small">вес ${fmt(e.weight)}</td>` : '<td></td>'}</tr>`; }).join('')}</tbody></table>` : '';
    const groupName = Game.text((MODS_DEFAULTS.find(g => g.id === m.group) || {}).name) || m.group;
    return `<h2>${esc(name)}</h2>
      <table class="grid facts"><tbody>
        <tr><td>Идентификатор</td><td><code>${esc(m.id)}</code>${m.ext ? ` <span class="tag">${esc(m.ext)}</span>` : ''}</td></tr>
        <tr><td>Тип</td><td>${esc(groupName)} · ${esc(QUALITY[m.quality] || m.quality)}</td></tr>
        <tr><td>Основное свойство</td><td>${esc(effectName(m.group, m.effect))}: <b class="${main.good ? 'pos' : 'neg'}">${esc(main.text)}</b></td></tr>
        ${w ? `<tr><td>Цена</td><td>${fmt(w.price.min)} / <b>${fmt(w.price.avg)}</b> / ${fmt(w.price.max)} Кр</td></tr>` : ''}
        ${p && p.research.length ? `<tr><td>Исследование</td><td>${p.research.map(r => esc(Game.wareName(r))).join(', ')}</td></tr>` : ''}
      </tbody></table>
      ${Game.text(effectDef(m.group, m.effect).description) ? `<p class="small desc">${esc(Game.text(effectDef(m.group, m.effect).description))}</p>` : ''}
      ${bonus}
      ${recipe ? `<h3>Изготовление</h3><table class="grid"><thead><tr><th>Деталь</th><th>Кол-во</th></tr></thead><tbody>${recipe}</tbody></table>` : ''}`;
  }

  async function render(root) {
    if (!mods) { root.innerHTML = '<p class="hint">Загрузка модов…</p>'; await load(); if (!UI.active('mods')) return; }
    const q = F.q.toLowerCase();
    const groups = MODS_DEFAULTS.slice().sort((a, b) => String(a.index).localeCompare(String(b.index)));
    const visible = m => {
      if (F.group && m.group !== F.group) return false;
      if (!q) return true;
      const w = Game.D.wares.get(m.id);
      const n = (w ? Game.text(w.name) : m.id) + ' ' + effectName(m.group, m.effect);
      return n.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
    };
    const shown = mods.filter(visible);
    if (!F.sel || !mods.some(m => m.id === F.sel)) F.sel = shown[0] ? shown[0].id : null;
    let tree = '';
    const renderGroup = (gid, gname, geffects) => {
      const inG = shown.filter(m => m.group === gid);
      if (!inG.length) return;
      tree += `<tr class="grp"><td colspan="3">${esc(gname)} <small>${inG.length}</small></td></tr>`;
      const effects = geffects.slice();
      for (const extra of new Set(inG.map(m => m.effect))) if (!effects.includes(extra)) effects.push(extra);
      for (const eid of effects) {
        const list = inG.filter(m => m.effect === eid).sort((a, b) => a.quality - b.quality || a.id.localeCompare(b.id));
        if (!list.length) continue;
        tree += `<tr class="sub"><td colspan="3">${esc(effectName(gid, eid))}</td></tr>`;
        tree += list.map(m => { const w = Game.D.wares.get(m.id); const r = range(m.group, m.effect, m.min, m.max);
          return `<tr data-mod="${esc(m.id)}" class="${m.id === F.sel ? 'on' : ''}"><td class="nm">${esc(w ? Game.text(w.name) : m.id)}${m.bonus ? ' <small>+бонусы</small>' : ''}</td><td>${esc(QUALITY[m.quality] || m.quality)}</td><td class="${r.good ? 'pos' : 'neg'}">${esc(r.text)}</td></tr>`; }).join('');
      }
    };
    const knownGroups = new Set(groups.map(g => g.id));
    for (const g of groups) renderGroup(g.id, Game.text(g.name) || g.id, g.effects.slice().sort((a, b) => String(a.index).localeCompare(String(b.index))).map(e => e.id));
    for (const gid of new Set(shown.map(m => m.group))) if (!knownGroups.has(gid)) renderGroup(gid, gid, []);
    const sel = mods.find(m => m.id === F.sel);
    root.innerHTML = `<div class="wares">
      <section class="wlist">
        <div class="filters">
          <input id="mq" placeholder="Поиск мода или свойства" value="${esc(F.q)}">
          <select id="mgroup"><option value="">Все типы</option>${groups.map(g => `<option value="${esc(g.id)}" ${g.id === F.group ? 'selected' : ''}>${esc(Game.text(g.name) || g.id)}</option>`).join('')}</select>
        </div>
        <table class="grid wtab mtab"><tbody>${tree || '<tr><td class="hint">Ничего не найдено</td></tr>'}</tbody></table>
        <p class="small">${shown.length} из ${mods.length}</p>
      </section>
      <section class="wcard">${sel ? card(sel) : ''}</section></div>`;
  }

  function click(t, root) {
    const m = t.closest('[data-mod]');
    if (m) { F.sel = m.dataset.mod; render(root); return true; }
    return false;
  }
  function change(t, root) {
    if (t.id === 'mgroup') { F.group = t.value; render(root); return true; }
    return false;
  }
  function input(t, root) {
    if (t.id === 'mq') { F.q = t.value; const pos = t.selectionStart; render(root).then(() => { const n = root.querySelector('#mq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); return true; }
    return false;
  }
  function reset() { mods = null; loading = null; }

  return { render, click, change, input, reset, F };
})();
