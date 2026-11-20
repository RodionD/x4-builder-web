/*
  X4 Builder Web - wares (the original's page_WareList / page_WareProperties): the list with kind, group and transport
  filters, and a ware's card: prices, volume, owners, production methods (output and inputs per hour of one module,
  without and with the full workforce bonus), the modules that make it, the wares that use it. The player's own
  blueprint / inventory marks of the original come from a savegame and are not here.
*/
'use strict';

const Wares = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const TRANSPORT = { container: 'Контейнеры', solid: 'Твёрдые', liquid: 'Жидкие', condensate: 'Конденсат', workunit: 'Рабочие', inventory: 'Инвентарь', ship: 'Корабль', equipment: 'Снаряжение' };
  // kinds by tags, as CheckWareTags of the original (equipment / ship / module = blueprints)
  const KINDS = [
    ['economy', 'Экономика', w => w.tags.includes('economy')],
    ['module', 'Модули станций', w => w.tags.includes('module')],
    ['equipment', 'Снаряжение', w => w.tags.includes('equipment')],
    ['ship', 'Корабли', w => w.tags.includes('ship')],
    ['inventory', 'Инвентарь', w => w.tags.includes('inventory')],
    ['research', 'Исследования', w => w.tags.includes('research')],
    ['all', 'Все', () => true],
  ];
  const F = { q: '', kind: 'economy', group: '', transport: '', sel: null, sort: 'name' };

  function list() {
    const kind = KINDS.find(k => k[0] === F.kind) || KINDS[0];
    const q = F.q.toLowerCase();
    const out = [];
    for (const w of Game.D.wares.values()) {
      if (!kind[2](w)) continue;
      if (F.group && w.group !== F.group) continue;
      if (F.transport && w.transport !== F.transport) continue;
      const name = Game.text(w.name) || w.id;
      if (q && !name.toLowerCase().includes(q) && !w.id.includes(q)) continue;
      out.push({ w, name });
    }
    const by = {
      name: (a, b) => a.name.localeCompare(b.name),
      group: (a, b) => Game.groupName(a.w.group).localeCompare(Game.groupName(b.w.group)) || a.name.localeCompare(b.name),
      price: (a, b) => b.w.price.avg - a.w.price.avg,
      volume: (a, b) => b.w.volume - a.w.volume,
    };
    return out.sort(by[F.sort] || by.name);
  }

  const link = id => `<a href="#" data-ware="${esc(id)}">${esc(Game.wareName(id))}</a>`;

  // output of one module per hour (trunc(amount * efficiency) per cycle), efficiency without / with the full workforce
  function perHour(p, withWork) {
    let eff = 1;
    if (withWork) for (const e of p.effects) if (e.type === 'work') eff = 1 + e.product;
    return p.time ? Math.trunc(p.amount * eff) * 3600 / p.time : 0;
  }

  function card(w) {
    const name = Game.text(w.name) || w.id;
    const prods = w.productions.map(p => {
      const fac = [...Game.D.modules.values()].filter(m => m.isProduction && m.queue.some(q => q.ware === w.id && (Game.production(q.ware, q.method) || {}).method === p.method));
      const cycles = p.time ? 3600 / p.time : 0;
      const effects = p.effects.map(e => `${e.type === 'work' ? 'рабочие' : e.type === 'sunlight' ? 'солнце' : esc(e.type)} +${fmt(e.product * 100)}%`).join(', ');
      const res = [...p.primary, ...p.secondary].map(r => {
        const rw = Game.D.wares.get(r.ware);
        return `<tr><td>${link(r.ware)}</td><td>${fmt(r.amount)}</td><td>${fmt(Math.ceil(r.amount * cycles))}</td><td>${fmt(r.amount * (rw ? rw.price.avg : 0))}</td></tr>`;
      }).join('');
      const inCost = [...p.primary, ...p.secondary].reduce((s, r) => s + r.amount * ((Game.D.wares.get(r.ware) || { price: { avg: 0 } }).price.avg), 0);
      return `<div class="method">
        <h4>${esc(Game.text(p.name) || p.method)} <small>(${esc(p.method)})</small></h4>
        <p class="small">Цикл ${fmt(p.time)} с, выход ${fmt(p.amount)} шт.${effects ? ' · бонусы: ' + effects : ''}</p>
        <p>Один модуль в час: <b>${fmt(perHour(p, false))}</b> без рабочих, <b>${fmt(perHour(p, true))}</b> с полным штатом.
          ${w.price.avg && p.amount ? `Себестоимость цикла по средним ценам ${fmt(inCost)} Кр, выход стоит ${fmt(p.amount * w.price.avg)} Кр.` : ''}</p>
        ${res ? `<table class="grid"><thead><tr><th>Ресурс</th><th>За цикл</th><th>В час</th><th>Кр за цикл</th></tr></thead><tbody>${res}</tbody></table>` : '<p class="small">Без ресурсов.</p>'}
        ${fac.length ? `<p class="small">Модули: ${fac.map(m => `<span class="fac">${esc(Game.text(m.name) || m.macro)} <button data-addfac="${esc(m.macro)}" title="Добавить в текущую станцию">+ в станцию</button></span>`).join(' ')}</p>` : ''}
      </div>`;
    }).join('');
    const users = (Game.D.users.get(w.id) || []).filter(u => !u.ware.startsWith('workunit'));
    const food = (Game.D.users.get(w.id) || []).filter(u => u.ware.startsWith('workunit'));
    // production of other wares, and building (modules, ships, equipment: their build costs) apart
    // a trade ware (tag economy) is production; anything else that takes it is built from it
    const buildKind = id => {
      const x = Game.D.wares.get(id); const t = x ? x.tags : [];
      if (t.includes('economy')) return null;
      return t.includes('module') ? 'Модули станций' : (t.includes('ship') || (x && x.transport === 'ship')) ? 'Корабли' : 'Снаряжение, ракеты и прочее';
    };
    const prodUsers = users.filter(u => !buildKind(u.ware));
    const buildUsers = users.filter(u => buildKind(u.ware));
    let usersHtml = prodUsers.length ? `<table class="grid"><thead><tr><th>Товар</th><th>Метод</th><th>За цикл</th><th>В час на модуль</th></tr></thead><tbody>${
      prodUsers.sort((a, b) => Game.wareName(a.ware).localeCompare(Game.wareName(b.ware))).map(u => `<tr><td>${link(u.ware)}</td><td>${esc(u.method)}</td><td>${fmt(u.amount)}</td><td>${fmt(Math.ceil(u.amount * 3600 / (u.time || 1)))}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">В производстве товаров не используется.</p>';
    const byKind = new Map();
    for (const u of buildUsers) { const k = buildKind(u.ware); if (!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(u); }
    for (const [k, list] of byKind) {
      usersHtml += `<details><summary>Постройка: ${esc(k)} — ${list.length}</summary><table class="grid"><tbody>${
        list.sort((a, b) => b.amount - a.amount).map(u => `<tr><td>${link(u.ware)}</td><td>${fmt(u.amount)}</td></tr>`).join('')}</tbody></table></details>`;
    }
    const foodHtml = food.length ? `<p class="small">Нужно рабочим: ${food.map(u => `${esc(u.ware === 'workunit_busy' ? 'занятым' : 'свободным')} (${esc(Game.raceName(Game.D.methodRace.get(u.method)) || u.method)}) ${fmt(u.amount)} на 200 за 10 мин`).join('; ')}</p>` : '';
    const mod = [...Game.D.modules.values()].find(m => m.ware === w.id);
    return `<h2>${esc(name)}</h2>
      <table class="grid facts"><tbody>
        <tr><td>Идентификатор</td><td><code>${esc(w.id)}</code>${w.ext ? ` <span class="tag">${esc(w.ext)}</span>` : ''}</td></tr>
        <tr><td>Группа</td><td>${esc(Game.groupName(w.group))}</td></tr>
        <tr><td>Груз</td><td>${esc(TRANSPORT[w.transport] || w.transport || '')}, ${fmt(w.volume)} м³</td></tr>
        <tr><td>Цена</td><td>${fmt(w.price.min)} / <b>${fmt(w.price.avg)}</b> / ${fmt(w.price.max)} Кр</td></tr>
        ${w.owners.length ? `<tr><td>Продают</td><td>${w.owners.map(o => esc(Game.factionName(o))).join(', ')}</td></tr>` : ''}
        <tr><td>Теги</td><td class="small">${esc(w.tags.join(' '))}${w.tags.includes('noblueprint') || w.tags.includes('noplayerblueprint') ? ' · <span class="warn">чертёж игроку недоступен</span>' : ''}</td></tr>
        ${mod ? `<tr><td>Модуль</td><td>${esc(Game.text(mod.name))} <button data-addfac="${esc(mod.macro)}">+ в станцию</button></td></tr>` : ''}
      </tbody></table>
      ${Game.text(w.description) ? `<p class="small desc">${esc(Game.text(w.description))}</p>` : ''}
      <h3>Производство</h3>${prods || '<p class="hint">Не производится (добывается, покупается или выпадает).</p>'}
      <h3>Используется</h3>${usersHtml}${foodHtml}`;
  }

  function render(root) {
    const groups = [...new Set([...Game.D.wares.values()].filter(w => (KINDS.find(k => k[0] === F.kind) || KINDS[0])[2](w)).map(w => w.group).filter(Boolean))]
      .sort((a, b) => ((Game.D.groups.get(a) || {}).tier || 99) - ((Game.D.groups.get(b) || {}).tier || 99) || Game.groupName(a).localeCompare(Game.groupName(b)));
    const transports = [...new Set([...Game.D.wares.values()].map(w => w.transport).filter(Boolean))];
    const items = list();
    if (!F.sel || !Game.D.wares.has(F.sel)) F.sel = items[0] ? items[0].w.id : null;
    root.innerHTML = `<div class="wares">
      <section class="wlist">
        <div class="filters">
          <input id="wq" placeholder="Поиск товара" value="${esc(F.q)}">
          <select id="wkind">${KINDS.map(k => `<option value="${k[0]}" ${k[0] === F.kind ? 'selected' : ''}>${k[1]}</option>`).join('')}</select>
          <select id="wgroup"><option value="">Все группы</option>${groups.map(g => `<option value="${esc(g)}" ${g === F.group ? 'selected' : ''}>${esc(Game.groupName(g))}</option>`).join('')}</select>
          <select id="wtr"><option value="">Любой груз</option>${transports.map(t => `<option value="${esc(t)}" ${t === F.transport ? 'selected' : ''}>${esc(TRANSPORT[t] || t)}</option>`).join('')}</select>
        </div>
        <table class="grid wtab"><thead><tr>
          <th data-wsort="name">Товар</th><th data-wsort="group">Группа</th><th data-wsort="volume">м³</th><th data-wsort="price">Цена</th></tr></thead>
          <tbody>${items.slice(0, 600).map(({ w, name }) => `<tr class="${w.id === F.sel ? 'on' : ''}" data-ware="${esc(w.id)}"><td class="nm">${esc(name)}</td><td>${esc(Game.groupName(w.group))}</td><td>${fmt(w.volume)}</td><td>${fmt(w.price.avg)}</td></tr>`).join('')}</tbody></table>
        <p class="small">${items.length} шт.${items.length > 600 ? ', показаны первые 600' : ''}</p>
      </section>
      <section class="wcard">${F.sel ? card(Game.D.wares.get(F.sel)) : '<p class="hint">Ничего не найдено.</p>'}</section>
    </div>`;
  }

  // events from ui.js; true when handled
  function click(t, root) {
    const w = t.closest('[data-ware]');
    if (w) { F.sel = w.dataset.ware; if (!list().some(x => x.w.id === F.sel)) { F.kind = 'all'; F.group = ''; F.transport = ''; F.q = ''; } render(root); return true; }
    const s = t.closest('[data-wsort]');
    if (s) { F.sort = s.dataset.wsort; render(root); return true; }
    return false;
  }
  function change(t, root) {
    if (t.id === 'wkind') { F.kind = t.value; F.group = ''; render(root); return true; }
    if (t.id === 'wgroup') { F.group = t.value; render(root); return true; }
    if (t.id === 'wtr') { F.transport = t.value; render(root); return true; }
    return false;
  }
  function input(t, root) {
    if (t.id === 'wq') { F.q = t.value; const pos = t.selectionStart; render(root); const n = root.querySelector('#wq'); n.focus(); n.setSelectionRange(pos, pos); return true; }
    return false;
  }

  return { render, click, change, input, F };
})();
