/* MoneyMonkey app — Layout: reorder, pin and hide the boxes on every page.
 * The js/app/*.js files are loaded in order as plain scripts and share one scope (see index.html). */
'use strict';

// ================================================================== layout
// Every page's summary boxes (and Home's / Cash Flow's larger sections) sit in containers marked
// `data-layout`, each box with a stable `data-box` name. After a page is drawn, `applyLayout`
// puts the boxes in the saved order and hides hidden ones. Pinned boxes (from any page that can
// be pinned) show in a row at the top of Home. Saved in settings, so it syncs to other devices.

let layoutEditing = null; // the page being edited, or null
// Pages whose summary boxes can be pinned to Home (their boxes don't depend on which item is open).
const PINNABLE = { dashboard: 'Home', cashflows: 'Cash Flow', accounts: 'Cash & Bank', stocks: 'Stocks', crypto: 'Crypto', deposits: 'Fixed deposits', properties: 'Property', others: 'Other assets', liabilities: 'Debts' };

function layoutCfg() {
  const l = state.settings.layout || {};
  return { pages: { ...(l.pages || {}) }, pins: [...(l.pins || [])] };
}
function saveLayout(cfg) {
  state.settings = { ...state.settings, layout: cfg };
  state.settingsMt = Date.now();
  save();
  queueSync();
}

// The summary boxes of a page, as drawn there (for showing a pinned copy on Home).
function pageTiles(page) {
  if (page === 'dashboard') return dashboardTiles();
  if (page === 'cashflows') return cashflowTiles();
  if (SECTIONS[page]) return sectionTiles(page, state[page]);
  return '';
}
// A pinned account, holding, deposit, property, other asset or loan: its name and value.
function pinnedItemTile(pin) {
  const [, key, id] = pin.split('|');
  const item = (state[key] || []).find((x) => x.id === id);
  if (!item || !SECTIONS[key]) return null;
  const value = SECTIONS[key].total([item]);
  const open = key === 'accounts' ? `data-action="open-account" data-id="${esc(id)}"` : `data-action="edit" data-sec="${key}" data-id="${esc(id)}"`;
  const sub = [item.platform || '', key === 'stocks' || key === 'crypto' ? `${num(item.quantity, 8)} · ${pct(hv(item).pnlPct)}` : ''].filter(Boolean).join(' · ');
  const tpl = document.createElement('template');
  tpl.innerHTML = tile(`<span class="keep-case">${esc(itemName(key, item))}</span>`, key === 'liabilities' ? `<span class="owed">${money(value, base(), 0)}</span>` : money(value, base(), 0), sub, '', open);
  const el = tpl.content.firstElementChild;
  el.dataset.box = pin;
  el.insertAdjacentHTML('beforeend', `<div class="tile-from">${esc(PINNABLE[key] || key)}</div>`);
  return el;
}

function pinnedTile(pin) {
  if (pin.startsWith('item|')) return pinnedItemTile(pin);
  const [page, box] = pin.split('|');
  const tpl = document.createElement('template');
  tpl.innerHTML = pageTiles(page);
  const el = tpl.content.querySelector(`[data-box="${CSS.escape(box)}"]`);
  if (!el) return null;
  el.dataset.box = pin;
  if (page !== 'dashboard') el.insertAdjacentHTML('beforeend', `<div class="tile-from">${esc(PINNABLE[page] || page)}</div>`);
  return el;
}

function applyLayout() {
  const main = $('#main');
  const view = currentView;
  const cfg = layoutCfg();
  const editing = layoutEditing === view;
  // Name the summary-box rows of this page (tiles, tiles2…).
  let n = 0;
  for (const c of main.querySelectorAll('.tiles')) if (!c.dataset.layout) c.dataset.layout = n++ ? `tiles${n}` : 'tiles';
  // Home: pinned boxes first, in their own row.
  if (view === 'dashboard' && cfg.pins.length) {
    const row = document.createElement('section');
    row.className = 'tiles pinned';
    row.dataset.layout = 'pinned';
    for (const pin of cfg.pins) {
      const own = pin.startsWith('dashboard|') && main.querySelector(`.tiles:not(.pinned) [data-box="${CSS.escape(pin.slice(10))}"]`);
      const el = own || pinnedTile(pin);
      if (!el) continue;
      if (own) el.dataset.box = pin;
      row.appendChild(el);
    }
    const first = main.querySelector('.tiles[data-layout="tiles"]');
    if (row.children.length && first) first.before(row);
  }
  const containers = [...main.querySelectorAll('[data-layout]')];
  for (const c of containers) {
    const key = `${view}:${c.dataset.layout}`;
    const pc = cfg.pages[key] || {};
    const order = c.dataset.layout === 'pinned' ? cfg.pins : pc.order || [];
    const hidden = new Set(c.dataset.layout === 'pinned' ? [] : pc.hidden || []);
    const boxes = [...c.children].filter((el) => el.dataset.box);
    const rank = (el, i) => { const k = order.indexOf(el.dataset.box); return k >= 0 ? k : order.length + i; };
    boxes.map((el, i) => [el, rank(el, i)]).sort((a, b) => a[1] - b[1]).forEach(([el]) => c.appendChild(el));
    for (const el of boxes) {
      if (!hidden.has(el.dataset.box)) continue;
      if (editing) el.classList.add('is-hidden');
      else el.hidden = true;
    }
    if (editing) for (const el of boxes) addBoxControls(el, c, view, hidden.has(el.dataset.box));
    c.classList.toggle('layout-editing', editing);
  }
  if (!containers.length) return;
  // The "Edit layout" button (or, while editing, the editing bar) above the first box row.
  if (!editing) {
    // A small button in the page's header (its own row only on pages without one).
    const btn = `<button class="btn icon-only edit-layout-btn" data-lay="edit" title="Edit layout" aria-label="Edit layout">${icon('grip')}</button>`;
    const spot = main.querySelector('.head-actions') || main.querySelector('.page-head .row-actions');
    if (spot) return spot.insertAdjacentHTML('afterbegin', btn);
    const head = main.querySelector('.page-head');
    if (head) return head.insertAdjacentHTML('beforeend', `<div class="row-actions">${btn}</div>`);
  }
  const bar = document.createElement('div');
  bar.className = `layout-bar${editing ? ' on' : ''}`;
  bar.innerHTML = editing
    ? `<span class="grow"><strong>Editing layout</strong> <span class="sub">— drag ${icon('grip')} or use the arrows · ${PINNABLE[view] || [...main.querySelectorAll('[data-layout^="list-"]')].some((c) => PINNABLE[c.dataset.layout.slice(5)]) ? 'pin to Home · ' : ''}hide boxes you don’t need</span></span><button class="btn small ghost" data-lay="reset">Reset</button><button class="btn small primary" data-lay="done">Done</button>`
    : `<button class="btn small ghost" data-lay="edit">${icon('grip')} Edit layout</button>`;
  containers[0].before(bar);
}

function addBoxControls(el, container, view, isHidden) {
  const pinned = container.dataset.layout === 'pinned';
  // List rows (accounts, holdings…): reorder and pin to Home, but not hide.
  const listKey = container.dataset.layout.startsWith('list-') ? container.dataset.layout.slice(5) : null;
  const pinKey = listKey ? (PINNABLE[listKey] && listKey !== 'dashboard' && listKey !== 'cashflows' ? `item|${listKey}|${el.dataset.box}` : null)
    : !pinned && PINNABLE[view] && container.classList.contains('tiles') ? `${view}|${el.dataset.box}` : null;
  const canPin = !!pinKey;
  const isPinned = canPin && layoutCfg().pins.includes(pinKey);
  const name = el.dataset.name || el.dataset.box;
  const ctl = document.createElement('div');
  ctl.className = 'box-ctl';
  ctl.innerHTML = `<button type="button" class="lay-btn drag" data-lay="drag" aria-label="Drag ${esc(name)}">${icon('grip')}</button>`
    + `<button type="button" class="lay-btn" data-lay="up" aria-label="Move ${esc(name)} earlier">${icon('up')}</button>`
    + `<button type="button" class="lay-btn" data-lay="down" aria-label="Move ${esc(name)} later">${icon('down')}</button>`
    + (pinned ? `<button type="button" class="lay-btn on" data-lay="unpin" aria-label="Unpin ${esc(name)} from Home">${icon('pin')}</button>` : '')
    + (canPin ? `<button type="button" class="lay-btn${isPinned ? ' on' : ''}" data-lay="pin" aria-pressed="${isPinned}" aria-label="${isPinned ? 'Unpin' : 'Pin'} ${esc(name)} ${isPinned ? 'from' : 'to'} Home">${icon('pin')}</button>` : '')
    + (pinned || listKey ? '' : `<button type="button" class="lay-btn" data-lay="hide" aria-pressed="${isHidden}" aria-label="${isHidden ? 'Show' : 'Hide'} ${esc(name)}">${icon(isHidden ? 'eyeOff' : 'eye')}</button>`);
  if (canPin) ctl.dataset.pin = pinKey;
  // In a table row the controls go in the last cell (beside Buy / Sell), not over the row.
  if (el.tagName === 'TR') { ctl.classList.add('inline'); el.lastElementChild.prepend(ctl); } else el.appendChild(ctl);
}

// Saves a row's order (or the pinned row's) from what's on screen.
function saveOrder(container) {
  const cfg = layoutCfg();
  const ids = [...container.children].filter((el) => el.dataset.box).map((el) => el.dataset.box);
  if (container.dataset.layout === 'pinned') cfg.pins = ids;
  else {
    const key = `${currentView}:${container.dataset.layout}`;
    cfg.pages[key] = { ...(cfg.pages[key] || {}), order: ids };
  }
  saveLayout(cfg);
}

// While editing, taps on a box don't open it (only its controls work).
document.addEventListener('click', (e) => {
  if (!layoutEditing || e.target.closest('.box-ctl') || !e.target.closest('#main [data-box]')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-lay]');
  if (!b) return;
  // The controls sit inside a box: keep the box (or its links) from reacting too.
  e.preventDefault();
  e.stopImmediatePropagation();
  if (b.dataset.lay === 'drag') return;
  const what = b.dataset.lay;
  if (what === 'edit') { layoutEditing = currentView; return render(); }
  if (what === 'done') { layoutEditing = null; render(); return toast('Layout saved'); }
  if (what === 'reset') {
    if (!confirm(`Put the boxes on this page back in their usual order and show them all?${currentView === 'dashboard' ? ' Pinned boxes are unpinned too.' : ''}`)) return;
    const cfg = layoutCfg();
    for (const k of Object.keys(cfg.pages)) if (k.startsWith(`${currentView}:`)) delete cfg.pages[k];
    if (currentView === 'dashboard') cfg.pins = [];
    saveLayout(cfg);
    return render();
  }
  const el = b.closest('[data-box]');
  const container = el && el.parentElement;
  if (!el || !container) return;
  if (what === 'up' || what === 'down') {
    const boxes = [...container.children].filter((x) => x.dataset.box);
    const i = boxes.indexOf(el);
    const j = what === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= boxes.length) return;
    if (what === 'up') boxes[j].before(el);
    else boxes[j].after(el);
    saveOrder(container);
    b.focus();
    return;
  }
  const cfg = layoutCfg();
  if (what === 'hide') {
    const key = `${currentView}:${container.dataset.layout}`;
    const pc = cfg.pages[key] || {};
    const hidden = new Set(pc.hidden || []);
    if (hidden.has(el.dataset.box)) hidden.delete(el.dataset.box);
    else hidden.add(el.dataset.box);
    cfg.pages[key] = { ...pc, hidden: [...hidden] };
  } else if (what === 'pin' || what === 'unpin') {
    const pin = what === 'unpin' ? el.dataset.box : b.closest('.box-ctl').dataset.pin;
    cfg.pins = cfg.pins.includes(pin) ? cfg.pins.filter((x) => x !== pin) : [...cfg.pins, pin];
    if (what === 'pin') toast(cfg.pins.includes(pin) ? `Pinned to Home: ${el.dataset.name || ''}` : 'Unpinned from Home');
  }
  saveLayout(cfg);
  render();
});

// Dragging: hold the ⠿ handle and move. The box moves past whichever box is under your finger;
// the page scrolls when you're near the top or bottom edge.
document.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('[data-lay="drag"]');
  if (!handle) return;
  const el = handle.closest('[data-box]');
  const container = el.parentElement;
  e.preventDefault();
  // Followed on the window: moving the box in the page would end a capture on the handle.
  const id = e.pointerId;
  el.classList.add('dragging');
  let lastY = e.clientY;
  let scrollTimer = null;
  const autoScroll = () => {
    const edge = 70;
    const dy = lastY < edge ? -12 : lastY > window.innerHeight - edge - 70 ? 12 : 0;
    if (dy) window.scrollBy(0, dy);
  };
  scrollTimer = setInterval(autoScroll, 16);
  const move = (ev) => {
    if (ev.pointerId !== id) return;
    ev.preventDefault();
    lastY = ev.clientY;
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    // The box in this row under the finger (it may be pointing at something inside a box).
    let target = under && under.closest('[data-box]');
    while (target && target.parentElement !== container) target = target.parentElement.closest('[data-box]');
    if (!target || target === el || target.parentElement !== container) return;
    const boxes = [...container.children];
    if (boxes.indexOf(target) > boxes.indexOf(el)) target.after(el);
    else target.before(el);
  };
  const end = (ev) => {
    if (ev.pointerId !== id) return;
    clearInterval(scrollTimer);
    el.classList.remove('dragging');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    saveOrder(container);
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
});
