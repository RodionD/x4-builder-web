/*
  X4 Builder Web - automatic station layout (not in the original X4 Builder, which left the modules unconnected).
  Every module's component has "snap" connections (position, quaternion; the local +Z of a snap points out of the
  module) and a <size> box (centre, half extents). Modules are placed one by one, the big ones first, the docks and
  piers last: each try puts one of the module's snaps against a free snap of the structure (forward axes opposite),
  turned 0/90/180/270 degrees about that axis, and is refused when its box overlaps a placed box. The normal modules
  take the place that grows the structure's box the least (compact, in three dimensions), the docks and piers the
  place nearest the centre whose approach (the box moved 1.5 km outwards) is free of modules (outside). When nothing fits, a cross connector
  (struct_*_cross, six snaps) is added at the best free snap and the module tries again. When even two crosses do not
  help (a huge station: every free snap is inside the built-up area), a chain of connectors (the long straight
  struct_*_base_* / _vertical_* pieces, crosses at the turns) is led out of it from a free snap facing outwards
  (chainFor); only the modules without geometry or snaps are left unplaced.
  The plan stores, as the game's own plans: position of the module origin, rotation yaw/pitch/roll in degrees with
  R = Ry(yaw) * Rx(pitch) * Rz(-roll) (checked on the player's plans: 83 of 89 connected pairs meet exactly; pitch
  never occurs in them), connection = the module's snap, predecessor = the module and snap it is attached to.
*/
'use strict';

const Layout = (() => {
  // ---------- quaternions ----------
  const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qinv = q => [-q[0], -q[1], -q[2], q[3]];
  const qrot = (q, v) => { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [r[0], r[1], r[2]]; };
  const qaxis = (ax, deg) => { const h = deg * Math.PI / 360, s = Math.sin(h); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)]; };
  const qnorm = q => { const n = Math.hypot(...q) || 1; return q.map(x => x / n); };
  // the orientations a module may take: yaw and roll in 90 degree steps, no pitch (the station editor's own plans
  // never hold a pitch: 89 connections of the player, yaw and roll only; modules with a pitch were not joined)
  const ORIENTS = [];
  for (const yaw of [0, 90, 180, -90]) for (const roll of [0, 90, 180, -90]) {
    const q = qmul(qaxis([0, 1, 0], yaw), qaxis([0, 0, 1], -roll));
    if (!ORIENTS.some(o => Math.abs(o.q[0] * q[0] + o.q[1] * q[1] + o.q[2] * q[2] + o.q[3] * q[3]) > 0.9999)) ORIENTS.push({ q, yaw, roll });
  }
  // R = Ry(yaw) Rx(pitch) Rz(c), roll = -c (the game's convention, see above). The sign of pitch is not confirmed by
  // the player's plans (none has a pitch): pitchSign = -1 writes it the other way (switch in the layout dialog).
  let pitchSign = 1;
  try { pitchSign = Number(localStorage.getItem('x4builderweb.pitchSign')) === -1 ? -1 : 1; } catch (e) { /* private mode */ }
  function setPitchSign(v) { pitchSign = v < 0 ? -1 : 1; try { localStorage.setItem('x4builderweb.pitchSign', String(pitchSign)); } catch (e) { /* */ } }
  const compose = (yaw, pitch, roll) => qmul(qmul(qaxis([0, 1, 0], yaw), qaxis([1, 0, 0], pitch)), qaxis([0, 0, 1], -roll));
  const same = (a, b) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) > 0.99999;
  function euler(q) {
    q = qnorm(q);
    const [x, y, z, w] = q;
    const m02 = 2 * (x * z + w * y), m12 = 2 * (y * z - w * x), m22 = 1 - 2 * (x * x + y * y), m10 = 2 * (x * y + w * z), m11 = 1 - 2 * (x * x + z * z);
    const deg = r => r * 180 / Math.PI;
    let pitch = deg(Math.asin(Math.max(-1, Math.min(1, -m12))));
    let yaw = deg(Math.atan2(m02, m22)), roll = -deg(Math.atan2(m10, m11));
    // straight up or down (pitch +-90): yaw and roll turn about the same axis - keep it all in roll, yaw 0
    if (Math.abs(Math.abs(pitch) - 90) < 0.01) {
      pitch = Math.sign(pitch) * 90;
      for (const r of [roll + yaw, roll - yaw]) if (same(compose(0, pitch, r), q)) { yaw = 0; roll = r; break; }
    }
    const n = v => { v = ((v + 180) % 360 + 360) % 360 - 180; return Math.round(v * 1000) / 1000 || 0; };
    return { yaw: n(yaw), pitch: n(pitch) * pitchSign || 0, roll: n(roll) };
  }

  // ---------- module geometry (snaps and box), cached ----------
  const geo = new Map();
  // forget the geometry (Game.loadAll: other extensions or another game folder)
  const reset = () => geo.clear();
  async function readXml(path) {
    if (!path) return null;
    try { return await XmlDiff.loadPatched(path.replace(/\\/g, '/') + '.xml'); } catch (e) { return null; }
  }
  function geometry(macro) {
    if (!geo.has(macro)) geo.set(macro, (async () => {
      const md = await readXml(Game.D.macros.get(macro.toLowerCase()));
      const mac = md && [...md.getElementsByTagName('macro')].find(m => (m.getAttribute('name') || '').toLowerCase() === macro.toLowerCase());
      const comp = mac && mac.getElementsByTagName('component')[0];
      const cd = comp && await readXml(Game.D.components.get((comp.getAttribute('ref') || '').toLowerCase()));
      const root = cd && cd.getElementsByTagName('component')[0];
      if (!root) return null;
      const snaps = [];
      for (const c of root.getElementsByTagName('connection')) {
        if (!/\bsnap\b/.test(c.getAttribute('tags') || '')) continue;
        const o = [...c.children].find(x => x.tagName === 'offset');
        const p = o && [...o.children].find(x => x.tagName === 'position'), q = o && [...o.children].find(x => x.tagName === 'quaternion');
        snaps.push({ name: (c.getAttribute('name') || '').toLowerCase(), p: p ? ['x', 'y', 'z'].map(a => Number(p.getAttribute(a)) || 0) : [0, 0, 0],
          q: q ? qnorm(['qx', 'qy', 'qz', 'qw'].map(a => Number(q.getAttribute(a)) || 0)) : [0, 0, 0, 1] });
      }
      // the box: the union of the collision parts (connections tagged "part" without "nocollision": the hull, not
      // the lights, fog and effects), each <size> (max = half extents, center) at its connection's offset; the first
      // <size> of the file is often a layer's region, far from the model (water: a 1.3 km cube around the wrong point)
      let box = null;
      {
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        const kid = (el, tag) => el && [...el.children].find(x => x.tagName === tag);
        const num = (el, ax) => ax.map(a => Number(el.getAttribute(a)) || 0);
        for (const c of root.getElementsByTagName('connection')) {
          const tg = ' ' + (c.getAttribute('tags') || '') + ' ';
          if (!/ part /.test(tg) || / nocollision /.test(tg)) continue;
          const o = kid(c, 'offset'), op = kid(o, 'position'), oq = kid(o, 'quaternion');
          const T = { p: op ? num(op, ['x', 'y', 'z']) : [0, 0, 0], q: oq ? qnorm(num(oq, ['qx', 'qy', 'qz', 'qw'])) : [0, 0, 0, 1] };
          const parts = kid(c, 'parts');
          for (const part of parts ? parts.children : []) {
            const sz = kid(part, 'size'), mx = kid(sz, 'max'), ce = kid(sz, 'center');
            if (!mx) continue;
            const b = worldBox({ h: num(mx, ['x', 'y', 'z']).map(Math.abs), c: ce ? num(ce, ['x', 'y', 'z']) : [0, 0, 0] }, T);
            for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.lo[i]); hi[i] = Math.max(hi[i], b.hi[i]); }
          }
        }
        if (lo[0] < hi[0]) box = { h: [0, 1, 2].map(i => (hi[i] - lo[i]) / 2), c: [0, 1, 2].map(i => (hi[i] + lo[i]) / 2) };
      }
      const size = box ? null : root.getElementsByTagName('size')[0];
      if (size) {
        const mx = size.getElementsByTagName('max')[0], ce = size.getElementsByTagName('center')[0];
        if (mx) box = { h: ['x', 'y', 'z'].map(a => Math.abs(Number(mx.getAttribute(a)) || 0)), c: ce ? ['x', 'y', 'z'].map(a => Number(ce.getAttribute(a)) || 0) : [0, 0, 0] };
      }
      if (!box) { const r = Math.max(100, ...snaps.map(s => Math.hypot(...s.p))); box = { h: [r, r, r], c: [0, 0, 0] }; }
      return { snaps, box };
    })());
    return geo.get(macro);
  }

  // the world box of a module at a transform (the 8 corners of its box, turned)
  function worldBox(box, T, grow = 0) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const v = qrot(T.q, [box.c[0] + sx * box.h[0] * (1 + grow), box.c[1] + sy * box.h[1] * (1 + grow), box.c[2] + sz * box.h[2] * (1 + grow)]);
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], v[i] + T.p[i]); hi[i] = Math.max(hi[i], v[i] + T.p[i]); }
    }
    return { lo, hi };
  }
  // touching allowed: the boxes are larger than the modules (an L habitation is a 1.6 km cube), so the slack grows with
  // the smaller box: 12 % of its smallest side, at least 15 m
  const overlap = (a, b) => {
    const e = Math.min(a.hi[0] - a.lo[0], a.hi[1] - a.lo[1], a.hi[2] - a.lo[2], b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]);
    const k = Math.max(15, 0.12 * e);
    return a.lo[0] < b.hi[0] - k && b.lo[0] < a.hi[0] - k && a.lo[1] < b.hi[1] - k && b.lo[1] < a.hi[1] - k && a.lo[2] < b.hi[2] - k && b.lo[2] < a.hi[2] - k;
  };

  // ---------- connectors ----------
  const PREFIX = { arg: 'argon', tel: 'teladi', par: 'paranid', spl: 'split', ter: 'terran', atf: 'terran', bor: 'boron', pir: 'pirate' };
  const raceOf = macro => { const m = Game.D.modules.get(macro); return (m && m.makerrace) || PREFIX[(macro.match(/^[a-z]+_([a-z]{3})_/) || [])[1]] || null; };
  // cross connectors (six snaps) that are sold, by race: {race: [macro...]}
  function crosses() {
    const out = {};
    for (const n of Game.D.macros.keys()) {
      if (!/^struct_[a-z]+_cross_\d+_macro$/.test(n) || !Game.D.wareByComponent.has(n)) continue;
      const r = PREFIX[n.split('_')[1]];
      if (r) (out[r] = out[r] || []).push(n);
    }
    for (const r in out) out[r].sort();
    return out;
  }
  // the race most modules of the station are of (by count)
  function stationRace(st) {
    const c = {};
    for (const sm of st.modules) { if (!sm.enabled) continue; const r = raceOf(sm.macro); if (r) c[r] = (c[r] || 0) + sm.count; }
    const have = crosses();
    const best = Object.entries(c).filter(([r]) => have[r]).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : 'argon';
  }
  function crossFor(race) {
    const all = crosses();
    const list = all[race] || all.argon || Object.values(all)[0] || [];
    return list[0] || null;
  }
  // the straight connectors (struct_<race>_base_* along Z, struct_<race>_vertical_* along Y) that are sold, by race;
  // only the ones with exactly two snaps facing opposite ways are used (see straightFor)
  function straights() {
    const out = {};
    for (const n of Game.D.macros.keys()) {
      if (!/^struct_[a-z]+_(base|vertical)_\d+_macro$/.test(n) || !Game.D.wareByComponent.has(n)) continue;
      const r = PREFIX[n.split('_')[1]];
      if (r) (out[r] = out[r] || []).push(n);
    }
    for (const r in out) out[r].sort();
    return out;
  }
  // the straight pieces of a race (the same fallback as the cross): [{macro, g, len}], the longest first
  async function straightFor(race) {
    const all = straights();
    const list = all[race] || all.argon || Object.values(all)[0] || [];
    const out = [];
    for (const n of list) {
      const g = await geometry(n);
      if (!g || g.snaps.length !== 2) continue;
      const [a, b] = g.snaps.map(s => qrot(s.q, [0, 0, 1]));
      if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > -0.99) continue;
      // straight: the snaps on one line along their direction (not a ramp, struct_bor_base_05 rises 400 m)
      const d = g.snaps[1].p.map((v, i) => v - g.snaps[0].p[i]), len = Math.hypot(...d);
      if (!len || Math.abs(d[0] * b[0] + d[1] * b[1] + d[2] * b[2]) < 0.99 * len) continue;
      out.push({ macro: n, g, len });
    }
    return out.sort((x, y) => y.len - x.len || (x.macro < y.macro ? -1 : 1));
  }
  function connectorInfo(macro) {
    const w = Game.D.wares.get(Game.D.wareByComponent.get((macro || '').toLowerCase()));
    return { name: w ? Game.text(w.name) || macro : macro, owners: w ? w.owners : [], price: w ? w.price : null };
  }

  // ---------- the layout ----------
  // st.modules (enabled) -> {entries: [{macro, T, snap, pred, predSnap, connector}], connectors: n, unplaced: [macro], unplacedBox: [box|null]}
  async function make(st, progress) {
    const list = [];
    for (const sm of st.modules) if (sm.enabled) for (let k = 0; k < sm.count; k++) list.push(sm.macro);
    // "extend" (st.base: the entries of the plan the station was loaded from, st.layoutMode != 'scratch'): those entries
    // stay as they are (place, turn, joints, turrets); only the modules the station has on top of them are placed,
    // joined to the base's free snaps (the player, 2026-11-19: add modules to an existing plan without changing it)
    const base = st.base && st.base.entries && st.base.entries.length && st.layoutMode !== 'scratch' ? st.base.entries : null;
    if (base) for (const e of base) { if (/^struct_/.test(e.macro)) continue; const k = list.indexOf(e.macro); if (k >= 0) list.splice(k, 1); }
    const G = new Map();
    for (const m of new Set(list.concat(base ? base.map(e => e.macro) : []))) G.set(m, await geometry(m));
    const isDock = m => { const x = Game.D.modules.get(m); return x && (x.class === 'dockarea' || x.class === 'pier'); };
    const vol = m => { const g = G.get(m); return g ? g.box.h[0] * g.box.h[1] * g.box.h[2] : 0; };
    // modules with two or more snaps first (the trunk), the ones with a single snap (leaves: a teladi medical
    // supplies factory) after them, docks and piers last
    const leaf = m => G.get(m).snaps.length < 2;
    const order = list.filter(m => !isDock(m) && G.get(m) && G.get(m).snaps.length).sort((a, b) => leaf(a) - leaf(b) || vol(b) - vol(a))
      .concat(list.filter(m => isDock(m) && G.get(m) && G.get(m).snaps.length));
    const unplaceable = list.filter(m => !G.get(m) || !G.get(m).snaps.length);
    // the cross connector: the player's choice (st.connRace), else the race most of the station's modules are of
    const connRace = st.connRace || stationRace(st);
    const crossName = crossFor(connRace);
    const cross = crossName ? await geometry(crossName) : null;
    // the straight pieces of the chains (the last resort, see chainFor), loaded only when a chain is needed
    let straight = null;

    const placed = []; // {macro, T, box, link}
    let connectors = 0;
    const open = [];   // {pi, s (snap index of placed), P, Q}
    let lo = [0, 0, 0], hi = [0, 0, 0];
    const mass = [0, 0, 0]; let nMass = 0;
    const addPlaced = (macro, T, g, link) => {
      const pi = placed.length;
      const wb = worldBox(g.box, T);
      // run: how many modules with two snaps (habitations, most factories) end here in a straight chain
      const run = g.snaps.length === 2 && !(link && link.connector) ? (link && placed[link.pred] ? placed[link.pred].run : 0) + 1 : 0;
      placed.push({ macro, T, box: wb, link, run, conn: !!(link && link.connector) || macro === crossName });
      for (let i = 0; i < 3; i++) mass[i] += (wb.lo[i] + wb.hi[i]) / 2;
      nMass++;
      gridAdd(pi, wb);
      if (pi === 0) { lo = wb.lo.slice(); hi = wb.hi.slice(); } else for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], wb.lo[i]); hi[i] = Math.max(hi[i], wb.hi[i]); }
      g.snaps.forEach((s, si) => {
        if (link && si === link.snap) return;
        open.push({ pi, s: si, name: s.name, P: T.p.map((v, i) => v + qrot(T.q, s.p)[i]), Q: qmul(T.q, s.q) });
      });
      return pi;
    };
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const centre = () => [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];

    // compactness of the structure with an extra box: the largest extent first, then the sum of the extents
    const CONN_PENALTY = 250, W_MASS = 0.5, MAX_RUN = 3, APPROACH = 1500;
    function score(boxes, dock, T) {
      const l = lo.slice(), h = hi.slice();
      for (const b of boxes) for (let i = 0; i < 3; i++) { l[i] = Math.min(l[i], b.lo[i]); h[i] = Math.max(h[i], b.hi[i]); }
      const e = [h[0] - l[0], h[1] - l[1], h[2] - l[2]];
      // docks and piers: as close to the centre as their free approach allows (see moduleOn)
      if (dock) { const c0 = centre(); return Math.hypot(T.p[0] - c0[0], T.p[1] - c0[1], T.p[2] - c0[2]); }
      // inside the current bounds every place scores the same: the distance of the module from the centre of mass
      // of the placed ones decides then (the structure grows as a ball, not as arms)
      const b = boxes[0], m = [0, 1, 2].map(i => (b.lo[i] + b.hi[i]) / 2);
      return Math.max(...e) + 0.3 * (e[0] + e[1] + e[2]) + W_MASS * Math.hypot(m[0] - mass[0] / nMass, m[1] - mass[1] / nMass, m[2] - mass[2] / nMass);
    }
    // a module put with its snap s on a free snap at P (outward direction D), in one of the yaw / roll orientations:
    // the snap points meet, the snaps face each other, the module lies outwards of the snap
    let loose = false;
    function placeOn(P, D, g, s, o) {
      const sp = qrot(o.q, s.p);
      const T = { p: [P[0] - sp[0], P[1] - sp[1], P[2] - sp[2]], q: o.q, e: { yaw: o.yaw, roll: o.roll } };
      const c = qrot(o.q, g.box.c), cw = [T.p[0] + c[0], T.p[1] + c[1], T.p[2] + c[2]];
      const out = (cw[0] - P[0]) * D[0] + (cw[1] - P[1]) * D[1] + (cw[2] - P[2]) * D[2];
      // outwards of the snap (snaps may lie well inside the box); loose (only where nothing else fits, see make's
      // loop): a flat module whose box is less than 100 m thick along the snap (a terran / boron harbor on a snap
      // facing down, its box centre 46 m from the snap) when the box lies outwards for the most part
      if (out < 50 && !(loose && out >= 0.8 * [0, 1, 2].reduce((n, i) => { const ax = [0, 0, 0]; ax[i] = 1; return n + Math.abs(dot(qrot(o.q, ax), D)) * g.box.h[i]; }, 0))) return null;
      // the snaps face each other (all the player's connections do); with yaw / roll only, a side snap cannot face an
      // up / down one: such a joint goes through a connector
      const ds = qrot(qmul(o.q, s.q), [0, 0, 1]);
      if (ds[0] * D[0] + ds[1] * D[1] + ds[2] * D[2] > -0.99) return null;
      T.bend = 0;
      return T;
    }
    // a spatial grid of the placed boxes (2 km cells): a box is checked only against its neighbours
    const CELL = 2000, grid = new Map();
    const cellsOf = b => { const out = []; for (let x = Math.floor(b.lo[0] / CELL); x <= Math.floor(b.hi[0] / CELL); x++) for (let y = Math.floor(b.lo[1] / CELL); y <= Math.floor(b.hi[1] / CELL); y++) for (let z = Math.floor(b.lo[2] / CELL); z <= Math.floor(b.hi[2] / CELL); z++) out.push(x + ',' + y + ',' + z); return out; };
    const gridAdd = (i, b) => { for (const k of cellsOf(b)) { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); } };
    const shrink = (b, f) => { const c = [0, 1, 2].map(i => (b.lo[i] + b.hi[i]) / 2), h = [0, 1, 2].map(i => (b.hi[i] - b.lo[i]) / 2 * (1 - f)); return { lo: c.map((v, i) => v - h[i]), hi: c.map((v, i) => v + h[i]) }; };
    // the boxes are much rougher than the modules (snaps often lie inside them: a teladi L habitation's snap is 400 m
    // from its centre, its box 715 m): the module it is joined to is not checked (the game puts them together), the
    // others with both boxes shrunk by 15 %
    const SH = 0.05;
    // connectors are thin tubes in large boxes: the game's own plans put them right through habitations (a teladi
    // cross half inside an L habitation): they are checked against each other only, modules against modules only
    function fitsAt(wb, parent, conn) {
      const a = shrink(wb, SH), seen = new Set();
      for (const k of cellsOf(wb)) for (const i of grid.get(k) || []) {
        if (seen.has(i) || i === parent || !!conn !== !!placed[i].conn) continue; seen.add(i);
        if (overlap(a, shrink(placed[i].box, SH))) return false;
      }
      return true;
    }
    const dirOf = Q => qrot(Q, [0, 0, 1]);
    // a cross on a free snap: it is symmetric, one position is enough (the first orientation that faces it)
    function crossOn(P, D) {
      for (let ci = 0; ci < cross.snaps.length; ci++) for (const cor of ORIENTS) {
        const T = placeOn(P, D, cross, cross.snaps[ci], cor);
        if (T) return { T, ci, box: worldBox(cross.box, T) };
      }
      return null;
    }
    const snapAt = (T, s) => ({ P: T.p.map((v, i) => v + qrot(T.q, s.p)[i]), D: dirOf(qmul(T.q, s.q)) });
    // the module on a snap (P, D): the best of its snaps and orientations, or null
    function moduleOn(P, D, g, dock, check, extra) {
      let b = null;
      for (let si = 0; si < g.snaps.length; si++) for (const or of ORIENTS) {
        const T = placeOn(P, D, g, g.snaps[si], or);
        if (!T) continue;
        let wb = worldBox(g.box, T, dock ? 0.25 : 0);
        // a dock or pier is outside: no module in its box moved 1.5 km on outwards (the ships' approach)
        if (dock) { const w2 = { lo: wb.lo.map((v, i) => v + D[i] * APPROACH), hi: wb.hi.map((v, i) => v + D[i] * APPROACH) };
          wb = { lo: wb.lo.map((v, i) => Math.min(v, w2.lo[i])), hi: wb.hi.map((v, i) => Math.max(v, w2.hi[i])) }; }
        if (!check(wb)) continue;
        // never on the very spot of another module: two leaves (teladi medical supplies factories) hung from different
        // crosses met back to back at one origin - their boxes only touch (the overlap tolerance), the game's own plans
        // never put two modules within 200 m of each other's origin (Гиперион, 2026-11-21)
        if (placed.some(p => !p.conn && Math.hypot(p.T.p[0] - T.p[0], p.T.p[1] - T.p[1], p.T.p[2] - T.p[2]) < 50)) continue;
        // check the dock's own box too (the box stretched by the approach increases its smallest dimension and relaxes
        // the overlap slack, which can hide an overlap on the dock itself)
        if (dock && !check(worldBox(g.box, T))) continue;
        const sc = score([wb, ...extra], dock, T);
        if (!b || sc < b.score) b = { score: sc, si, T };
      }
      return b;
    }
    // the best place of a module: straight on a free snap, through one cross, or through two crosses in a row (a branch
    // to the side is often more compact than one more module at the end of a line); docks and piers: the nearest with a free approach
    // place with room around them. Normal modules look at the 60 free snaps nearest the centre.
    function best(macro, g, dock, viaConn, all) {
      let bestC = null;
      const c0 = centre();
      let cand = open.map((o, oi) => ({ o, oi, d: Math.hypot(o.P[0] - c0[0], o.P[1] - c0[1], o.P[2] - c0[2]) }));
      cand.sort((a, b) => a.d - b.d);
      if (!all) cand = cand.slice(0, 100);
      // a place that would leave no free snap while modules are still to come is not taken
      const take = (r, oi, conn, conn2, pen) => {
        if (!r) return;
        const left = open.length - 1 + g.snaps.length - 1 + (conn ? cross.snaps.length - 2 : 0) + (conn2 ? cross.snaps.length - 2 : 0);
        if (left < 1 && remaining > 0) return;
        if (!bestC || r.score + pen < bestC.score) bestC = { score: r.score + pen, oi, si: r.si, T: r.T, conn, conn2 };
      };
      // pruning: the placed boxes only grow, so a place blocked once stays blocked. A free snap where every option of a
      // macro failed (o.dead: macros) is not tried again for that macro, a cross that does not fit on it (o.noCross) or
      // on one of its arms (o.noCross2: arm indexes) not again for any module. The failure depends on the module's
      // geometry, so the snap itself stays open for the others; the candidates (the nearest 100) are the same as without
      // the pruning, so is the result.
      for (const { o, oi } of cand) {
        if (!loose && o.dead && o.dead.has(macro)) continue;
        let any = false;
        const D = dirOf(o.Q);
        // a chain longer than MAX_RUN goes on through a connector (where it can branch), not straight on
        if (!(g.snaps.length === 2 && placed[o.pi].run >= MAX_RUN)) {
          const r = moduleOn(o.P, D, g, dock, wb => fitsAt(wb, o.pi), []);
          if (r) any = true;
          take(r, oi, null, null, 0);
        }
        if (!viaConn || !cross) continue;
        const c1 = o.noCross ? null : crossOn(o.P, D);
        if (!c1 || !fitsAt(c1.box, o.pi, true)) { o.noCross = true; if (!any && !loose) (o.dead = o.dead || new Set()).add(macro); continue; }
        for (let cj = 0; cj < cross.snaps.length; cj++) {
          if (cj === c1.ci) continue;
          const s1 = snapAt(c1.T, cross.snaps[cj]);
          const r1 = moduleOn(s1.P, s1.D, g, dock, wb => fitsAt(wb, -1), [c1.box]);
          if (r1) any = true;
          take(r1, oi, { ci: c1.ci, cj, T: c1.T }, null, CONN_PENALTY);
          if (o.noCross2 && o.noCross2.has(cj)) continue;
          const c2 = crossOn(s1.P, s1.D);
          if (!c2 || !fitsAt(c2.box, -1, true)) { (o.noCross2 = o.noCross2 || new Set()).add(cj); continue; }
          for (let cl = 0; cl < cross.snaps.length; cl++) {
            if (cl === c2.ci) continue;
            const s2 = snapAt(c2.T, cross.snaps[cl]);
            const r2 = moduleOn(s2.P, s2.D, g, dock, wb => fitsAt(wb, -1), [c1.box, c2.box]);
            if (r2) any = true;
            take(r2, oi, { ci: c1.ci, cj, T: c1.T }, { ck: c2.ci, cl, T: c2.T }, 2 * CONN_PENALTY);
          }
        }
        if (!any && !loose) (o.dead = o.dead || new Set()).add(macro);
      }
      return bestC;
    }
    // the last resort, when best() found no place at all (a huge station: the free snaps are all inside the built-up
    // area): a chain of connectors out of it. It starts on a free snap facing away from the centre (the farthest
    // first), goes on straight with the longest straight piece that fits (struct_<race>_base_* / _vertical_*) and turns
    // through a cross where the straight way is blocked; after each piece the module is tried on the piece's free end
    // and on the arms of a cross put there. Connector pieces collide with connectors only, the module with modules only
    // (as fitsAt). The first chain found from each start (a depth-first walk, CHAIN_BUDGET pieces tried at most) is
    // scored as best() does plus CONN_PENALTY per piece; the best of all starts is taken.
    const CHAIN_STARTS = 30, CHAIN_MAX = 12, CHAIN_BUDGET = 40;
    function chainFor(macro, g, dock) {
      const c0 = centre();
      const away = o => [o.P[0] - c0[0], o.P[1] - c0[1], o.P[2] - c0[2]];
      const mapped = open.map((o, oi) => ({ o, oi, D: dirOf(o.Q), d: Math.hypot(...away(o)) }));
      let starts = mapped.filter(x => dot(x.D, away(x.o)) > 0).sort((a, b) => b.d - a.d).slice(0, CHAIN_STARTS);
      if (!starts.length) starts = mapped.sort((a, b) => b.d - a.d).slice(0, CHAIN_STARTS);
      let bestC = null;
      for (const s0 of starts) {
        const chain = []; // {macro, g, T, ci (the snap on its predecessor), cj (the snap the next one is on), box}
        let budget = CHAIN_BUDGET;
        // a piece on the chain's end: free of the placed connectors and of the chain's pieces (not of the one it is on)
        const pieceFits = box => {
          if (!fitsAt(box, chain.length ? -1 : s0.o.pi, true)) return false;
          const a = shrink(box, SH);
          for (let i = 0; i < chain.length - 1; i++) if (overlap(a, shrink(chain[i].box, SH))) return false;
          return true;
        };
        const pieceOn = (P, D, pg, pmacro) => {
          for (let ci = 0; ci < pg.snaps.length; ci++) for (const or of ORIENTS) {
            const T = placeOn(P, D, pg, pg.snaps[ci], or);
            if (!T) continue;
            const box = worldBox(pg.box, T);
            if (pieceFits(box)) return { macro: pmacro, g: pg, T, ci, cj: -1, box };
          }
          return null;
        };
        // the module on the end (P, D) of the chain (the last piece's snap cj)
        const tryModule = (P, D) => {
          const r = moduleOn(P, D, g, dock, wb => fitsAt(wb, -1), chain.map(p => p.box));
          if (!r) return false;
          const left = open.length - 1 + chain.reduce((n, p) => n + p.g.snaps.length - 2, 0) + g.snaps.length - 1;
          if (left < 1 && remaining > 0) return false;
          const sc = r.score + CONN_PENALTY * chain.length;
          if (!bestC || sc < bestC.score) bestC = { score: sc, oi: s0.oi, si: r.si, T: r.T, chain: chain.map(p => Object.assign({}, p)) };
          return true;
        };
        // the arms of a cross on the chain's end other than the one it is on, the most outward first
        const arms = (pc, D, turn) => {
          const out = [];
          for (let cj = 0; cj < pc.g.snaps.length; cj++) {
            if (cj === pc.ci) continue;
            const e = snapAt(pc.T, pc.g.snaps[cj]);
            if (turn && dot(e.D, D) > 0.5) continue;
            const a = away(e), n = Math.hypot(...a) || 1;
            out.push({ cj, e, w: dot(e.D, a) / n });
          }
          return out.sort((x, y) => y.w - x.w);
        };
        // depth-first: the chain ends in (P, D)
        const walk = (P, D) => {
          if (chain.length && tryModule(P, D)) return true;
          if (chain.length >= CHAIN_MAX || budget <= 0) return false;
          // a cross here, the module on one of its arms
          const pc = cross ? pieceOn(P, D, cross, crossName) : null;
          if (pc) {
            budget--;
            chain.push(pc);
            for (const a of arms(pc, D, false)) { pc.cj = a.cj; if (tryModule(a.e.P, a.e.D)) return true; }
            chain.pop();
          }
          // straight on, the longest piece that fits
          for (const sp of straight) {
            const p = pieceOn(P, D, sp.g, sp.macro);
            if (!p) continue;
            budget--;
            p.cj = 1 - p.ci;
            chain.push(p);
            const e = snapAt(p.T, sp.g.snaps[p.cj]);
            if (walk(e.P, e.D)) return true;
            chain.pop();
            break;
          }
          // a turn through a cross (not back towards the centre)
          if (pc && budget > 0) {
            budget--;
            chain.push(pc);
            for (const a of arms(pc, D, true)) {
              if (a.w < -0.1) continue;
              pc.cj = a.cj;
              if (walk(a.e.P, a.e.D)) return true;
              if (budget <= 0) break;
            }
            chain.pop();
          }
          return false;
        };
        walk(s0.o.P, s0.D);
      }
      return bestC;
    }
    const attach = (macro, g, c, connector) => {
      const o = open[c.oi];
      open.splice(c.oi, 1);
      if (c.chain) {
        // the chain's pieces one after the other, then the module on the last one's snap cj
        let pred = o.pi, predSnap = o.name;
        for (const p of c.chain) {
          const pi = addPlaced(p.macro, p.T, p.g, { pred, predSnap, snap: p.ci, snapName: p.g.snaps[p.ci].name, connector: true });
          connectors++;
          const k = open.findIndex(x => x.pi === pi && x.s === p.cj);
          predSnap = open[k].name; open.splice(k, 1);
          pred = pi;
        }
        return addPlaced(macro, c.T, g, { pred, predSnap, snap: c.si, snapName: g.snaps[c.si].name, connector });
      }
      if (c.conn) {
        // the connector(s) first, then the module on the last one's snap
        const take = (pi, s) => { const k = open.findIndex(x => x.pi === pi && x.s === s); const oc = open[k]; open.splice(k, 1); return oc; };
        const pc = addPlaced(crossName, c.conn.T, cross, { pred: o.pi, predSnap: o.name, snap: c.conn.ci, snapName: cross.snaps[c.conn.ci].name, connector: true });
        connectors++;
        let oc = take(pc, c.conn.cj), last = pc;
        if (c.conn2) {
          last = addPlaced(crossName, c.conn2.T, cross, { pred: pc, predSnap: oc.name, snap: c.conn2.ck, snapName: cross.snaps[c.conn2.ck].name, connector: true });
          connectors++;
          oc = take(last, c.conn2.cl);
        }
        return addPlaced(macro, c.T, g, { pred: last, predSnap: oc.name, snap: c.si, snapName: g.snaps[c.si].name, connector });
      }
      return addPlaced(macro, c.T, g, { pred: o.pi, predSnap: o.name, snap: c.si, snapName: g.snaps[c.si].name, connector });
    };

    let remaining = 0;
    const unplaced = [...unplaceable];
    if (base) {
      // the base entries where the plan has them; a joint (predecessor) takes the snaps of both sides
      const byIdx = new Map();
      base.forEach((e, idx) => { if (e.idx != null) byIdx.set(e.idx, idx); });
      for (const e of base) {
        const g = G.get(e.macro) || { snaps: [], box: { c: [0, 0, 0], h: [1, 1, 1] } };
        const T = { p: e.p.slice(), q: qnorm(compose(e.rot.yaw, e.rot.pitch * pitchSign, e.rot.roll)) };
        const pred = e.pred != null && byIdx.has(e.pred) ? byIdx.get(e.pred) : null;
        const isConn = /^struct_/.test(e.macro);
        const conn = e.conn ? e.conn.toLowerCase() : null;
        const predConn = e.predConn ? e.predConn.toLowerCase() : null;
        const si = conn ? g.snaps.findIndex(x => x.name === conn) : -1;
        const link = pred != null ? { pred, predSnap: predConn, snap: si, snapName: conn, connector: isConn } : isConn ? { connector: true } : null;
        const pi = addPlaced(e.macro, T, g, link);
        placed[pi].raw = e.raw; placed[pi].baseIdx = e.idx;
      }
      for (const e of base) {
        const pred = e.pred != null && byIdx.has(e.pred) ? byIdx.get(e.pred) : null;
        const predConn = e.predConn ? e.predConn.toLowerCase() : null;
        if (pred != null && predConn) { const k = open.findIndex(o => o.pi === pred && o.name === predConn); if (k >= 0) open.splice(k, 1); }
      }
      // snaps that meet a snap of another base module (joined in the game without a predecessor record) are taken too
      for (let i = open.length - 1; i >= 0; i--) {
        const a = open[i], da = dirOf(a.Q);
        const j = open.findIndex((b, bj) => bj !== i && b.pi !== a.pi && Math.hypot(b.P[0] - a.P[0], b.P[1] - a.P[1], b.P[2] - a.P[2]) < 5 && dot(dirOf(b.Q), da) < -0.99);
        if (j >= 0) { const hiI = Math.max(i, j), loI = Math.min(i, j); open.splice(hiI, 1); open.splice(loI, 1); i = Math.min(i, open.length); }
      }
    } else if (order.length) addPlaced(order[0], { p: [0, 0, 0], q: [0, 0, 0, 1], e: { yaw: 0, roll: 0 } }, G.get(order[0]), null);
    for (let k = base ? 0 : 1; k < order.length; k++) {
      const m = order[k], g = G.get(m), dock = isDock(m);
      if (progress && k % 5 === 0) { progress(`Расстановка: ${k} из ${order.length}`); await new Promise(r => setTimeout(r, 0)); }
      remaining = order.length - k - 1;
      // the free snaps near the centre first; when they are all taken or blocked, every free snap
      let c = best(m, g, dock, true) || best(m, g, dock, true, true);
      // nowhere: the same with the flat modules allowed (loose, see placeOn), then a chain of connectors out of the
      // built-up area
      if (!c) {
        loose = true;
        c = best(m, g, dock, true, true);
        if (!c) {
          if (!straight) straight = await straightFor(connRace);
          c = chainFor(m, g, dock);
        }
        loose = false;
      }
      if (!c) { unplaced.push(m); continue; }
      attach(m, g, c, false);
    }
    const entries = placed.map(p => ({ macro: p.macro, T: p.T, connector: !!(p.link && p.link.connector),
      snap: p.link ? p.link.snapName : null, pred: p.link && p.link.pred != null ? p.link.pred : null, predSnap: p.link ? p.link.predSnap : null, box: p.box,
      raw: p.raw || null, baseIdx: p.baseIdx != null ? p.baseIdx : null }));
    // unplacedBox: the local boxes of the unplaced modules (null: no geometry), for io.js to put them aside in the plan
    // connectorMacros: {macro: count} of all the connector pieces (crosses and the chains' straight pieces)
    const connectorMacros = {};
    for (const e of entries) if (e.connector) connectorMacros[e.macro] = (connectorMacros[e.macro] || 0) + 1;
    return { entries, base: base ? base.length : 0, connectors, connectorMacro: crossName, connectorMacros, unplaced, unplacedBox: unplaced.map(m => G.get(m) ? G.get(m).box : null), size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
  }

  // the plan entries of a layout (indexes 1..n), with the station's turrets / shields
  function planEntries(st, L, esc, indent) {
    let x = '';
    // base entries (extend mode) are written as the plan had them, only their indexes renumbered 1..n in order
    const newIdx = new Map();
    L.entries.forEach((e, i) => { if (e.baseIdx != null) newIdx.set(e.baseIdx, i + 1); });
    L.entries.forEach((e, i) => {
      if (e.raw) {
        let r = e.raw.replace(/\s+xmlns="[^"]*"/g, '');
        r = r.replace(/^(<entry\b[^>]*?\bindex=")(\d+)/, (m0, a) => a + (i + 1));
        r = r.replace(/(<predecessor\b[^>]*?\bindex=")(\d+)/g, (m0, a, n) => a + (newIdx.get(Number(n)) || n));
        x += indent + r.trim() + '\n';
        return;
      }
      const r = e.T.e ? { yaw: e.T.e.yaw, pitch: 0, roll: e.T.e.roll } : euler(e.T.q);
      const rot = [r.yaw ? `yaw="${r.yaw}"` : '', r.pitch ? `pitch="${r.pitch}"` : '', r.roll ? `roll="${r.roll}"` : ''].filter(Boolean).join(' ');
      x += `${indent}<entry index="${i + 1}" macro="${esc(e.macro)}"${e.snap && e.pred != null ? ` connection="${esc(e.snap)}"` : ''}>\n`;
      if (e.pred != null) x += `${indent}  <predecessor index="${e.pred + 1}" connection="${esc(e.predSnap)}"/>\n`;
      x += `${indent}  <offset>\n${indent}    <position x="${+e.T.p[0].toFixed(3)}" y="${+e.T.p[1].toFixed(3)}" z="${+e.T.p[2].toFixed(3)}"/>\n${rot ? `${indent}    <rotation ${rot}/>\n` : ''}${indent}  </offset>\n`;
      if (typeof StationLoadout !== 'undefined') x += StationLoadout.upgradesXml(st, e.macro, indent + '  ');
      x += `${indent}</entry>\n`;
    });
    return x;
  }

  return { make, reset, planEntries, euler, geometry, setPitchSign, crosses, stationRace, connectorInfo, get pitchSign() { return pitchSign; }, _q: { qmul, qrot, qaxis }, _worldBox: worldBox };
})();
