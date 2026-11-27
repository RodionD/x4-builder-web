/*
  X4 Builder Web - factions (the original's module_faction, page_FactionList / page_FactionProperties):
  libraries/factions.xml with the extensions' diffs. List: name, short name, race, tags; card: description, race,
  police, tags, licences (minimum relation), relations to the other factions, illegal wares (the wares' <illegal>),
  what the faction sells (the wares' <owner>). Relations are shown as the game's UI value -30..+30:
  10 * log10(|r| * 1000) with the sign of r (0.01 = +10 friend, 0.1 = +20 ally, 1 = +30), 0 below 0.001.
*/
'use strict';

const Factions = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const F = { q: '', hidden: false, sel: null };

  const ui = r => { r = Number(r) || 0; const a = Math.abs(r); if (a < 0.001) return 0; return Math.sign(r) * Math.round(10 * Math.log10(a * 1000)); };
  const relClass = v => (v >= 20 ? 'pos' : v >= 10 ? 'pos' : v <= -20 ? 'neg' : v <= -10 ? 'warn' : '');
  const relWord = v => (v >= 20 ? 'союзник' : v >= 10 ? 'друг' : v <= -25 ? 'смертельный враг' : v <= -10 ? 'враг' : 'нейтрально');
  const kids = (el, tag) => (el ? [...el.children].filter(c => c.tagName === tag) : []);
  const childEl = (el, tag) => kids(el, tag)[0] || null;
  const fname = id => Game.factionName(id);
  const flink = id => (Game.D.factions.has(id) ? `<a href="#" data-fac="${esc(id)}">${esc(fname(id))}</a>` : esc(id));

  function info(f) {
    const el = f.el;
    const tags = (el.getAttribute('tags') || '').split(/\s+/).filter(Boolean);
    return { tags, hidden: tags.includes('hidden'), inactive: el.getAttribute('active') === '0' };
  }

  function card(f) {
    const el = f.el, i = info(f);
    const lic = kids(childEl(el, 'licences'), 'licence');
    const licRows = lic.filter(l => !l.getAttribute('factions')).map(l => {
      const mr = l.getAttribute('minrelation');
      const v = mr != null ? ui(mr) : null;
      return `<tr><td>${esc(Game.text(l.getAttribute('name')) || l.getAttribute('type'))}${(l.getAttribute('tags') || '').includes('hidden') ? ' <small>(скрытая)</small>' : ''}</td>
        <td class="${v != null ? relClass(v) : ''}">${v != null ? (v > 0 ? '+' : '') + v : ''}</td><td>${l.getAttribute('price') ? fmt(Number(l.getAttribute('price'))) + ' Кр' : ''}</td>
        <td class="small">${esc(l.getAttribute('type'))}</td></tr>`;
    }).join('');
    const shared = lic.filter(l => l.getAttribute('factions')).map(l => `<li>${esc(l.getAttribute('type'))}: ${l.getAttribute('factions').split(/\s+/).map(flink).join(', ')}</li>`).join('');
    // one per faction: a later entry (an extension's add) overrides the earlier one
    const relMap = new Map();
    for (const r of kids(childEl(el, 'relations'), 'relation')) relMap.set(r.getAttribute('faction'), { id: r.getAttribute('faction'), r: Number(r.getAttribute('relation')), locked: r.getAttribute('locked') });
    const rels = [...relMap.values()].sort((a, b) => b.r - a.r);
    const relRows = rels.map(x => { const v = ui(x.r); return `<tr><td>${flink(x.id)}</td><td class="${relClass(v)}">${v > 0 ? '+' : ''}${v}</td><td class="small">${relWord(v)}${x.locked ? ' · закреплено' : ''}</td><td class="small">${fmt(x.r, 3)}</td></tr>`; }).join('');
    const sells = [...Game.D.wares.values()].filter(w => w.owners.includes(f.id));
    const byKind = new Map();
    for (const w of sells) {
      const k = w.tags.includes('module') ? 'Модули станций' : w.tags.includes('ship') ? 'Корабли' : w.tags.includes('equipment') ? 'Снаряжение' : w.tags.includes('economy') ? 'Товары' : 'Прочее';
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k).push(w);
    }
    const sellHtml = [...byKind].map(([k, list]) => `<details><summary>${esc(k)} — ${list.length}</summary><p class="small">${list.slice().sort((a, b) => (Game.text(a.name) || a.id).localeCompare(Game.text(b.name) || b.id)).map(w => `<a href="#" data-goware="${esc(w.id)}">${esc(Game.text(w.name) || w.id)}</a>`).join(', ')}</p></details>`).join('');
    const illegal = [...Game.D.wares.values()].filter(w => w.illegal.includes(f.id));
    const police = el.getAttribute('policefaction');
    return `<h2>${esc(fname(f.id))}${f.short ? ` <small>${esc(Game.text(f.short))}</small>` : ''}</h2>
      <table class="grid facts"><tbody>
        <tr><td>Идентификатор</td><td><code>${esc(f.id)}</code>${el.getAttribute('_ext') ? ` <span class="tag">${esc(el.getAttribute('_ext'))}</span>` : ''}${i.inactive ? ' <span class="warn">неактивна</span>' : ''}</td></tr>
        ${f.race ? `<tr><td>Раса</td><td>${esc(Game.raceName(f.race))}</td></tr>` : ''}
        ${police ? `<tr><td>Полиция</td><td>${flink(police)}</td></tr>` : ''}
        <tr><td>Поведение</td><td>${esc(el.getAttribute('behaviourset') || '')}</td></tr>
        <tr><td>Теги</td><td class="small">${esc(i.tags.join(' '))}</td></tr>
      </tbody></table>
      ${Game.text(el.getAttribute('description')) ? `<p class="small desc">${esc(Game.text(el.getAttribute('description')))}</p>` : ''}
      ${licRows ? `<h3>Лицензии</h3><table class="grid"><thead><tr><th>Лицензия</th><th>Отношение</th><th>Цена</th><th></th></tr></thead><tbody>${licRows}</tbody></table>` : ''}
      ${shared ? `<p class="small">Признаёт лицензии фракций:</p><ul class="small">${shared}</ul>` : ''}
      ${relRows ? `<h3>Отношения</h3><table class="grid"><thead><tr><th>Фракция</th><th>Шкала игры</th><th></th><th>Значение</th></tr></thead><tbody>${relRows}</tbody></table>` : ''}
      ${illegal.length ? `<h3>Запрещённые товары</h3><p class="small">${illegal.map(w => `<a href="#" data-goware="${esc(w.id)}">${esc(Game.text(w.name) || w.id)}</a>`).join(', ')}</p>` : ''}
      ${sellHtml ? `<h3>Продаёт</h3>${sellHtml}` : ''}`;
  }

  function render(root) {
    const q = F.q.toLowerCase();
    const list = [...Game.D.factions.values()].filter(f => {
      const i = info(f);
      if (i.hidden && !F.hidden) return false;
      const n = fname(f.id) + ' ' + (Game.text(f.short) || '') + ' ' + f.id;
      return !q || n.toLowerCase().includes(q);
    }).sort((a, b) => fname(a.id).localeCompare(fname(b.id)));
    if (!F.sel || !Game.D.factions.has(F.sel)) F.sel = list[0] ? list[0].id : null;
    const rows = list.map(f => { const i = info(f); return `<tr data-fac="${esc(f.id)}" class="${f.id === F.sel ? 'on' : ''}"><td class="nm">${esc(fname(f.id))}</td><td>${esc(Game.text(f.short) || '')}</td>
      <td>${esc(Game.raceName(f.race))}</td><td class="small info">${i.tags.filter(t => ['pirate', 'police', 'economic', 'aggressive', 'hidden'].includes(t)).join(' ')}${i.inactive ? ' неактивна' : ''}</td></tr>`; }).join('');
    const sel = Game.D.factions.get(F.sel);
    root.innerHTML = `<div class="wares">
      <section class="wlist">
        <div class="filters"><input id="fcq" placeholder="Поиск фракции" value="${esc(F.q)}">
          <label class="inl"><input type="checkbox" id="fchid" ${F.hidden ? 'checked' : ''}> скрытые</label></div>
        <table class="grid wtab"><thead><tr><th>Фракция</th><th>Сокр.</th><th>Раса</th><th>Теги</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="small">${list.length} из ${Game.D.factions.size}</p>
      </section>
      <section class="wcard">${sel ? card(sel) : ''}</section></div>`;
  }

  function click(t, root) {
    const f = t.closest('[data-fac]');
    if (f) { F.sel = f.dataset.fac; render(root); return true; }
    return false;
  }
  function change(t, root) {
    if (t.id === 'fchid') { F.hidden = t.checked; render(root); return true; }
    return false;
  }
  function input(t, root) {
    if (t.id === 'fcq') { F.q = t.value; const pos = t.selectionStart; render(root); const n = root.querySelector('#fcq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return true; }
    return false;
  }

  return { render, click, change, input, F, ui };
})();
