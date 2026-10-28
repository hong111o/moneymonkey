/* MoneyMonkey app — Views list, navigation and the dashboard.
 * The js/app/*.js files are loaded in order as plain scripts and share one scope (see index.html). */
'use strict';

// ================================================================== views

const VIEWS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home', group: 'Overview' },
  { id: 'platforms', label: 'Platforms', icon: 'grid', group: 'Overview' },
  { id: 'accounts', label: 'Cash & Bank', icon: 'wallet', group: 'Assets' },
  { id: 'stocks', label: 'Stocks', icon: 'trending', group: 'Assets' },
  { id: 'crypto', label: 'Crypto', icon: 'coins', group: 'Assets' },
  { id: 'deposits', label: 'Fixed Deposits', icon: 'percent', group: 'Assets', hidden: true },
  { id: 'properties', label: 'Property', icon: 'building', group: 'Assets' },
  { id: 'others', label: 'Other Assets', icon: 'gem', group: 'Assets' },
  { id: 'liabilities', label: 'Loans & Debts', icon: 'landmark', group: 'Owe & spend' },
  { id: 'cashflows', label: 'Cash Flow', icon: 'flow', group: 'Owe & spend' },
  { id: 'goals', label: 'Goals', icon: 'target', group: 'Owe & spend' },
  { id: 'reports', label: 'Reports & export', icon: 'report', group: 'Owe & spend' },
  { id: 'settings', label: 'Settings & Sync', icon: 'settings', group: '' },
  { id: 'account', hidden: true },
  { id: 'platform', hidden: true },
  { id: 'region', hidden: true },
  { id: 'card', hidden: true },
];
// Detail pages highlight their parent in the navigation.
const NAV_PARENT = { account: 'accounts', deposits: 'accounts', platform: 'platforms', region: 'platforms', card: 'cashflows' };

let currentView = 'dashboard';
let viewParam = null;
let historyRange = '90';
let monthRange = '3';
let reportYear = null;
let cfTab = 'overview';
let spendAll = false;
let summary = null;
const filters = {};

function route() {
  const [id, ...rest] = location.hash.replace('#', '').split('/');
  viewParam = rest.length ? decodeURIComponent(rest.join('/')) : null;
  currentView = VIEWS.some((v) => v.id === id) ? id : 'dashboard';
  render();
  window.scrollTo(0, 0);
}

function renderNav() {
  let group = null;
  const active = NAV_PARENT[currentView] || currentView;
  $('#nav').innerHTML = VIEWS.filter((v) => !v.hidden).map((v) => {
    const head = v.group !== group ? `${(group = v.group) ? `<div class="nav-group">${v.group}</div>` : '<div class="nav-sep"></div>'}` : '';
    return `${head}<a href="#${v.id}" class="${v.id === active ? 'active' : ''}"><span class="icon">${icon(v.icon)}</span><span>${v.label}</span>${navCount(v.id)}</a>`;
  }).join('');
  const tab = (id, ic, label) => `<a href="#${id}" class="${active === id ? 'active' : ''}"><span class="icon">${icon(ic)}</span><span>${label}</span></a>`;
  const inMore = !['dashboard', 'platforms', 'cashflows'].includes(active);
  $('#tabbar').innerHTML = `${tab('dashboard', 'home', 'Home')}${tab('platforms', 'grid', 'Platforms')}
    <button class="tab-add" data-action="quick-add" aria-label="Add something">${icon('plus')}</button>
    ${tab('cashflows', 'flow', 'Cash flow')}
    <button data-action="menu" class="${inMore ? 'active' : ''}"><span class="icon">${icon('menu')}</span><span>More</span></button>`;
}

function navCount(id) {
  const n = Array.isArray(state[id]) ? state[id].length : 0;
  return n && SECTIONS[id] ? `<span class="count">${n}</span>` : '';
}

function render() {
  summary = Calc.summarize(state, todayISO());
  if (state.settings.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = state.settings.theme;
  const pb = $('#privacy-btn');
  pb.setAttribute('aria-pressed', String(!!state.settings.privacy));
  pb.innerHTML = state.settings.privacy ? `${icon('eyeOff')}<span class="hide-sm"> Show amounts</span>` : `${icon('eye')}<span class="hide-sm"> Hide amounts</span>`;
  pb.title = state.settings.privacy ? 'Show amounts' : 'Hide amounts';
  renderNav();
  renderStatus();
  const main = $('#main');
  if (currentView === 'dashboard') main.innerHTML = renderDashboard();
  else if (currentView === 'settings') main.innerHTML = renderSettings();
  else if (currentView === 'platforms') main.innerHTML = renderPlatforms();
  else if (currentView === 'cashflows') main.innerHTML = renderCashflows();
  else if (currentView === 'goals') main.innerHTML = renderGoals();
  else if (currentView === 'reports') main.innerHTML = renderReports();
  else if (currentView === 'account') main.innerHTML = renderAccount(viewParam);
  else if (currentView === 'platform') main.innerHTML = renderPlatformDetail(viewParam ?? '');
  else if (currentView === 'region') main.innerHTML = renderRegion(viewParam ?? '');
  else if (currentView === 'card') main.innerHTML = renderCard(viewParam);
  else main.innerHTML = renderSection(currentView);
  Charts.bindLineHover(main, tooltip);
  tickLive();
}

function renderStatus() {
  const anyLive = state.stocks.some((s) => s.source !== 'manual') || state.crypto.some((c) => c.source !== 'manual');
  $('#status').innerHTML = refreshing
    ? '<span class="spinner"></span> Updating prices…'
    : `${anyLive ? '<span class="live-dot"></span>' : ''}Prices ${ago(state.pricesUpdatedAt)}`;
  renderSyncStatus();
}

function renderSyncStatus() {
  const el = $('#sync-status');
  if (!syncCfg.token) { el.hidden = true; return; }
  el.hidden = false;
  let cls = 'ok', text = `Synced ${ago(syncCfg.lastSync)}`;
  if (syncing) { cls = 'busy'; text = 'Syncing…'; }
  else if (!sessionPass) { cls = 'warn'; text = 'Sync locked'; }
  else if (syncCfg.lastError) { cls = 'err'; text = 'Sync problem'; }
  el.className = `sync-chip ${cls}`;
  el.title = syncCfg.lastError || text;
  el.innerHTML = `<span class="cloud" aria-hidden="true">☁</span><span class="hide-sm">${text}</span>`;
}

// ---------------------------------------------------------------- dashboard

// `attrs` (e.g. data-action="explain" data-what="assets") makes the tile tappable.
function tile(label, value, sub = '', extra = '', attrs = '') {
  const tap = attrs ? ` clickable tile-link" ${attrs} tabindex="0" role="button` : '';
  return `<div class="tile ${extra}${tap}"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
}
const explainAttr = (what) => `data-action="explain" data-what="${what}"`;
// A platform's or region's total of one kind (cash, deposits, invest, property, debt).
const partAttr = (scope, name, kind) => `${explainAttr('part')} data-cat="${esc([scope, kind, name || ''].map(encodeURIComponent).join('|'))}"`;

function activityText(e) {
  const ref = e.ref ? ` (${esc(e.ref)})` : '';
  if (e.kind === 'deposit-cash') return `${e.saver ? 'Regular saver' : 'Fixed deposit'} at ${esc(e.platform)}${ref} matured — ${money(e.amount, e.currency)} incl. ${money(e.interest, e.currency)} interest moved to “${esc(e.accountName)}”.`;
  if (e.kind === 'deposit-renew') return `Fixed deposit at ${esc(e.platform)}${ref} matured and renewed with ${money(e.amount, e.currency)} (incl. ${money(e.interest, e.currency)} interest).`;
  if (e.kind === 'payment') {
    const name = esc(e.name).replace(/\((\d{4}-\d{2})\)/, (_, m) => `(${fmtMonth(m)})`);
    if (e.outcome === 'notpaid') return `${name}: marked as not paid.`;
    if (e.outcome === 'included') return `${name}: ${money(Math.abs(e.amount), e.currency)} marked as already in the balance${e.accountName ? ` of “${esc(e.accountName)}”` : ''} — nothing changed.`;
    if (e.toAccountId) return `${name}: ${money(Math.abs(e.amount), e.currency)} moved from “${esc(e.accountName)}” to “${esc(e.toAccountName)}”${e.toCurrency !== e.currency ? ` (received ${money(e.received, e.toCurrency)})` : ''}.`;
    return `${name}: ${money(Math.abs(e.amount), e.currency)} ${e.amount < 0 ? 'paid from' : 'received into'} “${esc(e.accountName)}”${e.paidAmount != null ? ` (${money(e.paidAmount, e.paidCurrency)})` : ''}.`;
  }
  if (e.kind === 'trade' && e.side === 'dividend') return `Dividend from ${esc(e.symbol)}: ${money(e.amount, e.currency)}${e.reinvestQty ? ` reinvested in ${num(e.reinvestQty, 8)} shares` : e.cashAmount != null ? ` — +${money(e.cashAmount, e.cashCurrency)}` : ''}.`;
  if (e.kind === 'trade' && e.side === 'split') return `${esc(e.symbol)} split ${num(e.ratio, 6)}-for-1: ${num(e.before.quantity, 8)} → ${num(e.quantity, 8)}.`;
  if (e.kind === 'trade') return `${e.side === 'buy' ? 'Bought' : 'Sold'} ${num(e.quantity, 8)} ${esc(e.symbol)} at ${money(e.price, e.currency)}${e.fee ? ` (fee ${money(e.fee, e.currency)})` : ''} — ${e.side === 'buy' ? '−' : '+'}${money(e.cashAmount, e.cashCurrency)}${e.side === 'sell' && e.realised != null ? `, profit ${signed(e.realised, e.currency)}` : ''}.`;
  if (e.kind === 'transfer') return `Transferred ${money(e.amount, e.currency)} from “${esc(e.accountName)}” to “${esc(e.toAccountName)}”${e.toCurrency !== e.currency ? ` (received ${money(e.received, e.toCurrency)})` : ''}${e.note ? ` — ${esc(e.note)}` : ''}.`;
  return esc(e.text || '');
}

function renderDashboard() {
  const s = summary;
  const isEmpty = !PLATFORM_SECTIONS.concat('cashflows').some((k) => state[k].length);
  if (isEmpty) {
    return `<section class="empty-hero">
      <div class="empty-emoji" aria-hidden="true">🐒</div>
      <h1>Welcome to MoneyMonkey</h1>
      <p>Track everything you own and owe in one place: bank balances, live stock and crypto prices, fixed deposits that earn interest daily, property, loans and your monthly cash flow, across every platform you use.</p>
      <div class="row-actions center">
        <button class="btn primary" data-action="quick-add">+ Add your first item</button>
        <button class="btn" data-action="demo">Try demo data</button>
      </div>
      <p class="sub">Using another device already? <a href="#settings">Set up sync</a> to pull your data here.<br>Base currency: ${esc(base())} (change it in <a href="#settings">Settings</a>).</p>
    </section>`;
  }

  const segs = Object.keys(s.totals).map((k) => ({ label: CATEGORY_LABELS[k], value: s.totals[k], color: CATEGORY_COLORS[k], display: money(s.totals[k], base(), 0) }));
  const legend = Object.keys(s.totals)
    .filter((k) => s.totals[k] > 0)
    .map((k) => `<tr><td><span class="swatch" style="background:${CATEGORY_COLORS[k]}"></span><a href="#${CATEGORY_VIEW[k]}">${CATEGORY_LABELS[k]}</a></td><td class="num">${money(s.totals[k], base(), 0)}</td><td class="num sub">${s.assets ? ((s.totals[k] / s.assets) * 100).toFixed(1) : 0}%</td></tr>`)
    .join('');

  const hist = filteredHistory();
  const first = hist[0];
  const histChange = first && hist.length > 1 ? s.netWorth - first.value : null;

  const events = s.events.slice(0, 12).map((e) => {
    const label = `<span class="badge kind-${esc(e.kind)}">${esc(EVENT_LABELS[e.kind] || e.kind)}</span> ${esc(e.label)}${e.overdue ? ' <span class="badge overdue">overdue</span>' : ''}`;
    // Its own currency first (as on your statement), the converted amount underneath.
    const amt = e.amount == null ? '' : e.currency && e.currency !== base() && e.orig != null ? `${money(e.orig, e.currency)}<div class="sub">≈ ${money(e.amount)}</div>` : money(e.amount);
    const inner = `<span class="ev-date">${fmtDate(e.date)}</span><span class="ev-label">${label}</span><span class="num">${amt}</span>`;
    return e.ref ? `<li class="clickable has-chev" data-action="open-event" data-kind="${esc(e.kind)}" data-id="${esc(e.ref)}" data-date="${esc(e.date)}" data-account="${esc(e.accountId || '')}" data-card="${esc(e.cardId || '')}" tabindex="0">${inner}<span class="chev" aria-hidden="true">›</span></li>` : `<li>${inner}</li>`;
  }).join('');
  const alerts = attentionRow(dashboardAlerts());

  const { platforms, regions } = Calc.platformBreakdown(state, todayISO());
  const named = platforms.filter((p) => p.name);
  const maxAbs = Math.max(1, ...named.map((p) => Math.abs(p.net)));
  const platformBars = named.slice(0, 8).map((p) => `<a class="hbar link" href="#platform/${encodeURIComponent(p.name)}"><span class="hbar-label">${esc(p.name)}<span class="sub"> ${esc(p.region)}</span></span>
    <span class="hbar-track"><span class="${p.net < 0 ? 'neg-bar' : ''}" style="width:${(Math.abs(p.net) / maxAbs) * 100}%"></span></span><span class="num">${money(p.net, base(), 0)}</span></a>`).join('');
  const regionPills = regions.filter((r) => r.region).map((r) => `<a class="pill" href="#region/${encodeURIComponent(r.region)}"><span class="sub">${esc(r.region)}</span><strong>${money(r.net, base(), 0)}</strong></a>`).join('');

  return `
    <section class="hero">
      <div>
        <div class="tile-label">Net worth</div>
        <div class="hero-value">${money(s.netWorth)}</div>
        <div class="hero-sub">${[
          state.stocks.length + state.crypto.length ? `Markets today ${signed(s.dayChange)}` : '',
          histChange != null ? `${historyRange === 'all' ? 'All time' : `Last ${historyRange} days`} ${signed(histChange)}` : '',
        ].filter(Boolean).join(' · ')}</div>
      </div>
      ${s.interestDaily > 0 ? `<div class="live-interest clickable" ${explainAttr('interest')} tabindex="0" role="button"><div class="tile-label">Interest earned today</div><div class="tile-value pos" id="live-interest">${money(0, base(), 4)}</div><div class="tile-sub">${money(s.interestDaily)} per day from ${[s.depositDaily > 0 ? 'fixed deposits' : '', s.saverDaily > 0 ? 'savers' : ''].filter(Boolean).join(' & ')}</div></div>` : ''}
    </section>

    ${alerts ? `<ul class="alerts">${alerts}</ul>` : ''}

    <section class="tiles">
      ${tile('Total assets', money(s.assets, base(), 0), '', '', explainAttr('assets'))}
      ${tile('Liabilities', `<span class="${s.liabilities ? 'owed' : ''}">${money(s.liabilities, base(), 0)}</span>`, s.assets ? `Debt-to-asset ${(s.debtToAsset * 100).toFixed(1)}%` : '', '', explainAttr('liabilities'))}
      ${tile('Investment P&L', signed(s.investPnl, base(), 0), s.investCost ? `${pct(s.investPnlPct)} on ${money(s.investCost, base(), 0)}` : 'No holdings yet', '', explainAttr('pnl'))}
      ${tile('Net cash flow / mo', signed(s.netMonthly, base(), 0), `${money(s.incomeTotal, base(), 0)} in · ${money(s.spending, base(), 0)} out${s.spendingSource === 'actual' ? ' (actual)' : ''}`, '', explainAttr('cashflow'))}
      ${tile('Savings rate', s.incomeTotal ? pct(s.savingsRate, false) : '—', 'of monthly income', '', explainAttr('cashflow'))}
      ${tile('Passive income / mo', money(s.passiveMonthly, base(), 0), 'interest, rent & dividends · FD interest paid at maturity', '', explainAttr('passive'))}
      ${tile('Emergency runway', isFinite(s.runwayMonths) ? `${s.runwayMonths.toFixed(1)} mo` : '—', 'cash ÷ monthly spending', '', explainAttr('runway'))}
      ${tile('Subscriptions / mo', money(s.flow.subscription, base(), 0), `${money(s.flow.subscription * 12, base(), 0)} per year`, '', explainAttr('subscriptions'))}
    </section>

    <section class="grid-2">
      <div class="card">
        <h2>Where your money is</h2>
        <div class="alloc">
          ${Charts.donut(segs, { center: money(s.assets, base(), 0), centerLabel: 'Assets' })}
          <table class="legend"><tbody>${legend || '<tr><td class="sub">No assets yet</td></tr>'}</tbody></table>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>By region & platform</h2><a href="#platforms" class="sub">All platforms →</a></div>
        ${regionPills ? `<div class="pills">${regionPills}</div>` : ''}
        ${platformBars ? `<div class="hbars" style="${barValueWidth(named.slice(0, 8).map((p) => money(p.net, base(), 0)))}">${platformBars}</div>` : '<p class="sub">Add a platform (e.g. HSBC HK, Monzo, Futu) to your accounts and holdings to see the split.</p>'}
      </div>
    </section>

    <section class="grid-2">
      <div class="card">
        <div class="card-head">
          <h2>Net worth over time</h2>
          <div class="seg" role="group" aria-label="History range">
            ${['30', '90', '365', 'all'].map((r) => `<button data-action="range" data-range="${r}" class="${historyRange === r ? 'on' : ''}">${r === 'all' ? 'All' : r === '365' ? '1Y' : r + 'D'}</button>`).join('')}
          </div>
        </div>
        ${Charts.lineChart(hist, { format: (v) => money(v) })}
      </div>
      <div class="card">
        <h2>Next 30 days</h2>
        ${events ? `<ul class="events">${events}</ul>` : '<p class="sub">Nothing scheduled. Add bills, income and subscriptions in <a href="#cashflows">Cash flow</a>.</p>'}
      </div>
    </section>

    <section class="card">
      <h2>Goals</h2>
      ${state.goals.length ? state.goals.map(goalCard).join('') : '<p class="sub">No goals yet. <a href="#goals">Set one</a> — e.g. an emergency fund of 6 months’ expenses.</p>'}
    </section>`;
}

// Everything that needs a look: recent maturities, stale values, payments, check-in, setup.
function dashboardAlerts() {
  const recent = state.activity.filter((e) => String(e.kind).startsWith('deposit-') && Calc.daysBetween(e.date, todayISO()) <= 14).slice(0, 3);
  // Things to act on (payments, check-in) first, then warnings, setup hints and news.
  const all = [...setupAlerts(), ...summary.alerts, ...recent.map((e) => ({ level: 'good', html: activityText(e) }))];
  const rank = (a) => (/data-action="(review-payments|checkin)"/.test(a.html || '') ? 0 : a.level === 'warn' ? 1 : a.level === 'good' ? 3 : 2);
  return all.map((a, i) => [a, i]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(([a]) => a);
}
const alertItem = (a) => `<li class="alert ${a.level}">${icon(a.level === 'warn' ? 'alert' : a.level === 'good' ? 'check' : 'info')}<span>${a.html || esc(a.text)}</span></li>`;
// One row on Home instead of a stack of notices: a single one is shown as it is; more open a list.
function attentionRow(list) {
  if (list.length <= 1) return list.map(alertItem).join('');
  const short = (a) => { const t = (a.text || a.html.replace(/<[^>]+>/g, '')).split(/[:—.]/)[0].trim(); return t.length > 40 ? `${t.slice(0, 38)}…` : t; };
  const todo = list.filter((a) => a.level !== 'good').length;
  return `<li class="alert attention clickable" data-action="attention" tabindex="0" role="button">${icon(todo ? 'alert' : 'check')}<span class="grow"><strong>${todo ? `${plural(todo, 'thing')} need${todo === 1 ? 's' : ''} attention` : 'Updates'}</strong><span class="sub"> · ${esc(list.slice(0, 2).map(short).join(' · '))}${list.length > 2 ? ` · ${list.length - 2} more` : ''}</span></span><span class="chev" aria-hidden="true">›</span></li>`;
}

function setupAlerts() {
  const out = [];
  if (state.stocks.some((s) => s.source !== 'manual') && !state.settings.finnhubKey) {
    out.push({ level: 'warn', html: 'Live stock prices need a free Finnhub API key — add it in <a href="#settings">Settings</a>. Until then, holdings are valued at cost.' });
  }
  const pend = Calc.pendingPayments(state, todayISO());
  if (pend.length) {
    out.push({ level: 'warn', html: `${plural(pend.length, 'payment')} to confirm: ${pend.slice(0, 3).map(payName).join(', ')}${pend.length > 3 ? '…' : ''}. <a href="#" data-action="review-payments">Review</a>` });
  }
  if (Calc.checkinDue(state, todayISO())) {
    out.push({ level: 'info', html: `Monthly check-in (due ${fmtDate(Calc.checkinDate(state, todayISO()))}): update your balances, confirm what’s been paid, and record last month’s card spending. <a href="#" data-action="checkin">Start</a>` });
  }
  if (syncCfg.token && !sessionPass) out.push({ level: 'warn', html: 'Sync is locked on this device. <a href="#" data-action="unlock">Enter your passphrase</a> to sync.' });
  if (lastErrors.length) out.push({ level: 'warn', text: `Last price update had problems: ${lastErrors.slice(0, 3).join('; ')}${lastErrors.length > 3 ? '…' : ''}` });
  return out;
}

function filteredHistory() {
  // Days saved while the base currency was different are converted at today's rate.
  const pts = state.history.map((h) => ({ date: h.date, value: !h.currency || h.currency === base() ? h.netWorth : Calc.convert(h.netWorth, h.currency, base(), state.fx) })).filter((p) => isFinite(p.value));
  if (historyRange === 'all') return pts;
  const from = Calc.toISO(Calc.addDays(new Date(), -+historyRange));
  return pts.filter((p) => p.date >= from);
}
