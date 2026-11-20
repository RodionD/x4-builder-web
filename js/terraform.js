/*
  X4 Builder Web - terraforming (the original's module_terraforming, page_TerraformingList / page_TerraformingProperties):
  libraries/terraforming.xml with the extensions' diffs. Projects by project group; a project's card: duration,
  repeat / chance, conditions on the planet's stats, effects, side effects (setback), resources, deliveries (drones),
  rebates, removed / blocked projects. The resource amounts as the original computes them: the file gives shares, the
  multiplier is price / sum(share * the ware's max price), the amount is share * multiplier.
*/
'use strict';

const Terraform = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const F = { q: '', group: '', sel: null };
  let T = null; // {stats: Map, groups: [], projects: Map, shipNames: Map}

  const attrs = el => { const o = {}; for (const a of el.attributes) o[a.name] = a.value; return o; };
  const kids = (el, tag) => (el ? [...el.children].filter(c => !tag || c.tagName === tag) : []);
  const childEl = (el, tag) => kids(el, tag)[0] || null;

  async function load() {
    if (T) return;
    T = { stats: new Map(), groups: [], projects: new Map(), shipNames: new Map() };
    const doc = await XmlDiff.loadPatched('libraries/terraforming.xml');
    if (!doc) return;
    const root = doc.documentElement;
    for (const s of kids(childEl(root, 'stats'), 'stat')) {
      T.stats.set(s.getAttribute('id'), { ...attrs(s), ranges: kids(s, 'range').map(attrs) });
    }
    T.groups = kids(childEl(root, 'projectgroups'), 'projectgroup').map(attrs);
    for (const p of kids(childEl(root, 'projects'), 'project')) {
      const res = childEl(p, 'resources');
      T.projects.set(p.getAttribute('id'), {
        ...attrs(p),
        conditions: kids(childEl(p, 'conditions')).map(c => ({ tag: c.tagName, ...attrs(c) })),
        effects: kids(childEl(p, 'effects')).map(attrs),
        sideeffects: kids(childEl(p, 'sideeffects')).map(attrs),
        resources: res ? { price: Number(res.getAttribute('price')) || 0, wares: kids(res, 'ware').map(w => ({ ware: w.getAttribute('ware'), amount: Number(w.getAttribute('amount')) || 0 })) } : null,
        deliveries: kids(childEl(p, 'deliveries')).map(attrs),
        rebates: kids(childEl(p, 'rebates')).map(attrs),
        removed: kids(childEl(p, 'removedprojects')).map(x => x.getAttribute('id')),
        blocked: kids(childEl(p, 'blockedprojects')).map(x => x.getAttribute('id')),
        blockedGroups: kids(childEl(p, 'blockedgroups')).map(x => x.getAttribute('id') || x.getAttribute('group')),
      });
    }
    // names of the delivery drones
    const macs = new Set();
    for (const p of T.projects.values()) for (const d of p.deliveries) if (d.macro) macs.add(d.macro);
    for (const m of macs) {
      const path = Game.D.macros.get(m.toLowerCase());
      let name = m;
      if (path) {
        const text = await CatFS.read(path.replace(/\\/g, '/') + '.xml');
        const mm = text && text.match(/<identification[^>]*\sname="([^"]+)"/);
        if (mm) name = Game.text(mm[1]) || m;
      }
      T.shipNames.set(m, name);
    }
  }

  const statName = id => { const s = T.stats.get(id); return s ? Game.text(s.name) || id : id; };
  const projName = id => { const p = T.projects.get(id); return p ? Game.text(p.name) || id : id; };
  const plink = id => `<a href="#" data-proj="${esc(id)}">${esc(projName(id))}</a>`;
  // the description of the stat's range a value falls in (the first range whose end >= value)
  function stateText(statId, v) {
    const s = T.stats.get(statId);
    if (!s || v == null) return '';
    const r = s.ranges.find(x => Number(x.end) >= Number(v));
    return r && r.description ? Game.text(r.description) : '';
  }
  function condText(c) {
    const n = statName(c.stat);
    const parts = [];
    if (c.min != null && c.max != null) parts.push(c.min === c.max ? `= ${c.min}` : `${c.min}…${c.max}`);
    else if (c.min != null) parts.push(`≥ ${c.min}`);
    else if (c.max != null) parts.push(`≤ ${c.max}`);
    if (c.minvalue != null) parts.push(`значение ≥ ${fmt(Number(c.minvalue))}`);
    if (c.maxvalue != null) parts.push(`значение ≤ ${fmt(Number(c.maxvalue))}`);
    return `${esc(n)} ${esc(parts.join(', '))}`;
  }
  const dur = s => { s = Number(s) || 0; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return (h ? `${h} ч ` : '') + `${m} мин`; };

  function card(p) {
    const r = p.resources;
    let resHtml = '';
    if (r && r.wares.length) {
      const base = r.wares.reduce((s, w) => s + ((Game.D.wares.get(w.ware) || { price: { max: 0 } }).price.max) * w.amount, 0);
      const mul = r.price > 0 && base > 0 ? Math.trunc(r.price / base) : 1;
      let total = 0;
      const rows = r.wares.map(w => {
        const ware = Game.D.wares.get(w.ware);
        const amount = w.amount * mul;
        const cost = amount * (ware ? ware.price.max : 0); total += cost;
        return `<tr><td><a href="#" data-goware="${esc(w.ware)}">${esc(Game.wareName(w.ware))}</a></td><td>${fmt(amount)}</td><td>${fmt(cost)}</td></tr>`;
      }).join('');
      resHtml = `<h3>Ресурсы</h3><table class="grid"><thead><tr><th>Товар</th><th>Кол-во</th><th>Кр (макс. цены)</th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><td>Цена проекта</td><td></td><td>${fmt(r.price || total)}</td></tr></tfoot></table>`;
    }
    const cond = p.conditions.length ? `<h3>Условия</h3><ul>${p.conditions.map(c => `<li>${condText(c)}</li>`).join('')}</ul>` : '';
    const eff = p.effects.length ? `<h3>Эффекты</h3><table class="grid"><tbody>${p.effects.map(e => {
      const ch = Number(e.change) || 0;
      const lim = [e.min != null ? `не ниже ${e.min}` : '', e.max != null ? `не выше ${e.max}` : ''].filter(Boolean).join(', ');
      return `<tr><td>${esc(statName(e.stat))}</td><td class="${ch > 0 ? 'pos' : ch < 0 ? 'neg' : ''}">${ch > 0 ? '+' : ''}${fmt(ch)}${e.value != null ? ' (' + esc(e.value) + ')' : ''}</td><td class="small">${esc(lim)}</td></tr>`;
    }).join('')}</tbody></table>` : '';
    // side effects: a setback of the progress, a stat change, or another project started (with its text)
    const side = p.sideeffects.length ? `<h3>Побочные эффекты</h3><ul>${p.sideeffects.map(s => {
      const a = [];
      if (s.text) a.push(esc(Game.text(s.text)));
      if (s.setback) a.push(`откат прогресса на ${esc(s.setback)}%`);
      if (s.stat) a.push(`${esc(statName(s.stat))} ${Number(s.change) > 0 ? '+' : ''}${esc(s.change || '')}`);
      if (s.project) a.push(`запускает ${plink(s.project)}`);
      return `<li class="${s.beneficial === 'false' ? 'neg' : ''}">${a.join('; ')}${s.chance ? ` — шанс ${esc(s.chance)}%` : ''}</li>`;
    }).join('')}</ul>` : '';
    const del = p.deliveries.length ? `<h3>Доставка</h3><table class="grid"><thead><tr><th>Дрон</th><th>Кол-во</th><th>Сборка, с</th></tr></thead><tbody>${p.deliveries.map(d => `<tr><td>${esc(T.shipNames.get(d.macro) || d.macro)}</td><td>${fmt(Number(d.amount))}</td><td>${fmt(Number(d.buildduration))}</td></tr>`).join('')}</tbody></table>` : '';
    const reb = p.rebates.length ? `<h3>Скидки</h3><ul>${p.rebates.map(b => `<li>${b.ware ? `<a href="#" data-goware="${esc(b.ware)}">${esc(Game.wareName(b.ware))}</a>` : 'группа ' + esc(Game.groupName(b.waregroup))}: ${esc(b.value)}%</li>`).join('')}</ul>` : '';
    const rel = [p.removed.length ? `<p>Убирает проекты: ${p.removed.map(plink).join(', ')}</p>` : '', p.blocked.length ? `<p>Блокирует: ${p.blocked.map(plink).join(', ')}</p>` : '',
      p.blockedGroups.length ? `<p>Блокирует группы: ${p.blockedGroups.map(g => esc(Game.text((T.groups.find(x => x.id === g) || {}).name) || g)).join(', ')}</p>` : ''].join('');
    const removedBy = [...T.projects.values()].filter(x => x.removed.includes(p.id) || x.blocked.includes(p.id));
    const grp = T.groups.find(g => g.id === p.group);
    return `<h2>${esc(Game.text(p.name) || p.id)}</h2>
      <table class="grid facts"><tbody>
        <tr><td>Идентификатор</td><td><code>${esc(p.id)}</code>${p._ext ? ` <span class="tag">${esc(p._ext)}</span>` : ''}</td></tr>
        <tr><td>Группа</td><td>${esc(grp ? Game.text(grp.name) : p.group)}</td></tr>
        ${p.duration ? `<tr><td>Длительность</td><td>${dur(p.duration)}</td></tr>` : ''}
        ${p.repeatcooldown != null ? `<tr><td>Повтор</td><td>${Number(p.repeatcooldown) ? 'через ' + dur(p.repeatcooldown) : 'можно повторять сразу'}</td></tr>` : ''}
        ${p.chance ? `<tr><td>Шанс</td><td>${esc(p.chance)}%</td></tr>` : ''}
        ${p.resilient === 'true' ? '<tr><td>Устойчивый</td><td>эффект не откатывается</td></tr>' : ''}
      </tbody></table>
      ${Game.text(p.description) ? `<p class="small desc">${esc(Game.text(p.description))}</p>` : ''}
      ${cond}${eff}${side}${resHtml}${reb}${del}${rel}
      ${removedBy.length ? `<p class="small">Убирается или блокируется проектами: ${removedBy.map(x => plink(x.id)).join(', ')}</p>` : ''}`;
  }

  async function render(root) {
    if (!T) { root.innerHTML = '<p class="hint">Загрузка терраформирования…</p>'; await load(); if (!UI.active('terraform')) return; }
    const q = F.q.toLowerCase();
    const shown = [...T.projects.values()].filter(p => (!F.group || p.group === F.group) && (!q || (Game.text(p.name) || '').toLowerCase().includes(q) || p.id.includes(q)));
    if (!F.sel || !T.projects.has(F.sel)) F.sel = shown[0] ? shown[0].id : null;
    let rows = '';
    for (const g of T.groups) {
      const list = shown.filter(p => p.group === g.id).sort((a, b) => (Game.text(a.name) || a.id).localeCompare(Game.text(b.name) || b.id));
      if (!list.length) continue;
      rows += `<tr class="grp"><td colspan="3">${esc(Game.text(g.name) || g.id)} <small>${list.length}</small></td></tr>`;
      rows += list.map(p => `<tr data-proj="${esc(p.id)}" class="${p.id === F.sel ? 'on' : ''}"><td class="nm">${esc(Game.text(p.name) || p.id)}</td>
        <td class="small info">${p.effects.map(e => `${esc(statName(e.stat))} ${Number(e.change) > 0 ? '+' : ''}${esc(e.change)}`).join(', ')}</td>
        <td>${p.resources && p.resources.price ? fmt(p.resources.price) : ''}</td></tr>`).join('');
    }
    // the stats and their ranges, as the game's planet screen
    const stats = [...T.stats.values()].map(s => `<tr><td>${esc(Game.text(s.name) || s.id)}</td><td class="small">${s.ranges.filter(r => r.description || r.state !== '0').map(r => `≤${esc(r.end)}${r.habitable === 'false' ? ' ✗' : ''}`).join(' · ')}</td><td>${esc(s.default)}</td></tr>`).join('');
    const sel = T.projects.get(F.sel);
    root.innerHTML = `<div class="wares">
      <section class="wlist">
        <div class="filters">
          <input id="tq" placeholder="Поиск проекта" value="${esc(F.q)}">
          <select id="tgroup"><option value="">Все группы</option>${T.groups.map(g => `<option value="${esc(g.id)}" ${g.id === F.group ? 'selected' : ''}>${esc(Game.text(g.name) || g.id)}</option>`).join('')}</select>
        </div>
        <table class="grid wtab mtab"><thead><tr><th>Проект</th><th>Эффекты</th><th>Цена</th></tr></thead><tbody>${rows || '<tr><td class="hint">Ничего не найдено</td></tr>'}</tbody></table>
        <details><summary>Показатели планеты</summary><table class="grid"><thead><tr><th>Показатель</th><th>Границы (✗ — непригодно)</th><th>Начало</th></tr></thead><tbody>${stats}</tbody></table></details>
      </section>
      <section class="wcard">${sel ? card(sel) : ''}</section></div>`;
  }

  function click(t, root) {
    const p = t.closest('[data-proj]');
    if (p) { F.sel = p.dataset.proj; if (F.group && T.projects.get(F.sel).group !== F.group) F.group = ''; render(root); return true; }
    return false;
  }
  function change(t, root) {
    if (t.id === 'tgroup') { F.group = t.value; render(root); return true; }
    return false;
  }
  function input(t, root) {
    if (t.id === 'tq') { F.q = t.value; const pos = t.selectionStart; render(root).then(() => { const n = root.querySelector('#tq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); return true; }
    return false;
  }
  function reset() { T = null; }

  return { render, click, change, input, reset, F };
})();
