/* tweak-ui overlay — injected into the target page.
 * Provides an element picker + visual CSS controls, records from→to changes,
 * and streams them back to the Node driver via window.__tweakUiSend(). */
(function () {
  if (window.__tweakUiLoaded) return;
  window.__tweakUiLoaded = true;

  // ---------------------------------------------------------------- transport
  function send(type, payload) {
    try { if (window.__tweakUiSend) window.__tweakUiSend({ type: type, payload: payload }); } catch (e) {}
  }

  // ---------------------------------------------------------------- state
  var PROPS_SNAPSHOT = [
    'color', 'background-color', 'border-color', 'border-style', 'border-width',
    'border-radius', 'opacity', 'font-size', 'font-weight',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left'
  ];
  var snapshots = new WeakMap();   // el -> { prop: originalComputedValue }
  var recs = new Map();            // el -> { el, meta, changes:{prop:{from,to}} }
  var elIds = new WeakMap();
  var idc = 0;
  var state = { selected: null, pick: true };

  // refs filled in during build()
  var taEl, countEl, bodyEl, pickBtn, toastTimer;

  // ---------------------------------------------------------------- helpers
  function comp(el) { return getComputedStyle(el); }

  function ensureSnapshot(el) {
    if (snapshots.has(el)) return;
    var cs = comp(el), snap = {};
    PROPS_SNAPSHOT.forEach(function (p) { snap[p] = cs.getPropertyValue(p).trim(); });
    snapshots.set(el, snap);
  }

  function idOf(el) {
    if (!elIds.has(el)) elIds.set(el, ++idc);
    return elIds.get(el);
  }

  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    var path = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      var sel = el.nodeName.toLowerCase();
      if (el.id) { path.unshift(sel + '#' + cssEscape(el.id)); break; }
      var cls = classesOf(el).slice(0, 2).map(function (c) { return '.' + cssEscape(c); }).join('');
      var nth = 1, sib = el;
      while ((sib = sib.previousElementSibling)) { if (sib.nodeName === el.nodeName) nth++; }
      path.unshift(sel + cls + ':nth-of-type(' + nth + ')');
      el = el.parentElement;
      if (path.length > 6) break;
    }
    return path.join(' > ');
  }

  function cssEscape(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function classesOf(el) {
    return Array.prototype.slice.call(el.classList).filter(function (c) {
      return c.indexOf('__tweakui') !== 0;
    });
  }

  function markupOf(el) {
    var s = '<' + el.tagName.toLowerCase();
    if (el.id) s += ' id="' + el.id + '"';
    var cls = classesOf(el);
    if (cls.length) s += ' class="' + cls.join(' ') + '"';
    ['data-testid', 'data-test', 'data-cy', 'data-id', 'data-qa', 'name', 'type', 'href', 'aria-label', 'role'].forEach(function (a) {
      if (el.hasAttribute(a)) s += ' ' + a + '="' + el.getAttribute(a) + '"';
    });
    return s + '>';
  }

  function textOf(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  // Prefer a stable hook (id / data-* test attribute) over a positional CSS path.
  var DATA_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-id', 'data-qa'];

  function dataIdOf(el) {
    for (var i = 0; i < DATA_ATTRS.length; i++) {
      if (el.hasAttribute(DATA_ATTRS[i])) {
        return DATA_ATTRS[i] + '="' + el.getAttribute(DATA_ATTRS[i]) + '"';
      }
    }
    return '';
  }

  function bestSelector(el) {
    if (el.id) return '#' + cssEscape(el.id);
    var d = dataIdOf(el);
    if (d) return '[' + d + ']';
    return cssPath(el);
  }

  function meta(el) {
    var d = dataIdOf(el);
    return {
      id: idOf(el),
      selector: bestSelector(el),   // stable hook when available, else CSS path
      cssPath: cssPath(el),         // always the full positional path (fallback)
      dataId: d,                    // e.g. data-testid="save-btn", or '' if none
      tag: el.tagName.toLowerCase(),
      elementId: el.id || '',
      classes: classesOf(el),
      text: textOf(el),
      markup: markupOf(el)
    };
  }

  function getRec(el) {
    if (!recs.has(el)) recs.set(el, { el: el, meta: meta(el), changes: {}, note: '' });
    return recs.get(el);
  }

  function toHex(c) {
    if (!c) return '#000000';
    if (/^#([0-9a-f]{3,8})$/i.test(c)) return c.length === 4
      ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c.slice(0, 7);
    var m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return '#000000';
    var p = m[1].split(',').map(function (x) { return parseFloat(x.trim()); });
    function hx(x) { return ('0' + Math.round(x).toString(16)).slice(-2); }
    return '#' + hx(p[0]) + hx(p[1]) + hx(p[2]);
  }

  // ---------------------------------------------------------------- change recording
  function recordChange(el, prop, from, to) {
    var r = getRec(el);
    if (!(prop in r.changes)) r.changes[prop] = { from: from, to: to };
    else r.changes[prop].to = to;
  }

  function setStyle(prop, value) {
    var el = state.selected; if (!el) return;
    ensureSnapshot(el);
    var snap = snapshots.get(el);
    if (prop === 'border-width') {
      var bs = comp(el).getPropertyValue('border-style');
      if (!bs || bs === 'none') {
        el.style.setProperty('border-style', 'solid');
        recordChange(el, 'border-style', snap['border-style'] || 'none', 'solid');
      }
    }
    el.style.setProperty(prop, value);
    var from = (prop in snap) ? snap[prop] : comp(el).getPropertyValue(prop);
    recordChange(el, prop, from, value);
    afterChange();
  }

  function resetEl() {
    var el = state.selected; if (!el) return;
    var r = recs.get(el);
    if (r) { Object.keys(r.changes).forEach(function (p) { el.style.removeProperty(p); }); r.changes = {}; }
    renderBody();
    afterChange();
  }

  function afterChange() {
    refreshInstructions();
    place(selBox, state.selected);
    pushUpdate();
  }

  // ---------------------------------------------------------------- instructions
  function hasNote(r) { return !!(r.note && r.note.trim()); }

  function changedRecs() {
    var out = [];
    recs.forEach(function (r) { if (Object.keys(r.changes).length || hasNote(r)) out.push(r); });
    return out;
  }

  function buildInstructions() {
    var list = changedRecs();
    var out = ['# tweak-ui change set', '', 'URL: ' + location.href,
      'Elements changed: ' + list.length, ''];
    list.forEach(function (r, i) {
      var m = r.meta;
      out.push('## Element ' + (i + 1) + ': <' + m.tag + '>' + (m.text ? ' "' + m.text + '"' : ''));
      out.push('- Match by (preferred): `' + m.selector + '`');
      if (m.cssPath && m.cssPath !== m.selector) out.push('- CSS path (fallback): `' + m.cssPath + '`');
      if (m.elementId) out.push('- id: ' + m.elementId);
      if (m.classes.length) out.push('- Classes: ' + m.classes.join(', '));
      out.push('- Markup: `' + m.markup + '`');
      if (hasNote(r)) out.push('', '**Instruction:** ' + r.note.trim());
      var ch = {}; Object.keys(r.changes).forEach(function (k) { ch[k] = r.changes[k]; });
      var snap = snapshots.get(r.el) || {};
      if (Object.keys(r.changes).length) {
        out.push('', 'Changes:');
        ['margin', 'padding'].forEach(function (box) {
          var sides = ['top', 'right', 'bottom', 'left'].map(function (s) { return box + '-' + s; });
          if (sides.some(function (s) { return ch[s]; })) {
            var from = sides.map(function (s) { return snap[s] || '0px'; }).join(' ');
            var to = sides.map(function (s) { return ch[s] ? ch[s].to : (snap[s] || '0px'); }).join(' ');
            out.push('- ' + box + ': ' + from + ' → ' + to);
            sides.forEach(function (s) { delete ch[s]; });
          }
        });
        Object.keys(ch).forEach(function (p) {
          out.push('- ' + p + ': ' + ch[p].from + ' → ' + ch[p].to);
        });
      }
      out.push('');
    });
    out.push('---',
      'Apply these visual changes to the corresponding source files/components. Match each ' +
      'element by its selector, classes, id, text and markup. Change only the listed CSS ' +
      'properties from the "from" value to the "to" value, using the project\'s existing ' +
      'styling convention (stylesheet, CSS module, inline style, Tailwind class, etc.).');
    return out.join('\n');
  }

  function payload() {
    return {
      url: location.href,
      elements: changedRecs().map(function (r) {
        var o = {}; Object.keys(r.meta).forEach(function (k) { o[k] = r.meta[k]; });
        o.changes = r.changes;
        o.note = (r.note || '').trim();
        return o;
      }),
      instructions: buildInstructions()
    };
  }

  var pushTimer;
  function pushUpdate() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { send('update', payload()); }, 250);
  }

  function refreshInstructions() {
    if (taEl) taEl.value = buildInstructions();
    if (countEl) countEl.textContent = changedRecs().length + ' element(s) tweaked';
  }

  // ---------------------------------------------------------------- highlight boxes
  function mkBox(color) {
    var d = document.createElement('div');
    d.className = '__tweakui-box';
    d.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid ' +
      color + ';border-radius:2px;display:none;box-sizing:border-box;';
    document.documentElement.appendChild(d);
    return d;
  }
  var hoverBox, selBox;   // created in init(), once a DOM root exists

  function place(box, el) {
    if (!box) return;
    if (!el || !el.getBoundingClientRect) { box.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
  }

  function isOurs(el) {
    return el && el.closest && (el.closest('.__tweakui-host') || el.closest('.__tweakui-box'));
  }

  // ---------------------------------------------------------------- picking
  document.addEventListener('mousemove', function (e) {
    if (!state.pick) { hoverBox.style.display = 'none'; return; }
    if (isOurs(e.target)) { hoverBox.style.display = 'none'; return; }
    place(hoverBox, e.target);
  }, true);

  document.addEventListener('click', function (e) {
    if (!state.pick || isOurs(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    select(e.target);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { state.selected = null; place(selBox, null); renderBody(); }
  }, true);

  window.addEventListener('scroll', function () {
    place(selBox, state.selected); place(hoverBox, null);
  }, true);
  window.addEventListener('resize', function () { place(selBox, state.selected); });

  function select(el) {
    state.selected = el;
    ensureSnapshot(el);
    getRec(el);
    place(selBox, el);
    renderBody();
    refreshInstructions();
    pushUpdate();
  }

  // ---------------------------------------------------------------- DOM helper
  function h(tag, props) {
    var n = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === 'class') n.className = props[k];
      else if (k === 'style') n.style.cssText = props[k];
      else if (k === 'html') n.innerHTML = props[k];
      else if (k === 'text') n.textContent = props[k];
      else n.setAttribute(k, props[k]);
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x != null) n.append(x); });
      else n.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return n;
  }

  // ---------------------------------------------------------------- control rows
  function colorRow(label, prop) {
    var cur = comp(state.selected).getPropertyValue(prop);
    var hex = toHex(cur);
    var color = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000' });
    var text = h('input', { type: 'text', class: 'hex', value: hex });
    function apply(v) { setStyle(prop, v); text.value = v; if (/^#[0-9a-f]{6}$/i.test(v)) color.value = v; }
    color.oninput = function () { apply(color.value); };
    text.onchange = function () { apply(text.value.trim()); };
    return h('div', { class: 'row' }, h('label', { text: label }), color, text);
  }

  function sliderRow(label, prop, min, max, step, unit) {
    var raw = parseFloat(comp(state.selected).getPropertyValue(prop));
    var cur = isNaN(raw) ? 0 : raw;
    var range = h('input', { type: 'range', min: min, max: max, step: step, value: cur });
    var num = h('input', { type: 'number', class: 'num', min: min, max: max, step: step, value: cur });
    function apply(v) { setStyle(prop, unit ? (v + unit) : String(v)); range.value = v; num.value = v; }
    range.oninput = function () { apply(range.value); };
    num.oninput = function () { apply(num.value); };
    return h('div', { class: 'row' }, h('label', { text: label }), range, num,
      h('span', { class: 'unit', text: unit || '' }));
  }

  function selectRow(label, prop, options) {
    var cur = comp(state.selected).getPropertyValue(prop);
    var sel = h('select', { class: 'sel' });
    options.forEach(function (o) {
      var opt = h('option', { value: o }, o);
      if (String(o) === String(cur)) opt.selected = true;
      sel.append(opt);
    });
    sel.onchange = function () { setStyle(prop, sel.value); };
    return h('div', { class: 'row' }, h('label', { text: label }), sel);
  }

  function boxRow(label, prop) {
    var grid = h('div', { class: 'grid4' });
    ['top', 'right', 'bottom', 'left'].forEach(function (s) {
      var raw = parseFloat(comp(state.selected).getPropertyValue(prop + '-' + s));
      var inp = h('input', { type: 'number', value: isNaN(raw) ? 0 : raw, title: s });
      inp.oninput = function () { setStyle(prop + '-' + s, inp.value + 'px'); };
      grid.append(inp);
    });
    return h('div', { class: 'boxrow' }, h('label', { text: label }), grid);
  }

  function section(title) {
    var sec = h('div', { class: 'sec' }, h('div', { class: 'h', text: title }));
    for (var i = 1; i < arguments.length; i++) sec.append(arguments[i]);
    return sec;
  }

  // ---------------------------------------------------------------- body render
  function renderBody() {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    var el = state.selected;
    if (!el) {
      bodyEl.append(h('div', { class: 'empty' },
        'Picking is ON. Hover the page and click any element to start tweaking it.'));
      return;
    }
    var m = meta(el);
    var resetBtn = h('button', { class: 'mini', text: 'Reset element' });
    resetBtn.onclick = resetEl;
    bodyEl.append(h('div', { class: 'elinfo' },
      h('span', { class: 'tag', text: '<' + m.tag + '>' }),
      m.classes.length ? h('span', { text: ' .' + m.classes.join('.') }) : null,
      m.dataId ? h('div', { class: 'sel', text: '⌖ ' + m.selector }) : h('div', { class: 'sel', text: m.selector }),
      resetBtn
    ));

    var rec = getRec(el);
    var noteTa = h('textarea', { class: 'note', spellcheck: 'false',
      placeholder: 'Tell Claude what to do with this element in words — e.g. "make this a pill-shaped gradient button" or "swap to a two-column layout". Applied to source alongside the controls below.' });
    noteTa.value = rec.note || '';
    noteTa.oninput = function () { rec.note = noteTa.value; refreshInstructions(); pushUpdate(); };
    bodyEl.append(section('Instruction for Claude', noteTa));

    bodyEl.append(section('Color',
      colorRow('Text', 'color'),
      colorRow('Background', 'background-color'),
      colorRow('Border', 'border-color')));
    bodyEl.append(section('Border & shape',
      sliderRow('Border width', 'border-width', 0, 16, 1, 'px'),
      sliderRow('Radius', 'border-radius', 0, 80, 1, 'px')));
    bodyEl.append(section('Effects',
      sliderRow('Opacity', 'opacity', 0, 1, 0.05, '')));
    bodyEl.append(section('Typography',
      sliderRow('Font size', 'font-size', 8, 80, 1, 'px'),
      selectRow('Font weight', 'font-weight', [100, 200, 300, 400, 500, 600, 700, 800, 900])));
    bodyEl.append(section('Spacing',
      boxRow('Margin  (top / right / bottom / left)', 'margin'),
      boxRow('Padding  (top / right / bottom / left)', 'padding')));
  }

  // ---------------------------------------------------------------- toast
  function toast(msg) {
    var t = document.createElement('div');
    t.className = '__tweakui-box';
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'background:#18181b;color:#fafafa;padding:10px 16px;border-radius:10px;font-weight:500;' +
      'border:1px solid #2a2a2e;font-family:-apple-system,sans-serif;font-size:12.5px;letter-spacing:-.01em;' +
      'z-index:2147483647;box-shadow:0 12px 40px rgba(0,0,0,.45);';
    t.textContent = msg;
    document.documentElement.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 4000);
  }

  // ---------------------------------------------------------------- build panel
  function build() {
    var host = document.createElement('div');
    host.className = '__tweakui-host';
    var root = host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);

    var style = document.createElement('style');
    style.textContent = [
      ':host{all:initial}',
      '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,sans-serif}',

      /* ---- palette: dark (default) ---- */
      '.panel{--bg:#0c0c0e;--elev:#151517;--input:#151517;--border:#232327;--text:#ededef;' +
        '--muted:#85858f;--accent:#6366f1;--accent-fg:#ffffff;--hover:#1c1c20;--ring:rgba(99,102,241,.35);' +
        '--shadow:0 12px 40px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.4)}',
      /* ---- palette: light ---- */
      '.panel.light{--bg:#ffffff;--elev:#f7f7f8;--input:#ffffff;--border:#ececef;--text:#18181b;' +
        '--muted:#71717a;--accent:#6366f1;--accent-fg:#ffffff;--hover:#f3f3f5;--ring:rgba(99,102,241,.25);' +
        '--shadow:0 12px 40px rgba(20,20,40,.14),0 2px 8px rgba(20,20,40,.06)}',

      /* ---- shell ---- */
      '.panel{position:fixed;top:14px;right:14px;width:328px;max-height:calc(100vh - 28px);background:var(--bg);' +
        'color:var(--text);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);display:flex;' +
        'flex-direction:column;font-size:12px;overflow:hidden;transition:background .2s,color .2s,border-color .2s}',

      /* ---- header ---- */
      '.hdr{display:flex;align-items:center;gap:8px;padding:11px 12px;cursor:move;border-bottom:1px solid var(--border)}',
      '.hdr .dot{width:7px;height:7px;border-radius:50%;background:var(--accent)}',
      '.hdr .t{font-weight:600;font-size:12.5px;letter-spacing:-.01em}',
      '.hdr .sp{flex:1}',

      /* ---- buttons ---- */
      'button{font:inherit;background:transparent;color:var(--text);border:1px solid var(--border);border-radius:8px;' +
        'padding:6px 11px;cursor:pointer;font-size:11px;font-weight:500;transition:background .15s,border-color .15s,color .15s}',
      'button:hover{background:var(--hover)}',
      'button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg);font-weight:600}',
      'button.primary:hover{filter:brightness(1.08)}',
      '.iconbtn{width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;font-size:14px;line-height:1}',
      '.iconbtn.on{color:var(--accent);border-color:var(--accent)}',
      'button.mini{padding:4px 9px;font-size:10px;margin-top:9px;color:var(--muted)}',

      /* ---- body ---- */
      '.body{padding:13px 13px 4px;overflow:auto}',
      '.empty{color:var(--muted);text-align:center;padding:34px 16px;line-height:1.65}',
      '.elinfo{display:flex;flex-wrap:wrap;align-items:center;gap:6px;background:var(--elev);border:1px solid var(--border);' +
        'border-radius:10px;padding:9px 11px;margin-bottom:13px}',
      '.elinfo .tag{color:var(--accent);font-weight:600;font-family:ui-monospace,Menlo,monospace;font-size:11px}',
      '.elinfo .sel{flex-basis:100%;color:var(--muted);font-size:10px;margin-top:2px;line-height:1.45;' +
        'font-family:ui-monospace,Menlo,monospace;word-break:break-all}',

      /* ---- sections & controls ---- */
      '.sec{margin-bottom:15px}',
      '.sec>.h{color:var(--muted);text-transform:uppercase;font-size:9.5px;letter-spacing:.09em;margin:0 0 8px;font-weight:600}',
      '.row{display:flex;align-items:center;gap:9px;margin:8px 0}',
      '.row label{width:82px;color:var(--text);flex:none;font-size:11px}',
      '.row input[type=range]{flex:1;accent-color:var(--accent);height:3px}',
      '.row .unit{color:var(--muted);width:14px;font-size:10px}',
      'input.num,input.hex,.sel{width:60px;background:var(--input);border:1px solid var(--border);color:var(--text);' +
        'border-radius:7px;padding:5px 7px;font-size:11px}',
      '.sel{width:78px}',
      'input[type=color]{width:30px;height:28px;padding:2px;border:1px solid var(--border);border-radius:7px;background:var(--input);cursor:pointer}',
      '.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:5px}',
      '.grid4 input{width:100%;background:var(--input);border:1px solid var(--border);color:var(--text);border-radius:7px;' +
        'padding:5px;text-align:center;font-size:11px}',
      '.boxrow{margin:8px 0}',
      '.boxrow>label{display:block;color:var(--text);margin-bottom:5px;font-size:11px}',
      '.note{width:100%;height:68px;background:var(--input);border:1px solid var(--border);color:var(--text);border-radius:9px;' +
        'padding:9px;font-size:11px;line-height:1.5;resize:vertical;font-family:inherit}',
      '.note::placeholder{color:var(--muted)}',
      'input:focus,.note:focus,.sel:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--ring)}',

      /* ---- footer ---- */
      '.ftr{border-top:1px solid var(--border);padding:11px 13px;background:var(--bg)}',
      '.ftr .frow{display:flex;align-items:center;gap:8px;margin-bottom:7px}',
      '.ftr .lab{color:var(--muted);text-transform:uppercase;font-size:9.5px;letter-spacing:.09em;font-weight:600;flex:1}',
      '.ftr textarea{width:100%;height:118px;background:var(--elev);color:var(--text);border:1px solid var(--border);border-radius:9px;' +
        'padding:9px;font-family:ui-monospace,Menlo,monospace;font-size:10px;line-height:1.55;resize:vertical}',
      '.count{color:var(--muted);font-size:10px;margin-top:6px}',

      /* ---- scrollbars ---- */
      '.body::-webkit-scrollbar,.ftr textarea::-webkit-scrollbar{width:9px;height:9px}',
      '.body::-webkit-scrollbar-thumb,.ftr textarea::-webkit-scrollbar-thumb{background:var(--border);border-radius:9px;border:2px solid transparent;background-clip:padding-box}',
      '.body::-webkit-scrollbar-track,.ftr textarea::-webkit-scrollbar-track{background:transparent}'
    ].join('');
    root.append(style);

    pickBtn = h('button', { class: 'iconbtn on', title: 'Picking elements — click to pause', text: '⌖' });
    pickBtn.onclick = function () {
      state.pick = !state.pick;
      pickBtn.className = state.pick ? 'iconbtn on' : 'iconbtn';
      pickBtn.title = state.pick ? 'Picking elements — click to pause' : 'Picking paused — click to resume';
      if (!state.pick) hoverBox.style.display = 'none';
    };

    var themeBtn = h('button', { class: 'iconbtn', title: 'Toggle light / dark' });
    function applyTheme(t) {
      panel.classList.toggle('light', t === 'light');
      themeBtn.textContent = t === 'light' ? '☾' : '☀';
      themeBtn.title = 'Switch to ' + (t === 'light' ? 'dark' : 'light') + ' theme';
    }
    var theme = 'dark';
    try {
      theme = localStorage.getItem('__tweakui-theme') ||
        (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    } catch (e) {}
    themeBtn.onclick = function () {
      theme = theme === 'light' ? 'dark' : 'light';
      applyTheme(theme);
      try { localStorage.setItem('__tweakui-theme', theme); } catch (e) {}
    };

    var finishBtn = h('button', { class: 'primary', text: 'Apply & Finish' });
    finishBtn.onclick = function () {
      send('finish', payload());
      toast('Sent to Claude — you can close this window');
    };

    var hdr = h('div', { class: 'hdr' },
      h('span', { class: 'dot' }), h('span', { class: 't', text: 'tweak-ui' }),
      h('span', { class: 'sp' }), themeBtn, pickBtn, finishBtn);

    bodyEl = h('div', { class: 'body' });

    taEl = h('textarea', { readonly: 'true', spellcheck: 'false' });
    var copyBtn = h('button', { text: 'Copy' });
    copyBtn.onclick = function () {
      taEl.select();
      try { navigator.clipboard.writeText(taEl.value); } catch (e) { document.execCommand('copy'); }
      copyBtn.textContent = 'Copied!';
      setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1200);
    };
    countEl = h('div', { class: 'count', text: '0 element(s) tweaked' });
    var ftr = h('div', { class: 'ftr' },
      h('div', { class: 'frow' }, h('span', { class: 'lab', text: 'Generated instructions' }), copyBtn),
      taEl, countEl);

    var panel = h('div', { class: 'panel' }, hdr, bodyEl, ftr);
    root.append(panel);

    applyTheme(theme);
    makeDraggable(panel, hdr);
    renderBody();
    refreshInstructions();
  }

  function makeDraggable(panel, handle) {
    var sx, sy, ox, oy, dragging = false;
    handle.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      var r = panel.getBoundingClientRect(); ox = r.left; oy = r.top;
      panel.style.right = 'auto';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      panel.style.left = (ox + e.clientX - sx) + 'px';
      panel.style.top = (oy + e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', function () { dragging = false; });
  }

  // Create highlight boxes + panel. Safe only once a DOM root exists, so this
  // is gated by boot() below — addInitScript runs us at document_start, where
  // document.documentElement is still null.
  function init() {
    hoverBox = mkBox('rgba(99,102,241,.55)');   // indigo, soft — hover
    selBox = mkBox('#6366f1');                   // indigo, solid — selection
    build();
  }

  function boot() {
    if (!document.documentElement) { requestAnimationFrame(boot); return; }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }
  boot();
})();
