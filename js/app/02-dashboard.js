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
  { id: 'liabilities', label: 'Debts', icon: 'landmark', group: 'Owe & spend' },
  { id: 'cashflows', label: 'Cash Flow', icon: 'flow', group: 'Owe & spend' },
  { id: 'goals', label: 'Goals', icon: 'target', group: 'Owe & spend' },
  { id: 'reports', label: 'Reports & Export', icon: 'report', group: 'Owe & spend' },
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
let historyRange = '30';
let eventsAll = false;
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
  if (layoutEditing !== currentView) layoutEditing = null;
  render();
  window.scrollTo(0, 0);
}

function renderNav() {
  let group = null;
  const active = NAV_PARENT[currentView] || currentView;
  $('#nav').innerHTML = VIEWS.filter((v) => !v.hidden).map((v) => {
    const head = v.group !== group ? `${(group = v.group) ? `<div class="nav-group">${v.group}</div>` : '<div class="nav-sep"></div>'}` : '';
    return `${head}<a href="#${v.id}" class="${v.id === active ? 'active' : ''}" title="${v.label}"><span class="icon">${icon(v.icon)}</span><span>${v.label}</span>${navCount(v.id)}</a>`;
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

// Home's summary boxes (also used to show boxes pinned from Home).
function dashboardTiles() {
  const s = summary;
  return `<section class="tiles">
      ${tile('Investment P&L', signed(s.investPnl, base(), 0), s.investCost || s.noCostPnl ? (s.investCostPos ? `${pct(s.investPnlPct)} on ${money(s.investCostPos, base(), 0)}${s.noCostPnl ? ` · incl. ${money(s.noCostPnl, base(), 0)} with no cost` : ''}` : 'no cost to compare') : 'No holdings yet', '', explainAttr('pnl'))}
      ${tile('Net cash flow / mo', signed(s.netMonthly, base(), 0), `${money(s.incomeTotal, base(), 0)} in · ${money(s.spending, base(), 0)} out${s.spendingSource === 'actual' ? ' (actual)' : ''}`, '', explainAttr('cashflow'))}
      ${tile('Savings rate', s.incomeTotal ? pct(s.savingsRate, false) : '—', 'of monthly income', '', explainAttr('cashflow'))}
      ${tile('Passive income / mo', money(s.passiveMonthly, base(), 0), 'interest, rent & dividends · FD interest paid at maturity', '', explainAttr('passive'))}
      ${tile('Emergency runway', isFinite(s.runwayMonths) ? `${s.runwayMonths.toFixed(1)} mo` : '—', 'cash ÷ monthly spending', '', explainAttr('runway'))}
      ${tile('Subscriptions / mo', money(s.flow.subscription, base(), 0), `${money(s.flow.subscription * 12, base(), 0)} per year`, '', explainAttr('subscriptions'))}
    </section>`;
}

function render() {
  summary = Calc.summarize(state, todayISO());
  if (state.settings.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = state.settings.theme;
  const pb = $('#privacy-btn');
  pb.setAttribute('aria-pressed', String(!!state.settings.privacy));
  pb.innerHTML = state.settings.privacy ? `${icon('eyeOff')}<span class="hide-sm"> Show amounts</span>` : `${icon('eye')}<span class="hide-sm"> Hide amounts</span>`;
  pb.title = state.settings.privacy ? 'Show amounts' : 'Hide amounts';
  document.body.dataset.view = currentView;
  renderNav();
  renderSide();
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
  applyLayout();
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
// A box's name for layouts: its label without amounts, years or currencies ("Total (HKD)" → total).
const boxId = (label) => String(label).replace(/<[^>]+>/g, '').replace(/\(.*?\)/g, '').replace(/\d+/g, '').toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '');
function tile(label, value, sub = '', extra = '', attrs = '') {
  const tap = attrs ? ` clickable tile-link" ${attrs} tabindex="0" role="button` : '';
  return `<div class="tile ${extra}${tap}" data-box="${boxId(label)}" data-name="${esc(String(label).replace(/<[^>]+>/g, ''))}"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
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

  const hist = filteredHistory();
  const first = hist[0];
  const histChange = first && hist.length > 1 ? s.netWorth - first.value : null;
  const RANGES = [['7', '1W', 'last week'], ['30', '1M', 'last month'], ['90', '3M', '3 months ago'], ['365', '1Y', 'a year ago'], ['all', 'All', 'the start']];
  const rangeName = (RANGES.find((r) => r[0] === historyRange) || RANGES[1])[2];

  const week = Calc.toISO(Calc.addDays(new Date(), 7));
  const soon = s.events.filter((e) => e.date <= week);
  const events = soon.slice(0, eventsAll ? soon.length : 5).map((e) => {
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
  const platformBars = named.slice(0, 5).map((p) => `<a class="hbar link" href="#platform/${encodeURIComponent(p.name)}"><span class="hbar-label">${esc(p.name)}<span class="sub"> ${esc(p.region)}</span></span>
    <span class="hbar-track"><span class="${p.net < 0 ? 'neg-bar' : ''}" style="width:${(Math.abs(p.net) / maxAbs) * 100}%"></span></span><span class="num">${money(p.net, base(), 0)}</span></a>`).join('');
  const regionPills = regions.filter((r) => r.region).map((r) => `<a class="pill" href="#region/${encodeURIComponent(r.region)}"><span class="sub">${esc(r.region)}</span><strong>${money(r.net, base(), 0)}</strong></a>`).join('');
  const debts = debtGroups();

  return `
    <header class="home-head">
      <div>
        <h1 class="keep-case">${greeting()}</h1>
        <p class="sub clock" id="clock">${clockText()}</p>
      </div>
      <div class="head-actions"><button class="btn primary" data-action="quick-add">${icon('plus')} Add</button></div>
    </header>

    <section class="home-grid" data-layout="home">
      <div class="wide" data-box="networth" data-name="Net worth">
        <section class="card nw-card">
          <div class="nw-head">
            <div>
              <div class="tile-label">Net worth</div>
              <div class="hero-value">${money(s.netWorth)}</div>
              <div class="nw-change">${histChange != null ? `${signed(histChange)} <span class="${histChange >= 0 ? 'pos' : 'neg'}">(${first.value ? `${histChange >= 0 ? '+' : ''}${((histChange / Math.abs(first.value)) * 100).toFixed(1)}%` : '—'})</span> <span class="sub">vs ${rangeName}</span>` : '<span class="sub">History builds up day by day</span>'}</div>
            </div>
            <select class="range-select" data-range-select aria-label="Chart period">${RANGES.map(([v, l]) => `<option value="${v}" ${historyRange === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          </div>
          ${Charts.lineChart(hist, { format: (v) => money(v), height: 200 })}
          <div class="nw-foot">
            ${state.stocks.length + state.crypto.length ? `<span>Markets today ${signed(s.dayChange)}</span>` : ''}
            ${s.interestDaily > 0 ? `<a href="#" class="live-link" ${explainAttr('interest')}>Interest today <strong class="pos" id="live-interest">${money(0, base(), 2)}</strong> <span class="sub">· ${money(s.interestDaily)}/day</span></a>` : ''}
          </div>
        </section>
      </div>
      ${alerts ? `<div class="wide" data-box="attention" data-name="Needs attention"><ul class="alerts">${alerts}</ul></div>` : ''}
      <div class="wide" data-box="assets" data-name="Assets">${assetsCard(assetGroups(), 'Assets', s.assets)}</div>
      ${debts.length ? `<div class="wide" data-box="debts" data-name="Debts">${assetsCard(debts, 'Debts', s.liabilities, true)}</div>` : ''}
      <div class="wide" data-box="summary" data-name="Summary boxes">${dashboardTiles()}</div>
      <div class="card" data-box="regions" data-name="By region & platform">
        <div class="card-head"><h2>By region & platform</h2><a href="#platforms" class="sub">All platforms →</a></div>
        ${regionPills ? `<div class="pills">${regionPills}</div>` : ''}
        ${platformBars ? `<div class="hbars" style="${barValueWidth(named.slice(0, 5).map((p) => money(p.net, base(), 0)))}">${platformBars}</div>` : '<p class="sub">Add a platform (e.g. HSBC HK, Monzo, Futu) to your accounts and holdings to see the split.</p>'}
      </div>
      <div class="card" data-box="upcoming" data-name="Next 7 days">
        <h2>Next 7 days</h2>
        ${events ? `<ul class="events">${events}</ul>${soon.length > 5 ? `<button class="btn small ghost see-all" data-events-all>${eventsAll ? 'Show fewer' : `See all ${soon.length}`}</button>` : ''}` : '<p class="sub">Nothing due this week. Add bills, income and subscriptions in <a href="#cashflows">Cash flow</a>.</p>'}
      </div>
      <div class="card wide" data-box="goals" data-name="Goals">
        <h2>Goals</h2>
        ${state.goals.length ? state.goals.map(goalCard).join('') : '<p class="sub">No goals yet. <a href="#goals">Set one</a> — e.g. an emergency fund of 6 months’ expenses.</p>'}
      </div>
    </section>`;
}

// Today's date and the time now, with its offset from GMT, e.g. "Wed 28 Oct 2026 · 14:05:09 (GMT+8)". Updated every second.
function clockText() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const h = Math.trunc(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  const p = (n) => String(n).padStart(2, '0');
  const date = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${fmtDate(Calc.toISO(d))}`;
  return `${date} · ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} (GMT${off < 0 ? '−' : '+'}${h}${m ? `:${p(m)}` : ''})`;
}

// ---------------------------------------------------------------- Home pieces: greeting, trends, asset groups

function greeting() {
  const h = new Date().getHours();
  const name = (state.settings.name || '').trim();
  return `Good ${h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}${name ? `, ${esc(name)}` : ''}`;
}

// A category's (`cat`) or an item's (`item`) value over the last 30 days, oldest first.
function seriesOf(kind, key, days = 30) {
  const from = Calc.toISO(Calc.addDays(new Date(), -days));
  return state.history.filter((h) => h.date >= from && (h.currency || base()) === base())
    .map((h) => (kind === 'cat' ? h.cats && h.cats[key] : h.items && h.items[key])).filter((v) => v != null && isFinite(v));
}

// A small line and the change over 30 days. For debts, going down is the good direction.
// Which saved history a group's trend uses: loans on their own (card bills come and go).
const trendKey = (g) => (g.key === 'debt' ? 'loans' : g.key);
// Trends need at least two saved days in the last 30.
function hasTrends() {
  const from = Calc.toISO(Calc.addDays(new Date(), -30));
  return state.history.filter((h) => h.date >= from && h.items && (h.currency || base()) === base()).length >= 2;
}
// Card bills show when they're due instead of a trend.
const dueText = (iso) => (iso < todayISO() ? '<span class="trend-pct down">overdue</span>' : `<span class="trend-pct sub">due ${esc(fmtDate(iso).replace(/ \d{4}$/, ''))}</span>`);

function trend(kind, key, { debt = false } = {}) {
  const vals = seriesOf(kind, key);
  if (vals.length < 2 || !vals[0]) return '<span class="trend"><span class="trend-pct sub">—</span></span>';
  const ch = (vals[vals.length - 1] - vals[0]) / Math.abs(vals[0]);
  const good = debt ? ch < -0.0005 : ch > 0.0005;
  const bad = debt ? ch > 0.0005 : ch < -0.0005;
  const cls = good ? 'up' : bad ? 'down' : '';
  return `<span class="trend" title="Last 30 days">${Charts.sparkline(vals, { width: 52, height: 18, cls })}<span class="trend-pct ${cls}">${ch > 0 ? '+' : ''}${(ch * 100).toFixed(1)}%</span></span>`;
}

// A round badge with a name's first letter, in a colour that stays the same for that name.
const BADGE_COLORS = ['#6d5bd0', '#2a78d6', '#159a83', '#d0537f', '#c98500', '#d95926', '#0f8fb0', '#5a6b7b'];
function badge(name) {
  const n = String(name || '?').trim() || '?';
  let h = 0;
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 997;
  return `<span class="badge-init" style="--b:${BADGE_COLORS[h % BADGE_COLORS.length]}" aria-hidden="true">${esc(n.charAt(0).toUpperCase())}</span>`;
}

// Short amounts for headings ("HK$3.86M"); the full amount everywhere else.
function moneyShort(v) {
  if (hidden() || !isFinite(v)) return money(v);
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: base(), notation: 'compact', maximumFractionDigits: 2 }).format(v); } catch (e) { return money(v, base(), 0); }
}

// Assets by category, each with its items: { key, label, color, total, view, items: [{ id, name, sub, value, open, platform }] }.
function assetGroups() {
  const s = summary;
  const t = todayISO();
  const of = (sec, list, sub) => list.map((x) => ({ id: x.id, name: itemName(sec, x), sub: sub(x), value: SECTIONS[sec].total([x]) || 0, platform: x.platform || x.name || '', open: sec === 'accounts' ? `data-action="open-account" data-id="${esc(x.id)}"` : `data-action="edit" data-sec="${sec}" data-id="${esc(x.id)}"` }));
  const groups = [
    ['cash', 'accounts', state.accounts, (a) => [a.platform, labelOf(ACCOUNT_TYPES, a.type)].filter(Boolean).join(' · ')],
    ['stocks', 'stocks', state.stocks, (h) => [h.platform, `${num(h.quantity, 6)} shares`].filter(Boolean).join(' · ')],
    ['crypto', 'crypto', state.crypto, (h) => [h.platform, `${num(h.quantity, 8)} ${h.symbol || ''}`].filter(Boolean).join(' · ')],
    ['deposits', 'deposits', state.deposits, (d) => [d.kind === 'regular' ? 'Regular saver' : 'Fixed deposit', `${num(d.rate, 2)}%`, `until ${fmtDate(Calc.depositValue(d, t).maturityDate)}`].join(' · ')],
    ['property', 'properties', state.properties, (p) => p.address || p.platform || ''],
    ['other', 'others', state.others, (o) => [o.category, o.platform].filter(Boolean).join(' · ')],
  ];
  return groups.map(([key, sec, list, sub]) => ({ key, sec, label: CATEGORY_LABELS[key], color: CATEGORY_COLORS[key], view: CATEGORY_VIEW[key], total: s.totals[key] || 0, items: of(sec, list, sub).sort((a, b) => b.value - a.value) }))
    .filter((g) => g.items.length);
}

// Debts: loans, and card bills not yet paid.
function debtGroups() {
  const t = todayISO();
  const loans = state.liabilities.filter((l) => Calc.loanBalance(l, t).balance > 0).map((l) => ({ id: l.id, name: l.name, sub: [l.platform, labelOf(LOAN_TYPES, l.type)].filter(Boolean).join(' · '), value: SECTIONS.liabilities.total([l]) || 0, platform: l.platform || l.name, open: `data-action="edit" data-sec="liabilities" data-id="${esc(l.id)}"` }));
  const bills = Calc.unpaidCardBills(state).map((e) => { const c = cardById(e.cardId); return { id: e.id, name: c ? c.name : e.platform || 'Card', sub: `${fmtMonth(e.month)} bill · ${billStatus(e).replace(/<[^>]+>/g, '')}`, value: toBase(e.amount, e.currency) || 0, due: e.dueDate, platform: c ? c.platform || c.name : e.platform, open: c ? `data-action="open-card" data-id="${esc(c.id)}"` : '' }; });
  return [
    { key: 'debt', label: 'Loans', color: 'var(--neg)', view: 'liabilities', total: loans.reduce((a, x) => a + x.value, 0), items: loans },
    { key: 'cards', label: 'Card bills', color: 'var(--neg-soft)', view: 'cashflows', total: bills.reduce((a, x) => a + x.value, 0), items: bills },
  ].filter((g) => g.items.length);
}

// Remembered (per device) which groups are open in the Assets card and side panel.
const openGroups = (() => { try { return new Set(JSON.parse(localStorage.getItem('moneymonkey.open') || '[]')); } catch (e) { return new Set(); } })();
function toggleGroup(id) {
  if (openGroups.has(id)) openGroups.delete(id); else openGroups.add(id);
  try { localStorage.setItem('moneymonkey.open', JSON.stringify([...openGroups])); } catch (e) { /* storage unavailable */ }
}

// The Assets (or Debts) card: total, one bar split by category, and a table you can open by category.
function assetsCard(groups, title, total, debt = false) {
  const sum = Math.abs(total) || 1;
  const trends = hasTrends();
  const pc = (v) => `${((Math.abs(v) / sum) * 100).toFixed(1)}%`;
  const weight = (v) => `<span class="weight"><span class="weight-bar"><span style="width:${Math.min(100, (Math.abs(v) / sum) * 100)}%"></span></span><span class="num">${pc(v)}</span></span>`;
  const bar = groups.map((g) => `<span style="flex-grow:${Math.max(g.total, 0)};background:${g.color}" data-tip="${esc(g.label)}: ${esc(money(g.total, base(), 0))}"></span>`).join('');
  const legend = groups.map((g) => `<span class="leg"><span class="dot" style="background:${g.color}"></span>${esc(g.label)} <strong>${pc(g.total)}</strong></span>`).join('');
  const rows = groups.map((g) => {
    const id = `${debt ? 'd' : 'a'}:${g.key}`;
    const open = openGroups.has(id);
    return `<tr class="grp clickable" data-asset-group="${id}" aria-expanded="${open}" tabindex="0">
        <td><span class="chev-r" aria-hidden="true">›</span><span class="dot" style="background:${g.color}"></span><strong>${esc(g.label)}</strong> <span class="sub grp-count">· ${g.items.length}</span></td>
        <td class="hide-sm">${weight(g.total)}</td>
        ${trends ? `<td class="tr">${g.key === 'cards' ? dueText(g.items.map((x) => x.due).sort()[0]) : trend('cat', trendKey(g), { debt })}</td>` : ''}
        <td class="num"><strong>${money(g.total, base(), 0)}</strong></td>
      </tr>${g.items.map((x) => `<tr class="sub-row clickable" data-parent="${id}" ${open ? '' : 'hidden'} ${x.open} tabindex="0">
        <td><div class="cell-name">${badge(x.platform || x.name)}<span class="sub-name"><span>${esc(x.name)}</span><span class="sub">${esc(x.sub)}</span></span></div></td>
        <td class="hide-sm">${weight(x.value)}</td>
        ${trends ? `<td class="tr">${x.due ? dueText(x.due) : trend('item', x.id, { debt })}</td>` : ''}
        <td class="num">${money(x.value, base(), 0)}</td>
      </tr>`).join('')}`;
  }).join('');
  return `<div class="card assets-card">
      <div class="card-head"><h2>${title} <a href="#" class="sub total-link" ${explainAttr(debt ? 'liabilities' : 'assets')}>· ${moneyShort(total)}</a></h2>${debt ? (summary.assets ? `<span class="sub">Debt-to-Asset ${(summary.debtToAsset * 100).toFixed(1)}%</span>` : '') : '<button class="btn small ghost" data-action="quick-add">+ Add</button>'}</div>
      <div class="stack cat-bar" aria-hidden="true">${bar}</div>
      <div class="cat-legend">${legend}</div>
      <table class="asset-table"><thead><tr><th>Name</th><th class="hide-sm">Share</th>${trends ? `<th class="tr">Last 30 days</th>` : ''}<th class="num">Value</th></tr></thead><tbody>${rows}</tbody></table>
      ${trends ? '' : '<p class="sub trend-note">Trends appear after a few days.</p>'}
    </div>`;
}

// Opening a category row shows (or hides) its items, without redrawing the page.
document.addEventListener('click', (e) => {
  const row = e.target.closest('[data-asset-group]');
  if (!row) return;
  const id = row.dataset.assetGroup;
  toggleGroup(id);
  const open = openGroups.has(id);
  for (const el of document.querySelectorAll(`[data-asset-group="${CSS.escape(id)}"]`)) el.setAttribute('aria-expanded', String(open));
  for (const el of document.querySelectorAll(`[data-parent="${CSS.escape(id)}"]`)) el.hidden = !open;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-events-all]')) return;
  eventsAll = !eventsAll;
  render();
});
document.addEventListener('change', (e) => {
  if (!e.target.matches('[data-range-select]')) return;
  historyRange = e.target.value;
  render();
});

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
  // Short wording: the first part of each message, without the bracketed details.
  const short = (a) => { const t = (a.text || a.html.replace(/<[^>]+>/g, '')).split(/[:—.]/)[0].replace(/\s*\(.*?\)/g, '').trim(); return t.length > 40 ? `${t.slice(0, 38)}…` : t; };
  const todo = list.filter((a) => a.level !== 'good').length;
  const t = todayISO();
  const overdue = Calc.unpaidCardBills(state).some((e) => e.dueDate < t) || (summary && summary.events.some((e) => e.overdue));
  return `<li class="alert attention clickable${overdue ? ' overdue' : ''}" data-action="attention" tabindex="0" role="button">${icon(todo ? 'alert' : 'check')}<span class="grow"><strong>${todo ? `${plural(todo, 'thing')} need${todo === 1 ? 's' : ''} attention` : 'Updates'}</strong><span class="sub"> · ${esc(list.slice(0, 2).map(short).join(' · '))}${list.length > 2 ? ` · ${list.length - 2} more` : ''}</span></span><span class="chev" aria-hidden="true">›</span></li>`;
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

// ---------------------------------------------------------------- side panel (wide screens)

// The side panel is hidden unless you turn it on (remembered on this device).
let sideOpen = (() => { try { return localStorage.getItem('moneymonkey.side') === '1'; } catch (e) { return false; } })();
let sideTab = 'assets';
let sideQuery = '';

function renderSide() {
  const el = $('#side');
  if (!el) return;
  document.body.classList.toggle('side-open', sideOpen);
  const sb = $('#side-btn');
  if (sb) { sb.setAttribute('aria-pressed', String(sideOpen)); sb.title = sideOpen ? 'Hide side panel' : 'Show side panel'; sb.setAttribute('aria-label', sb.title); }
  if (!sideOpen) { el.innerHTML = ''; return; }
  // On Home the Assets card is already on screen, so the panel shows Debts and Goals instead.
  const onHome = currentView === 'dashboard';
  const groups = onHome ? debtGroups() : sideTab === 'assets' ? assetGroups() : sideTab === 'debts' ? debtGroups() : [...assetGroups(), ...debtGroups()];
  const debtKeys = new Set(['debt', 'cards']);
  const q = sideQuery.trim().toLowerCase();
  const trends = hasTrends();
  const tab = (id, label) => `<button class="${sideTab === id ? 'on' : ''}" data-side-tab="${id}" aria-pressed="${sideTab === id}">${label}</button>`;
  const body = groups.map((g) => {
    const debt = debtKeys.has(g.key);
    const id = `s:${g.key}`;
    const open = openGroups.has(id) || !!q;
    const items = g.items.map((x) => `<li class="side-item clickable" ${x.open} data-q="${esc(`${x.name} ${x.sub} ${g.label}`.toLowerCase())}" tabindex="0">
        ${badge(x.platform || x.name)}<span class="sub-name"><span>${esc(x.name)}</span><span class="sub">${esc(x.sub)}</span></span>
        <span class="side-val"><span class="num${debt ? ' owed' : ''}">${money(x.value, base(), 0)}</span>${x.due ? dueText(x.due) : trends ? trend('item', x.id, { debt }) : ''}</span>
      </li>`).join('');
    return `<li class="side-group" data-side-group>
        <button class="side-group-head" data-asset-group="${id}" aria-expanded="${open}">
          <span class="chev-r" aria-hidden="true">›</span><span class="dot" style="background:${g.color}"></span>
          <span class="grow"><strong>${esc(g.label)}</strong><span class="sub"> · ${g.items.length}</span></span>
          <span class="side-val"><span class="num${debt ? ' owed' : ''}">${moneyShort(g.total)}</span>${g.key === 'cards' ? '' : trends ? trend('cat', trendKey(g), { debt }) : ''}</span>
        </button>
        <ul class="side-items" data-parent="${id}" ${open ? '' : 'hidden'}>${items}</ul>
      </li>`;
  }).join('');
  const goals = onHome ? state.goals.map((g) => {
    const cur = goalCurrent(g);
    const p = +g.target ? Math.max(0, Math.min(1, cur / +g.target)) : 0;
    return `<li class="side-item side-goal clickable" data-href="#goals" data-q="${esc(`${g.name} goal`.toLowerCase())}" tabindex="0">
        <span class="sub-name"><span class="keep-case">${esc(g.name)}</span><span class="goal-bar"><span style="width:${p * 100}%"></span></span><span class="sub">${money(cur, base(), 0)} of ${money(+g.target || 0, base(), 0)}</span></span>
        <span class="side-val"><span class="num">${(p * 100).toFixed(0)}%</span></span>
      </li>`;
  }).join('') : '';
  el.innerHTML = `<div class="side-head">
      <h2>${onHome ? 'Debts & goals' : 'Your money'}</h2>
      <label class="side-search">${icon('search')}<input type="search" placeholder="Search" value="${esc(sideQuery)}" data-side-search aria-label="Search your money"></label>
      ${onHome ? '' : `<div class="seg side-tabs">${tab('assets', 'Assets')}${tab('debts', 'Debts')}${tab('all', 'All')}</div>`}
      <button class="btn small ghost side-new" data-action="quick-add">${icon('plus')} Add ${onHome || sideTab === 'debts' ? 'debt' : 'asset'}</button>
    </div>
    <ul class="side-groups">${body || `<li class="sub side-empty">${onHome ? 'No debts — nice.' : 'Nothing here yet.'}</li>`}</ul>
    ${onHome ? `<h3 class="side-sub">Goals</h3><ul class="side-groups side-goals" data-side-group>${goals || '<li class="sub side-empty">No goals yet. <a href="#goals">Set one</a>.</li>'}</ul>` : ''}`;
  if (q) filterSide();
}

// Typing in the search hides what doesn't match, without redrawing (so the box keeps focus).
function filterSide() {
  const q = sideQuery.trim().toLowerCase();
  for (const g of document.querySelectorAll('#side [data-side-group]')) {
    let any = false;
    for (const it of g.querySelectorAll('.side-item')) { const hit = !q || it.dataset.q.includes(q); it.hidden = !hit; any = any || hit; }
    g.hidden = !any && !!g.querySelector('.side-item');
    const list = g.querySelector('.side-items');
    if (!list) continue;
    if (q) list.hidden = false;
    else list.hidden = !openGroups.has(list.dataset.parent);
  }
}
document.addEventListener('input', (e) => {
  if (!e.target.matches('[data-side-search]')) return;
  sideQuery = e.target.value;
  filterSide();
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="toggle-side"]')) {
    sideOpen = !sideOpen;
    try { localStorage.setItem('moneymonkey.side', sideOpen ? '1' : '0'); } catch (err) { /* storage unavailable */ }
    renderSide();
    return;
  }
  const go = e.target.closest('#side [data-href]');
  if (go) { location.hash = go.dataset.href; return; }
  const b = e.target.closest('[data-side-tab]');
  if (!b) return;
  sideTab = b.dataset.sideTab;
  renderSide();
});
