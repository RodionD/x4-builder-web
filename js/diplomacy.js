/*
  X4 Builder Web - diplomacy (the original's module_diplomacy, page_DiplomacyList / page_DiplomacyProperties):
  libraries/diplomacy.xml with the extensions' diffs. Agent actions by category and events with their options:
  agent (experience, type, risk), cost (money, influence, wares), reward, time, success / failure, the relation an
  option sets (as the game's UI value), parameters. References: gifts by faction, agent experience levels and ranks,
  the influence cost curve.
*/
'use strict';

const Diplomacy = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v, d = 0) => (v == null || isNaN(v) ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const F = { q: '', kind: '', sel: null };
  let X = null, loading = null; // {actions: [], events: [], gifts: [], experience: [], rank: [], curve: []}

  const kids = (el, tag) => (el ? [...el.children].filter(c => !tag || c.tagName === tag) : []);
  const childEl = (el, tag) => kids(el, tag)[0] || null;
  const A = (el, n) => (el ? el.getAttribute(n) : null);
  const T = s => Game.text(s);
  const CATS = { negotiation: 'Переговоры', espionage: 'Шпионаж', interference: 'Вмешательство' };
  const RISK = { none: 'нет', verylow: 'очень низкий', low: 'низкий', lowmedium: 'ниже среднего', medium: 'средний', mediumhigh: 'выше среднего', high: 'высокий', veryhigh: 'очень высокий' };

  async function load() {
    if (X) return;
    if (loading) return loading;
    loading = (async () => {
      try {
        const x = { actions: [], events: [], gifts: [], experience: [], rank: [], curve: [] };
        const doc = await XmlDiff.loadPatched('libraries/diplomacy.xml');
        if (doc) {
          const root = doc.documentElement;
          x.actions = kids(childEl(root, 'actions'), 'action');
          x.events = kids(childEl(root, 'events'), 'event');
          x.gifts = kids(childEl(root, 'gifts'), 'gift');
          x.giftDefaults = childEl(childEl(root, 'gifts'), 'defaults');
          x.experience = kids(childEl(root, 'experience'), 'level');
          x.rank = kids(childEl(root, 'rank'), 'level');
          x.curve = kids(childEl(root, 'influencecostcurve'), 'influence');
        }
        X = x;
      } finally { loading = null; }
    })();
    return loading;
  }

  const expName = v => { let n = ''; for (const l of X.experience) if (Number(A(l, 'value')) <= Number(v)) n = T(A(l, 'name')); return n; };
  const wlink = id => `<a href="#" data-goware="${esc(id)}">${esc(Game.wareName(id))}</a>`;

  function costHtml(c) {
    if (!c) return '';
    const a = [];
    if (A(c, 'money')) a.push(`${fmt(Number(A(c, 'money')))} Кр`);
    if (A(c, 'influence')) a.push(`влияние ${esc(A(c, 'influence'))}`);
    if (A(c, 'maxinfluencefactor')) a.push(`до ×${esc(A(c, 'maxinfluencefactor'))} за влияние`);
    const wares = kids(childEl(c, 'wares'), 'ware').map(w => `${wlink(A(w, 'ware'))} ×${fmt(Number(A(w, 'amount')))}`);
    return a.join(', ') + (wares.length ? (a.length ? '; ' : '') + wares.join(', ') : '');
  }
  function agentHtml(g) {
    if (!g) return '';
    const a = [];
    if (A(g, 'type')) a.push(CATS[A(g, 'type')] || A(g, 'type'));
    if (A(g, 'experience') != null) a.push(`опыт от ${esc(A(g, 'experience'))}${expName(A(g, 'experience')) ? ' (' + esc(expName(A(g, 'experience'))) + ')' : ''}`);
    if (A(g, 'risk')) a.push(`риск: ${RISK[A(g, 'risk')] || A(g, 'risk')}`);
    return esc(a.join(', '));
  }
  const dur = s => { s = Number(s) || 0; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return (h ? `${h} ч ` : '') + `${m} мин`; };
  const relUi = v => { const u = Factions.ui(v); return `<span class="${u > 0 ? 'pos' : u < 0 ? 'neg' : ''}">${u > 0 ? '+' : ''}${u}</span> <small>(${fmt(Number(v), 3)})</small>`; };

  function actionCard(a) {
    const rows = [];
    const add = (k, v) => { if (v) rows.push(`<tr><td>${k}</td><td>${v}</td></tr>`); };
    add('Категория', esc(CATS[A(a, 'category')] || A(a, 'category')));
    add('Агент', agentHtml(childEl(a, 'agent')));
    add('Стоимость', costHtml(childEl(a, 'cost')));
    const t = childEl(a, 'time');
    if (t) add('Время', `${dur(A(t, 'duration'))}${A(t, 'cooldown') ? `, перезарядка ${dur(A(t, 'cooldown'))}` : ''}${A(t, 'maxinfluencefactor') ? `, ускорение влиянием до ×${esc(A(t, 'maxinfluencefactor'))}` : ''}`);
    const r = childEl(a, 'reward');
    if (r) add('Награда', [A(r, 'influence') ? `влияние +${esc(A(r, 'influence'))}` : '', A(r, 'relation') ? 'отношение ' + relUi(A(r, 'relation')) : '', A(r, 'money') ? fmt(Number(A(r, 'money'))) + ' Кр' : ''].filter(Boolean).join(', ') + (A(r, 'text') ? `<br><small>${esc(T(A(r, 'text')))}</small>` : ''));
    const s = childEl(a, 'success');
    if (s) add('Успех', `${A(s, 'chance') != null ? esc(A(s, 'chance')) + '%' : ''}${A(s, 'text') ? ` <small>${esc(T(A(s, 'text')))}</small>` : ''}`);
    const f = childEl(a, 'failure');
    if (f) add('Провал', `${A(f, 'chance') != null ? esc(A(f, 'chance')) + '%' : ''}${A(f, 'text') ? ` <small>${esc(T(A(f, 'text')))}</small>` : ''}`);
    if (A(a, 'unique') === 'true') add('Особое', 'одно на фракцию одновременно');
    const params = kids(childEl(a, 'params'), 'param').map(p => esc(T(A(p, 'text')) || A(p, 'name'))).join(', ');
    add('Цель', params);
    return `<h2>${esc(T(A(a, 'name')) || A(a, 'id'))}</h2>
      ${T(A(a, 'shortdescription')) ? `<p><b>${esc(T(A(a, 'shortdescription')))}</b></p>` : ''}
      <table class="grid facts"><tbody><tr><td>Идентификатор</td><td><code>${esc(A(a, 'id'))}</code></td></tr>${rows.join('')}</tbody></table>
      ${T(A(a, 'description')) ? `<p class="small desc">${esc(T(A(a, 'description')))}</p>` : ''}`;
  }

  function eventCard(e) {
    const opts = kids(childEl(e, 'options'), 'option').map(o => {
      const rel = childEl(o, 'relation'), suc = childEl(o, 'success');
      return `<div class="method"><h4>${esc(T(A(o, 'name')) || A(o, 'id'))}</h4>
        ${T(A(o, 'description')) ? `<p class="small">${esc(T(A(o, 'description')))}</p>` : ''}
        <table class="grid facts"><tbody>
          ${childEl(o, 'agent') ? `<tr><td>Агент</td><td>${agentHtml(childEl(o, 'agent'))}</td></tr>` : ''}
          ${childEl(o, 'cost') ? `<tr><td>Стоимость</td><td>${costHtml(childEl(o, 'cost'))}</td></tr>` : ''}
          ${rel ? `<tr><td>Отношение</td><td>${relUi(A(rel, 'value'))}</td></tr>` : ''}
          ${suc ? `<tr><td>Вес выбора</td><td>${esc(A(suc, 'weight') || '')}${A(suc, 'selectionweightbonus') ? ` · бонус ${esc(A(suc, 'selectionweightbonus'))}` : ''}</td></tr>` : ''}
          ${childEl(o, 'conclusion') ? `<tr><td>Итог</td><td class="small">${esc(T(A(childEl(o, 'conclusion'), 'text')))}</td></tr>` : ''}
        </tbody></table></div>`;
    }).join('');
    return `<h2>${esc(T(A(e, 'name')) || A(e, 'id'))}</h2>
      ${T(A(e, 'shortdescription')) ? `<p><b>${esc(T(A(e, 'shortdescription')))}</b></p>` : ''}
      <table class="grid facts"><tbody><tr><td>Идентификатор</td><td><code>${esc(A(e, 'id'))}</code></td></tr>
        ${A(e, 'duration') ? `<tr><td>Длительность</td><td>${dur(A(e, 'duration'))}</td></tr>` : ''}</tbody></table>
      ${T(A(e, 'description')) ? `<p class="small desc">${esc(T(A(e, 'description')))}</p>` : ''}
      <h3>Варианты</h3>${opts}`;
  }

  function references() {
    const gifts = X.gifts.map(g => `<tr><td>${wlink(A(g, 'ware'))}</td><td class="small info">${(A(g, 'faction') || '').replace(/[[\]]/g, '').split(/\s*,\s*/).filter(Boolean).map(f => esc(Game.factionName(f))).join(', ')}</td></tr>`).join('');
    const lv = list => list.map(l => `<tr><td>${esc(A(l, 'value'))}</td><td>${esc(T(A(l, 'name')))}</td><td>${A(l, 'eventbonus') ? '×' + esc(A(l, 'eventbonus')) : ''}</td></tr>`).join('');
    return `<h2>Справочник</h2>
      <h3>Подарки</h3>${X.giftDefaults ? `<p class="small">Отношение за подарок: по вкусу +${esc(A(X.giftDefaults, 'positive'))}, не по вкусу ${esc(A(X.giftDefaults, 'negative'))}</p>` : ''}
      <table class="grid"><thead><tr><th>Подарок</th><th>Кому нравится</th></tr></thead><tbody>${gifts}</tbody></table>
      <h3>Опыт агентов</h3><table class="grid"><tbody>${lv(X.experience)}</tbody></table>
      <h3>Ранги агентов</h3><table class="grid"><thead><tr><th>Опыт</th><th>Ранг</th><th>Бонус в событиях</th></tr></thead><tbody>${lv(X.rank)}</tbody></table>
      <h3>Стоимость влияния</h3><table class="grid"><thead><tr><th>Влияние</th><th>Множитель</th></tr></thead><tbody>${X.curve.map(c => `<tr><td>${esc(A(c, 'position'))}</td><td>×${esc(A(c, 'value'))}</td></tr>`).join('')}</tbody></table>`;
  }

  async function render(root) {
    if (!X) { root.innerHTML = '<p class="hint">Загрузка дипломатии…</p>'; await load(); if (!UI.active('diplomacy')) return; }
    const q = F.q.toLowerCase();
    const match = el => !q || (T(A(el, 'name')) || '').toLowerCase().includes(q) || (A(el, 'id') || '').includes(q);
    const items = [];
    for (const a of X.actions) if ((!F.kind || F.kind === 'actions') && match(a)) items.push({ key: 'a:' + A(a, 'id'), el: a, kind: 'action', group: CATS[A(a, 'category')] || A(a, 'category') });
    for (const e of X.events) if ((!F.kind || F.kind === 'events') && match(e)) items.push({ key: 'e:' + A(e, 'id'), el: e, kind: 'event', group: 'События' });
    if (!F.sel) F.sel = 'ref';
    let rows = `<tr data-dip="ref" class="${F.sel === 'ref' ? 'on' : ''}"><td class="nm" colspan="2"><b>Справочник: подарки, опыт, ранги, влияние</b></td></tr>`;
    const groups = [...new Set(items.map(i => i.group))];
    for (const g of groups) {
      const list = items.filter(i => i.group === g);
      rows += `<tr class="grp"><td colspan="2">${esc(g)} <small>${list.length}</small></td></tr>`;
      rows += list.map(i => {
        const c = i.kind === 'action' ? childEl(i.el, 'cost') : null;
        return `<tr data-dip="${esc(i.key)}" class="${i.key === F.sel ? 'on' : ''}"><td class="nm">${esc(T(A(i.el, 'name')) || A(i.el, 'id'))}</td><td class="small">${c && A(c, 'money') ? fmt(Number(A(c, 'money'))) + ' Кр' : i.kind === 'event' ? kids(childEl(i.el, 'options'), 'option').length + ' вар.' : ''}</td></tr>`;
      }).join('');
    }
    const sel = items.find(i => i.key === F.sel) || null;
    root.innerHTML = `<div class="wares">
      <section class="wlist">
        <div class="filters"><input id="dq" placeholder="Поиск действия или события" value="${esc(F.q)}">
          <select id="dkind"><option value="">Действия и события</option><option value="actions" ${F.kind === 'actions' ? 'selected' : ''}>Действия агентов</option><option value="events" ${F.kind === 'events' ? 'selected' : ''}>События</option></select></div>
        <table class="grid wtab mtab"><tbody>${rows}</tbody></table>
      </section>
      <section class="wcard">${F.sel === 'ref' ? references() : sel ? (sel.kind === 'action' ? actionCard(sel.el) : eventCard(sel.el)) : ''}</section></div>`;
  }

  function click(t, root) {
    const d = t.closest('[data-dip]');
    if (d) { F.sel = d.dataset.dip; render(root); return true; }
    return false;
  }
  function change(t, root) {
    if (t.id === 'dkind') { F.kind = t.value; render(root); return true; }
    return false;
  }
  function input(t, root) {
    if (t.id === 'dq') { F.q = t.value; const pos = t.selectionStart; render(root).then(() => { const n = root.querySelector('#dq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); return true; }
    return false;
  }
  function reset() { X = null; loading = null; }

  return { render, click, change, input, reset, F };
})();
