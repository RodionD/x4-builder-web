/*
  X4 Builder Web - XML loading with the game's diff patches.
  A file of an extension with the same path as a base file is either a full file (its children are appended) or a
  <diff> of <add sel pos type>, <replace sel>, <remove sel> operations with XPath selectors (the game's patch format,
  RFC 5261 subset). The original X4 Builder applied only <add>; here all three are applied in the game's load order.
*/
'use strict';

const XmlDiff = (() => {
  const parser = new DOMParser();

  function parse(text, path) {
    const doc = parser.parseFromString(text, 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error(`XML ${path}: ${err.textContent.slice(0, 200)}`);
    return doc;
  }

  function select(doc, sel) {
    const r = doc.evaluate(sel, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const out = [];
    for (let i = 0; i < r.snapshotLength; i++) out.push(r.snapshotItem(i));
    return out;
  }

  function importChildren(doc, op) {
    const out = [];
    for (const c of op.childNodes) {
      if (c.nodeType === 1 || (c.nodeType === 3 && c.textContent.trim())) out.push(doc.importNode(c, true));
    }
    return out;
  }

  function applyDiff(doc, diff, log, src) {
    let ok = 0, bad = 0;
    for (const op of diff.documentElement.children) {
      const sel = op.getAttribute('sel');
      if (!sel) continue;
      let targets;
      try { targets = select(doc, sel); } catch (e) { bad++; log && log(`${src}: неверный sel ${sel}`); continue; }
      const silent = op.getAttribute('silent') === 'true' || op.getAttribute('silent') === '1';
      if (!targets.length) { if (!silent) { bad++; log && log(`${src}: ${op.tagName} ${sel} - не найдено`); } continue; }
      const t = targets[0];
      try {
        if (op.tagName === 'add') {
          const type = op.getAttribute('type');
          const pos = op.getAttribute('pos');
          if (type && type.startsWith('@')) {
            t.setAttribute(type.slice(1), op.textContent);
          } else {
            const nodes = importChildren(doc, op);
            if (pos === 'before') for (const n of nodes) t.parentNode.insertBefore(n, t);
            else if (pos === 'after') { let ref = t.nextSibling; for (const n of nodes) t.parentNode.insertBefore(n, ref); }
            else if (pos === 'prepend') { const first = t.firstChild; for (const n of nodes) t.insertBefore(n, first); }
            else for (const n of nodes) t.appendChild(n);
          }
        } else if (op.tagName === 'replace') {
          if (t.nodeType === 2) t.ownerElement.setAttribute(t.name, op.textContent);
          else if (t.nodeType === 3) t.textContent = op.textContent;
          else {
            const nodes = importChildren(doc, op).filter(n => n.nodeType === 1);
            for (const n of nodes) t.parentNode.insertBefore(n, t);
            t.parentNode.removeChild(t);
          }
        } else if (op.tagName === 'remove') {
          if (t.nodeType === 2) t.ownerElement.removeAttribute(t.name);
          else t.parentNode.removeChild(t);
        }
        ok++;
      } catch (e) { bad++; log && log(`${src}: ${op.tagName} ${sel}: ${e.message}`); }
    }
    return { ok, bad };
  }

  // the base file with every active extension's version of it applied; null when nobody has it
  async function loadPatched(path, log) {
    const layers = CatFS.layers(path);
    if (!layers.length) return null;
    let doc = null;
    for (const l of layers) {
      const text = await CatFS.read(l.path);
      if (!text) continue;
      let d;
      try { d = parse(text, l.path); } catch (e) { log && log(e.message); continue; }
      if (!doc) {
        doc = d.documentElement.tagName === 'diff' ? null : d;
        if (doc) { tag(doc.documentElement, l.ext); continue; }
        continue;
      }
      if (d.documentElement.tagName === 'diff') {
        // mark added elements with their extension (as the original's "patch" attribute)
        if (l.ext) for (const add of d.documentElement.getElementsByTagName('add')) for (const c of add.children) c.setAttribute('_ext', l.ext);
        applyDiff(doc, d, log, l.path);
      } else {
        // a full file of an extension: its top-level children join the base root
        for (const c of [...d.documentElement.children]) {
          const n = doc.importNode(c, true);
          if (l.ext) n.setAttribute('_ext', l.ext);
          doc.documentElement.appendChild(n);
        }
      }
    }
    return doc;
  }

  function tag(root, ext) { if (ext) for (const c of root.children) c.setAttribute('_ext', ext); }

  return { parse, select, applyDiff, loadPatched };
})();
