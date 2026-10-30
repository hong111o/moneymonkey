/* MoneyMonkey app — Events and start-up.
 * The js/app/*.js files are loaded in order as plain scripts and share one scope (see index.html). */
'use strict';

// ================================================================== events

// ± next to a number: flip its sign (works in forms, balance lines and the check-in).
document.addEventListener('click', (e) => {
  const pm = e.target.closest('[data-pm]');
  if (!pm) return;
  e.preventDefault();
  const input = pm.parentElement.querySelector('input');
  if (input.value === '' || !isFinite(+input.value)) { input.focus(); return toast('Type the number first, then tap ± to make it negative.'); }
  input.value = String(-+input.value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const { action, sec, id } = b.dataset;
  if (b.tagName === 'A' && b.getAttribute('href') === '#') e.preventDefault();
  switch (action) {
    case 'add': {
      const preset = {};
      if (b.dataset.platform != null) preset.platform = b.dataset.platform;
      if (b.dataset.account) preset.accountId = b.dataset.account;
      if (b.dataset.card) preset.cardId = b.dataset.card;
      if (b.dataset.kind) preset.kind = b.dataset.kind;
      if (b.dataset.once) Object.assign(preset, { frequency: 'once', category: 'One-off', kind: 'income' });
      if (b.dataset.type) {
        preset.type = b.dataset.type;
        if (b.dataset.type === 'brokerage' && preset.platform) preset.name = `${preset.platform} cash`;
      }
      return editItem(sec, null, preset);
    }
    case 'review-payments': return reviewPayments();
    case 'target-mix': return openTargetMix();
    case 'extend-cf': return openExtend(b.dataset.id);
    case 'checkin': return openCheckin();
    case 'transfer': return openTransfer(b.dataset.account);
    case 'open-account': location.hash = `#account/${encodeURIComponent(id)}`; return;
    case 'open-platform': location.hash = `#platform/${encodeURIComponent(b.dataset.name)}`; return;
    case 'open-region': location.hash = `#region/${encodeURIComponent(b.dataset.name)}`; return;
    case 'open-card': location.hash = `#card/${encodeURIComponent(id)}`; return;
    case 'pay-card': return payCardBill(id);
    case 'open-event': return openEvent(b.dataset);
    case 'search': return openSearch();
    case 'report-year': reportYear = b.dataset.year; return render();
    case 'cf-tab': cfTab = b.dataset.tab; return render();
    case 'spend-all': spendAll = !spendAll; return render();
    case 'export-report': return exportReportCsv(b.dataset.what);
    case 'attention': return openSheet('Needs attention', `<ul class="alerts">${dashboardAlerts().map(alertItem).join('')}</ul>`, (e) => { if (e.target.closest('a')) dialog().close(); });
    case 'activity-all': filters.activityAll = id; return render();
    case 'undo-payment': {
      const entry = state.activity.find((x) => x.id === id);
      if (!entry || !confirm(`Undo “${entry.name}”? Any balance change is reversed and you’ll be asked about it again.`)) return;
      const key = Calc.undoPayment(state, id, Date.now());
      commit();
      toast('Undone — answer it again');
      if (key && Calc.pendingPayments(state, todayISO()).some((p) => p.key === key)) reviewPayments();
      return;
    }
    case 'saver-toggle': {
      const dep = state.deposits.find((d) => d.id === id);
      const date = b.dataset.date;
      if (!dep) return;
      const entryId = `pay-rs:${dep.id}:${date}`;
      if (state.activity.some((x) => x.id === entryId)) Calc.undoPayment(state, entryId, Date.now());
      else {
        const paid = Calc.regularPaid(dep, date, false) > 0;
        dep.paid = { ...(dep.paid || {}), [date]: paid ? 0 : +dep.monthlyAmount };
        if (dep.reask) dep.reask = dep.reask.filter((x) => x !== date);
        dep._mt = Date.now();
      }
      commit();
      editItem('deposits', dep.id);
      return;
    }
    case 'trade-buy': return openTrade(sec, id, 'buy');
    case 'trade-sell': return openTrade(sec, id, 'sell');
    case 'trade-more': return openTrade(sec, id, 'dividend');
    case 'match-confirm': {
      const cf = state.cashflows.find((c) => c.id === id);
      const key = { loan: 'loanId', rent: 'propertyId', saver: 'saverId' }[b.dataset.kind];
      if (cf && key) { cf[key] = b.dataset.target; cf._mt = Date.now(); commit(); toast(`“${cf.name}” linked — you can change it in its form`); }
      return;
    }
    case 'saver-unmatch': {
      const cf = state.cashflows.find((c) => c.id === id);
      if (cf) { cf.notSaver = true; cf._mt = Date.now(); commit(); toast(`“${cf.name}” now counts as separate saving`); }
      return;
    }
    case 'rent-unmatch': {
      const cf = state.cashflows.find((c) => c.id === id);
      if (cf) { cf.notRent = true; delete cf.propertyId; cf._mt = Date.now(); commit(); toast(`“${cf.name}” now counts as separate income`); }
      return;
    }
    case 'loan-unmatch': {
      const cf = state.cashflows.find((c) => c.id === id);
      if (cf) { cf.notLoan = true; delete cf.loanId; cf._mt = Date.now(); commit(); toast(`“${cf.name}” now counts as a normal bill`); }
      return;
    }
    case 'jump': { const el = document.getElementById(b.dataset.target); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    case 'explain': return explain(b.dataset.what, b.dataset.cat);
    case 'edit': return editItem(sec, id);
    case 'edit-platform': return editPlatform(b.dataset.name);
    case 'valuation': return updateValuation(id);
    case 'quick-add': return quickAdd();
    case 'menu': return openMenu();
    case 'range': historyRange = b.dataset.range; return render();
    case 'month-range': monthRange = b.dataset.range; return render();
    case 'cur-filter':
      filters.accountsCurrency = b.dataset.cur && filters.accountsCurrency !== b.dataset.cur ? b.dataset.cur : null;
      return render();
    case 'refresh': return refreshPrices({ force: true, announce: true });
    case 'privacy': state.settings.privacy = !state.settings.privacy; save(); return render();
    case 'sync-setup': return setupSync();
    case 'sync-now': return syncNow({ manual: true });
    case 'sync-disconnect': return disconnectSync();
    case 'unlock': return unlockSync();
    case 'sync-status': if (!sessionPass) return unlockSync(); location.hash = '#settings'; return;
    case 'export-json': return download(`moneymonkey-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
    case 'export-csv': return exportCsv();
    case 'demo':
      if (syncCfg.token) return toast('Demo data is disabled while sync is on, so it can’t mix into your real data. Disconnect sync first.', 'error');
      if (hasData() && !confirm('Replace ALL your current data with demo data? Export a backup first if you want to keep it.')) return;
      state = demoState();
      commit();
      location.hash = '#dashboard';
      refreshPrices({ force: true });
      return;
    case 'reset': {
      const msg = syncCfg.token
        ? 'Erase all MoneyMonkey data on this device and disconnect sync? Your synced copy on GitHub is kept.'
        : 'Erase all MoneyMonkey data in this browser? This cannot be undone.';
      if (!confirm(msg)) return;
      state = defaultState();
      syncCfg = {};
      sessionPass = '';
      try { localStorage.removeItem(SYNC_KEY); } catch (err) { /* ignore */ }
      save();
      render();
      return;
    }
    default:
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.clickable, .card.clickable, li.clickable, .tile.clickable, .live-interest.clickable, .hbar.clickable, .split-row.clickable')) {
    e.preventDefault();
    e.target.click();
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'settings-form') return;
  e.preventDefault();
  const f = e.target.elements;
  const newBase = f.baseCurrency.value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(newBase)) return toast('Base currency must be a 3-letter code like HKD or GBP.', 'error');
  const baseChanged = newBase !== state.settings.baseCurrency;
  state.settings = { ...state.settings, name: f.name.value.trim().slice(0, 40), baseCurrency: newBase, finnhubKey: f.finnhubKey.value.trim(), refreshSec: Math.max(15, +f.refreshSec.value || 60), theme: f.theme.value, costMethod: f.costMethod.value, checkinDay: Math.min(31, Math.max(1, Math.round(+f.checkinDay.value) || 1)) };
  state.settingsMt = Date.now();
  save();
  schedule();
  render();
  queueSync();
  toast('Settings saved');
  refreshPrices({ force: baseChanged });
});

document.addEventListener('change', (e) => {
  if (e.target.matches('select[data-filter]')) {
    filters[e.target.dataset.filter] = e.target.value === '__all' ? null : e.target.value;
    return render();
  }
  if (e.target.id !== 'import-file' || !e.target.files[0]) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || !data.settings) throw new Error('not a MoneyMonkey backup');
      if (hasData() && !confirm('Replace your current data with this backup?' + (syncCfg.token ? ' Your other devices will get it too.' : ''))) return;
      const imported = normalize(data);
      // Make the import win over older synced copies, and remove items it doesn't contain.
      const now = Date.now();
      const keep = new Set();
      for (const s of LIST_SECTIONS) for (const item of imported[s]) { item._mt = now; keep.add(item.id); }
      for (const s of LIST_SECTIONS) for (const item of state[s]) if (!keep.has(item.id)) imported.deleted[item.id] = now;
      imported.settings.privacy = state.settings.privacy;
      imported.settingsMt = now;
      state = imported;
      commit();
      refreshPrices({ force: true });
      toast('Backup imported');
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'error');
    }
  };
  reader.readAsText(e.target.files[0]);
  e.target.value = '';
});

document.addEventListener('pointerover', (e) => {
  const t = e.target.closest('[data-tip]');
  if (t) tooltip.show(esc(t.dataset.tip), e.clientX, e.clientY, e.pointerType);
});
document.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) tooltip.hide(e.pointerType); });
window.addEventListener('scroll', () => tooltip.hide(), { passive: true });
// Tapping the backdrop around a dialog closes it.
dialog().addEventListener('click', (e) => { if (e.target === dialog()) dialog().close(); });
for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  refreshPrices();
  queueSync(200);
  setTimeout(maybePrompt, 2500);
});
window.addEventListener('hashchange', route);
window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) { state = load(); render(); } });

function fillDatalists() {
  const cats = new Set(['Housing', 'Food', 'Transport', 'Utilities', 'Entertainment', 'Health', 'Insurance', 'Education', 'Shopping', 'Software', 'Work', 'Investing']);
  state.cashflows.forEach((c) => c.category && cats.add(c.category));
  $('#category-list').innerHTML = [...cats].map((c) => `<option value="${esc(c)}">`).join('');
  const platforms = new Set();
  for (const s of [...PLATFORM_SECTIONS, 'spending']) for (const item of state[s]) if (item.platform) platforms.add(item.platform);
  PLATFORM_SUGGESTIONS.forEach((p) => platforms.add(p));
  $('#platform-list').innerHTML = [...platforms].map((p) => `<option value="${esc(p)}">`).join('');
  const regions = new Set(REGION_SUGGESTIONS);
  Object.values(state.platformMeta).forEach((m) => m.region && regions.add(m.region));
  $('#region-list').innerHTML = [...regions].map((r) => `<option value="${esc(r)}">`).join('');
}

// ================================================================== Title Case

// Headings, buttons, tabs, labels and other short names read in Title Case ("Net Cash Flow / Mo",
// "Add Fixed Deposit", "Bank Bills"). Sentences stay as they are, and so does grey helper text.
// Only all-lowercase words change, so names like "iPhone", "eToro", "HSBC" or "HK$5M" stay as
// typed; short joining words stay lowercase unless they come first. Elements marked `.keep-case`
// (the greeting, account and card names) are left alone.
const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'per', 'by', 'vs', 'via', 'from', 'with']);
const TITLE_SEL = 'h1, h2, h3, h4, .tile-label, th, .nav-group, .bal-head, .field-label, button, .btn, label, summary, option, .badge, .leg, strong, b, .menu-list a, .tabbar a, .choice, .grow, .goal-head, dt';
const TITLE_SKIP = '.keep-case, .sub, small, p, .intro, input, textarea, select:not(:has(option)), .toast, .ev-label, .tile-value, .hero-value';
function titleCase(text, first = true) {
  return text.replace(/[A-Za-z][A-Za-z'’]*/g, (w, i) => {
    if (w.length < 2 || w !== w.toLowerCase()) return w;
    const before = text.slice(0, i);
    if (/\d$|\d\/$/.test(before)) return w; // units after a number: "6d", "HK$20/day"
    // Short joining words stay lowercase, except as the first or last word ("From Now On").
    if (SMALL_WORDS.has(w) && !(first && !before.trim()) && /[A-Za-z]/.test(text.slice(i + w.length))) return w;
    return w[0].toUpperCase() + w.slice(1);
  });
}
// Reads like a sentence: ends with a full stop / question / colon, or is long.
const isSentence = (t) => /[.?!:]$/.test(t) || /\.\s/.test(t) || t.split(/\s+/).filter(Boolean).length > 6;
function titleCaseIn(root) {
  if (!root || root.nodeType !== 1) return;
  const els = root.matches(TITLE_SEL) ? [root] : [];
  els.push(...root.querySelectorAll(TITLE_SEL));
  for (const el of els) {
    // Buttons are always Title Case, even inside a sentence ("… or keep it going. [+1 Month]").
    const skip = el.matches('button, .btn') ? '.keep-case, input, textarea, .toast' : TITLE_SKIP;
    if (el.closest(skip)) continue;
    // Bold words inside a sentence ("tap <b>Set up sync</b>, then…") stay as the sentence has them.
    if (/^(STRONG|B)$/.test(el.tagName) && el.parentElement && isSentence(el.parentElement.textContent.replace(/\s+/g, ' ').trim())) continue;
    const nodes = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.parentElement.closest(skip)) continue;
      if (el.tagName !== 'OPTION' && n.parentElement.closest('select')) continue; // a label's own words, not its menu
      nodes.push(n);
    }
    const own = nodes.map((n) => n.nodeValue).join('').replace(/\s+/g, ' ').trim();
    if (!own || isSentence(own)) continue;
    let first = true;
    for (const n of nodes) {
      const t = titleCase(n.nodeValue, first);
      if (t !== n.nodeValue) n.nodeValue = t;
      if (n.nodeValue.trim()) first = false;
    }
  }
  for (const el of root.querySelectorAll('[data-label]')) el.dataset.label = titleCase(el.dataset.label);
}
new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) titleCaseIn(n.nodeType === 3 ? n.parentElement : n); })
  .observe(document.body, { childList: true, subtree: true });
titleCaseIn(document.body);

// ================================================================== boot

fillDatalists();
Calc.settleDeposits(state, todayISO(), Date.now());
route();
recordSnapshot();
save();
refreshPrices();
schedule();
// Ask about due payments / the monthly check-in once synced data has arrived.
Promise.resolve(syncNow()).finally(() => setTimeout(maybePrompt, 400));
setInterval(tickLive, 1000);
setInterval(() => { if (!document.hidden) syncNow(); }, SYNC_INTERVAL_MS);
// Re-render each minute so time-based values (deposit interest, maturities, dates) stay current.
setInterval(() => {
  if (document.hidden || dialog().open) return;
  if (Calc.settleDeposits(state, todayISO(), Date.now()).length) { commit(); return; }
  fillDatalists();
  render();
}, 60000);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}
