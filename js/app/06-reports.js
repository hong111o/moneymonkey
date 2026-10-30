/* MoneyMonkey app — Reports & export, search, goals and settings pages.
 * The js/app/*.js files are loaded in order as plain scripts and share one scope (see index.html). */
'use strict';

// ---------------------------------------------------------------- reports & export

// One year in figures: net worth, cash flow (as in Month by month), investments and interest.
function yearReport(year) {
  const inYear = (d) => d && d.slice(0, 4) === year;
  const toB = (v, c) => toBase(v, c) || 0;
  const hist = state.history.filter((h) => inYear(h.date)).map((h) => ({ date: h.date, v: !h.currency || h.currency === base() ? h.netWorth : Calc.convert(h.netWorth, h.currency, base(), state.fx) })).filter((h) => isFinite(h.v));
  const months = monthFigures().filter((m) => m.month.slice(0, 4) === year).reverse();
  const sum = (k) => months.reduce((t, m) => t + m[k], 0);
  const realised = Calc.realisedProfit(state.trades, toB, null, `${year}-01-01`);
  const sells = realised.sells.filter((e) => inYear(e.date));
  const div = Calc.dividendsReceived(state.trades, toB, `${year}-01-01`, `${year}-12-31`);
  const buys = state.trades.filter((e) => e.side === 'buy' && inYear(e.date));
  const matured = state.activity.filter((e) => String(e.kind).startsWith('deposit-') && inYear(e.date));
  return {
    year, months,
    nwStart: hist.length ? hist[0] : null, nwEnd: hist.length ? hist[hist.length - 1] : null,
    regular: sum('regular'), extraIn: sum('xin'), card: sum('card'), fixed: sum('fixed'), extraOut: sum('xout'),
    income: sum('income'), spending: sum('spending'), net: sum('net'),
    realised: sells.reduce((t, e) => t + toB(e.realised, e.currency), 0), sells: sells.length,
    invested: buys.reduce((t, e) => t + toB(e.total, e.currency), 0), buys: buys.length,
    dividends: div.total, dividendCount: div.list.length,
    interest: matured.reduce((t, e) => t + toB(e.interest, e.currency), 0), maturities: matured.length,
    payments: state.activity.filter((e) => e.kind === 'payment' && inYear(e.date)).length,
  };
}

function reportYears() {
  const ys = new Set([todayISO().slice(0, 4)]);
  for (const h of state.history) ys.add(h.date.slice(0, 4));
  for (const e of state.spending) ys.add(e.month.slice(0, 4));
  for (const e of state.trades) ys.add(e.date.slice(0, 4));
  return [...ys].sort().reverse();
}

function renderReports() {
  const years = reportYears();
  const year = years.includes(reportYear) ? reportYear : years[0];
  const r = yearReport(year);
  const line = (label, value, sub = '') => `<div class="ex-total"><span class="grow">${label}${sub ? `<div class="sub">${sub}</div>` : ''}</span><span class="num">${value}</span></div>`;
  const m = (v) => money(v, base(), 0);
  const nwChange = r.nwStart && r.nwEnd ? r.nwEnd.v - r.nwStart.v : null;
  return `<div class="page-head"><div><h1>Reports &amp; export</h1><p class="sub">A year in figures, and your data as CSV files that open in Excel, Numbers or Google Sheets.</p></div></div>
    <div class="seg" role="group" aria-label="Year">${years.map((y) => `<button data-action="report-year" data-year="${y}" class="${y === year ? 'on' : ''}">${y}</button>`).join('')}</div>
    <section class="grid-2">
      <div class="card">
        <h2>Net worth</h2>
        ${r.nwStart ? line(`Start · ${fmtDate(r.nwStart.date)}`, m(r.nwStart.v)) + line(`Latest · ${fmtDate(r.nwEnd.date)}`, m(r.nwEnd.v)) + line('<strong>Change</strong>', `<strong>${signed(nwChange, base(), 0)}</strong>`) : '<p class="sub">No daily snapshots for this year yet.</p>'}
      </div>
      <div class="card">
        <h2>Investments</h2>
        ${line('Realised profit', signed(r.realised, base(), 0), plural(r.sells, 'sale'))}
        ${line('Dividends received', m(r.dividends), plural(r.dividendCount, 'payment'))}
        ${line('Invested (buys)', m(r.invested), plural(r.buys, 'buy'))}
        ${line('Fixed deposit interest paid', m(r.interest), plural(r.maturities, 'maturity', 'maturities'))}
      </div>
    </section>
    <div class="card">
      <h2>Cash flow · ${plural(r.months.length, 'recorded month')}</h2>
      ${r.months.length ? `${line('Regular income', m(r.regular))}${r.extraIn ? line('Extra income', m(r.extraIn)) : ''}${line('Card spending', m(r.card), 'from your statements')}${line('Fixed bills &amp; loan repayments', m(r.fixed), 'not on a card')}${r.extraOut ? line('One-off costs', m(r.extraOut)) : ''}${line('<strong>Left over</strong>', `<strong class="${r.net >= 0 ? 'pos' : 'neg'}">${signed(r.net, base(), 0)}</strong>`, 'before planned saving')}` : '<p class="sub">No card statements or one-offs recorded for this year.</p>'}
      <p class="sub">Same figures as Cash Flow’s month by month. ${plural(r.payments, 'payment')} confirmed this year.</p>
    </div>
    <div class="card">
      <h2>Export (CSV)</h2>
      <div class="row-actions wrap">
        <button class="btn primary" data-action="export-report" data-what="year">${year} report</button>
        <button class="btn" data-action="export-report" data-what="activity">Activity &amp; trades</button>
        <button class="btn" data-action="export-report" data-what="accounts">Account balances</button>
        <button class="btn" data-action="export-report" data-what="holdings">Holdings</button>
        <button class="btn" data-action="export-report" data-what="cashflows">Income, bills &amp; savings</button>
        <button class="btn" data-action="export-report" data-what="statements">Card statements</button>
        <button class="btn" data-action="export-csv">Everything I own &amp; owe (today)</button>
      </div>
      <p class="sub">Amounts are in their own currency, with the ${esc(base())} value where it helps. For a full backup you can restore, use Settings → Export backup.</p>
    </div>`;
}

const csvCell = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

function exportReportCsv(what) {
  const t = todayISO();
  const r2 = (v) => (v == null || !isFinite(v) ? '' : round2(v));
  let rows, name;
  if (what === 'year') {
    const years = reportYears();
    const year = years.includes(reportYear) ? reportYear : years[0];
    const r = yearReport(year);
    rows = [['MoneyMonkey report', year, `amounts in ${base()}`], [],
      ['Net worth start', r.nwStart ? r.nwStart.date : '', r.nwStart ? r2(r.nwStart.v) : ''], ['Net worth latest', r.nwEnd ? r.nwEnd.date : '', r.nwEnd ? r2(r.nwEnd.v) : ''],
      ['Realised profit', '', r2(r.realised)], ['Dividends received', '', r2(r.dividends)], ['Invested (buys)', '', r2(r.invested)], ['Fixed deposit interest paid', '', r2(r.interest)], [],
      ['Month', 'Regular income', 'Extra income', 'Card spending', 'Fixed bills & loans', 'One-off costs', 'Left over'],
      ...r.months.map((mm) => [mm.month, r2(mm.regular), r2(mm.xin), r2(mm.card), r2(mm.fixed), r2(mm.xout), r2(mm.net)]),
      ['Total', r2(r.regular), r2(r.extraIn), r2(r.card), r2(r.fixed), r2(r.extraOut), r2(r.net)]];
    name = `moneymonkey-report-${year}.csv`;
  } else if (what === 'activity') {
    const tradeRows = state.trades.map((e) => [e.date, e.side, `${e.symbol}${e.platform ? ` (${e.platform})` : ''}`, e.quantity ?? '', e.price ?? '', e.side === 'dividend' ? e.amount : e.total ?? '', e.currency, e.realised ?? '', e.accountName || '', e.cashAmount ?? '', e.cashCurrency || '']);
    const actRows = state.activity.filter((e) => e.kind !== 'checkin').map((e) => [e.date, e.kind === 'payment' ? `payment (${e.outcome || 'applied'})` : e.kind, (activityText(e) || '').replace(/<[^>]+>/g, ''), '', '', e.amount ?? '', e.currency || '', '', e.accountName || '', e.received ?? e.paidAmount ?? '', e.toCurrency || e.paidCurrency || '']);
    rows = [['Date', 'Type', 'Description', 'Quantity', 'Price', 'Amount', 'Currency', 'Realised profit', 'Account', 'Account amount', 'Account currency'], ...[...tradeRows, ...actRows].sort((a, b) => (a[0] < b[0] ? 1 : -1))];
    name = `moneymonkey-activity-${t}.csv`;
  } else if (what === 'accounts') {
    rows = [['Account', 'Platform', 'Type', 'Currency', 'Balance', `Value (${base()})`, 'Interest % p.a.', 'Last updated']];
    for (const a of state.accounts) for (const b of Calc.accountBalances(a)) { const v = Calc.balanceValue(b, t).value; rows.push([a.name, a.platform || '', labelOf(ACCOUNT_TYPES, a.type), b.currency, r2(v), r2(toBase(v, b.currency)), b.rate || '', (a.updatedAt || '').slice(0, 10)]); }
    for (const d of state.deposits) { const v = Calc.depositValue(d, t); rows.push([`${d.kind === 'regular' ? 'Regular saver' : 'Fixed deposit'}${d.name ? ` · ${d.name}` : ''}`, d.platform || '', 'deposit', d.currency, r2(v.value), r2(toBase(v.value, d.currency)), d.rate || '', `matures ${v.maturityDate}`]); }
    name = `moneymonkey-accounts-${t}.csv`;
  } else if (what === 'holdings') {
    rows = [['Symbol', 'Name', 'Platform', 'Quantity', 'Average cost', 'Price', 'Currency', 'Market value', `Value (${base()})`, 'Profit / loss']];
    for (const k of ['stocks', 'crypto']) for (const h of state[k]) { const v = hv(h); rows.push([h.symbol || h.coinId, h.name || h.coinId || '', h.platform || '', h.quantity, r2(h.avgCost), r2(v.price), h.currency, r2(v.marketValue), r2(toBase(v.marketValue, h.currency)), r2(v.pnl)]); }
    name = `moneymonkey-holdings-${t}.csv`;
  } else if (what === 'cashflows') {
    rows = [['Name', 'Type', 'Category', 'Amount', 'Currency', 'How often', `Per month (${base()})`, 'Next date', 'Active', 'Account', 'Paid by card', 'Starts', 'Ends', 'Amount changes']];
    for (const c of state.cashflows) rows.push([c.name, labelOf(FLOW_KINDS, c.kind), c.category || '', Calc.amountOn(c, todayISO()), c.currency, labelOf(FREQ, c.frequency), r2(toBase(Calc.monthlyAmount(c, thisMonth()), c.currency)), c.nextDate || '', c.active === false ? 'no' : 'yes', accountName(c.accountId) || '', c.onCard ? 'yes' : '', c.startDate || '', c.endDate || '', (c.changes || []).map((x) => `${x.from}: ${x.amount}`).join('; ')]);
    name = `moneymonkey-cashflow-${t}.csv`;
  } else if (what === 'statements') {
    rows = [['Card', 'Month', 'Amount', 'Currency', 'Due date', 'Paid on', 'Note']];
    for (const e of state.spending.slice().sort((a, b) => (a.month < b.month ? 1 : -1))) rows.push([e.platform || '', e.month, e.amount, e.currency, e.dueDate || '', e.paidOn || '', e.note || '']);
    name = `moneymonkey-card-statements-${t}.csv`;
  } else return;
  // A byte-order mark so Excel reads £, € and other symbols correctly.
  download(name, `\ufeff${toCsv(rows)}`, 'text/csv;charset=utf-8');
  toast(`Downloaded ${name}`);
}

// ---------------------------------------------------------------- search

// Everything searchable, as { text, title, sub, open }: accounts, holdings, deposits, property,
// other assets, loans, cash-flow items, cards, statements, goals and platforms.
function searchIndex() {
  const t = todayISO();
  const edit = (sec, id) => () => editItem(sec, id);
  const go = (hash) => () => { location.hash = hash; };
  const out = [];
  const add = (title, sub, open, extra = '') => out.push({ text: `${title} ${sub} ${extra}`.toLowerCase(), title, sub, open });
  for (const a of state.accounts) add(a.name, `Account · ${a.platform || ''} · ${Calc.accountBalances(a).map((b) => money(b.amount, b.currency)).join(', ')}`, go(`#account/${encodeURIComponent(a.id)}`), a.note);
  for (const k of ['stocks', 'crypto']) for (const h of state[k]) add(h.symbol || h.coinId, `${k === 'stocks' ? 'Stock' : 'Crypto'} · ${h.platform || ''} · ${num(h.quantity, 8)} · ${money(hv(h).marketValue, h.currency)}`, edit(k, h.id), `${h.name || ''} ${h.coinId || ''}`);
  for (const d of state.deposits) add(`${d.platform || ''} ${d.name || ''}`.trim() || 'Deposit', `${d.kind === 'regular' ? 'Regular saver' : 'Fixed deposit'} · ${money(Calc.depositValue(d, t).value, d.currency)} · matures ${fmtDate(Calc.depositValue(d, t).maturityDate)}`, edit('deposits', d.id));
  for (const p of state.properties) add(p.name, `Property · ${p.address || ''}`, edit('properties', p.id), p.platform);
  for (const o of state.others) add(o.name, `Other asset · ${money(o.value, o.currency)}`, edit('others', o.id), `${o.category || ''} ${o.platform || ''}`);
  for (const l of state.liabilities) add(l.name, `Loan · ${l.platform || ''} · ${money(Calc.loanBalance(l, t).balance, l.currency)} left`, edit('liabilities', l.id));
  for (const c of state.cashflows) add(c.name, `${labelOf(FLOW_KINDS, c.kind)} · ${money(c.amount, c.currency)} ${labelOf(FREQ, c.frequency).toLowerCase()}${c.active === false ? ' · paused' : ''}`, edit('cashflows', c.id), c.category);
  for (const c of state.cards) add(c.name, `Credit card · ${c.platform || ''}`, go(`#card/${encodeURIComponent(c.id)}`));
  for (const e of state.spending) add(`${e.platform || 'Card'} · ${fmtMonth(e.month)}`, `Statement · ${money(e.amount, e.currency)} · ${billStatus(e) || ''}`, edit('spending', e.id), e.note);
  for (const g of state.goals) add(g.name, 'Goal', go('#goals'));
  const plats = new Set([...state.accounts, ...state.stocks, ...state.crypto, ...state.liabilities, ...state.properties, ...state.others].map((x) => x.platform).filter(Boolean));
  for (const name of plats) add(name, 'Platform', go(`#platform/${encodeURIComponent(name)}`));
  return out;
}

function openSearch() {
  const index = searchIndex();
  let shown = [];
  const results = (q) => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    shown = words.length ? index.filter((r) => words.every((w) => r.text.includes(w))).slice(0, 40) : [];
    return words.length
      ? shown.length ? shown.map((r, i) => `<a class="ex-row" href="#" data-hit="${i}"><span class="grow"><strong>${esc(r.title)}</strong><div class="sub">${esc(r.sub)}</div></span><span class="chev" aria-hidden="true">›</span></a>`).join('') : '<p class="sub">Nothing found.</p>'
      : '<p class="sub">Search accounts, holdings, deposits, bills, income, cards, statements and platforms — e.g. “netflix”, “futu”, “GBP”.</p>';
  };
  openSheet('Search', `<input class="search-input" type="search" placeholder="Search…" aria-label="Search" autocomplete="off"><div class="ex-list search-results">${results('')}</div>`, (e) => {
    const hit = e.target.closest('[data-hit]');
    if (!hit) return;
    e.preventDefault();
    const r = shown[+hit.dataset.hit];
    dialog().close();
    if (r) r.open();
  });
  const input = $('.search-input', dialog());
  input.addEventListener('input', () => { $('.search-results', dialog()).innerHTML = results(input.value); });
  input.focus();
}

// A tap on a "Next 30 days" row: the payment box when it's due today (or overdue), else the item.
function openEvent({ kind, id, date, account, card }) {
  const t = todayISO();
  const due = (key) => Calc.pendingPayments(state, t).some((p) => p.key === key);
  const payBox = (key) => paymentSheet(() => Calc.pendingPayments(state, todayISO()).filter((p) => p.key === key));
  if (kind === 'card') return date <= t ? payCardBill(id) : (location.hash = `#card/${encodeURIComponent(card)}`);
  if (kind === 'saver') return due(`rs:${id}:${date}`) ? payBox(`rs:${id}:${date}`) : editItem('deposits', id);
  if (kind === 'deposit') return (location.hash = `#account/${encodeURIComponent(account)}`);
  if (kind === 'property') return editItem('properties', id);
  return due(`cf:${id}:${date}`) ? payBox(`cf:${id}:${date}`) : editItem('cashflows', id);
}

// Paying a bill before its due date: the same confirm box as when it's due.
function payCardBill(id) {
  const billOf = () => {
    const e = state.spending.find((x) => x.id === id && !x.paidOn);
    if (!e) return [];
    const card = cardById(e.cardId);
    const acct = state.accounts.find((a) => a.id === (e.payFromAccountId || (card && card.payFromAccountId)));
    return [{ key: `card:${e.id}`, type: 'card', id: e.id, date: todayISO(), name: `${e.platform || 'Card'} bill (${fmtMonth(e.month)})`, amount: +e.amount, currency: e.currency, accountId: acct ? acct.id : null, sign: -1 }];
  };
  paymentSheet(billOf);
}

// ---------------------------------------------------------------- goals

function goalCurrent(g) {
  const t = summary.totals;
  switch (g.metric) {
    case 'cash': return t.cash;
    case 'invest': return t.stocks + t.crypto;
    case 'deposits': return t.deposits;
    case 'manual': return +g.saved || 0;
    default: return summary.netWorth;
  }
}

function goalCard(g) {
  const cur = goalCurrent(g);
  const target = +g.target || 0;
  const p = target ? Math.max(0, Math.min(1, cur / target)) : 0;
  const months = Calc.monthsToGoal(cur, target, summary.netMonthly);
  let note;
  if (cur >= target) note = 'Reached';
  else if (g.targetDate) {
    const m = Math.max(1, Calc.monthsBetween(todayISO(), g.targetDate));
    const need = (target - cur) / m;
    note = `Need ${money(need, base(), 0)}/month to hit it by ${fmtDate(g.targetDate)} — ${need <= summary.netMonthly ? '<span class="pos">on track</span>' : '<span class="warn-text">behind</span>'} at your current surplus.`;
  } else note = isFinite(months) ? `About ${months} months at your current surplus (${fmtDate(Calc.toISO(Calc.addMonths(new Date(), months)))}).` : 'Add income in Cash flow to estimate when you’ll get there.';
  return `<div class="goal"><div class="goal-head"><strong>${esc(g.name)}</strong><span>${money(cur, base(), 0)} / ${money(target, base(), 0)}</span></div>
    <div class="bar big"><span style="width:${(p * 100).toFixed(1)}%"></span></div><div class="sub">${(p * 100).toFixed(1)}% · ${note}</div></div>`;
}

function renderGoals() {
  const sec = SECTIONS.goals;
  return `<div class="page-head"><div><h1>${sec.title}</h1><p class="sub intro">${sec.intro}</p></div>
    <div class="row-actions"><button class="btn primary" data-action="add" data-sec="goals">+ Add</button></div></div>
    ${state.goals.length ? state.goals.map((g) => `<div class="card clickable" data-action="edit" data-sec="goals" data-id="${esc(g.id)}" tabindex="0">${goalCard(g)}</div>`).join('')
      : '<div class="card empty">No goals yet.</div>'}`;
}

// ---------------------------------------------------------------- settings

function renderSyncCard() {
  if (!syncCfg.token) {
    return `<div class="card" id="sync">
      <h2>☁ Sync across devices</h2>
      <p>Keep your phone, laptop and other devices in step. Your data is <strong>encrypted on this device</strong> with a passphrase only you know, then stored in a secret GitHub Gist, so GitHub only ever sees scrambled text.</p>
      <ol class="steps">
        <li><a href="https://github.com/settings/tokens/new?scopes=gist&description=MoneyMonkey%20sync" target="_blank" rel="noopener">Create a GitHub token</a> with only the <strong>gist</strong> box ticked (it’s pre-selected). Pick an expiry you’re comfortable with, then copy the token.</li>
        <li>Tap <strong>Set up sync</strong>, paste the token and choose a passphrase.</li>
        <li>On your other devices, do the same with the <strong>same passphrase</strong>. Your data appears automatically.</li>
      </ol>
      <div class="row-actions"><button class="btn primary" data-action="sync-setup">Set up sync</button></div>
    </div>`;
  }
  return `<div class="card" id="sync">
    <h2>☁ Sync across devices</h2>
    <p>Status: <strong>${syncing ? 'syncing…' : !sessionPass ? 'locked — enter your passphrase' : syncCfg.lastError ? `problem — ${esc(syncCfg.lastError)}` : `synced ${ago(syncCfg.lastSync)}`}</strong></p>
    <p class="sub">Changes sync automatically when you edit something, when you open the app, and every couple of minutes. Each device keeps its own copy, so it works offline too.
      ${syncCfg.gistId ? `Encrypted data lives in <a href="https://gist.github.com/${esc(syncCfg.gistId)}" target="_blank" rel="noopener">this secret gist</a>.` : ''}</p>
    <div class="row-actions wrap">
      ${sessionPass ? '<button class="btn primary" data-action="sync-now">Sync now</button>' : '<button class="btn primary" data-action="unlock">Unlock sync</button>'}
      <button class="btn" data-action="sync-disconnect">Disconnect this device</button>
    </div>
    <p class="sub">Forgot the passphrase? Nobody can decrypt the synced copy. Disconnect, delete the gist on GitHub, and set up sync again from a device that still has your data.</p>
  </div>`;
}

function renderSettings() {
  const st = state.settings;
  return `<div class="page-head"><div><h1>Settings & Sync</h1></div></div>
    ${renderSyncCard()}
    <form class="card form-grid" id="settings-form">
      <h2 class="span-2">Preferences</h2>
      <label class="span-2">Your name<input name="name" value="${esc(st.name || '')}" maxlength="40" autocomplete="given-name" placeholder="e.g. Alex">
        <small>Home greets you with it: “Good morning, Alex”.</small></label>
      <label>Base currency<input name="baseCurrency" list="currency-list" value="${esc(st.baseCurrency)}" required maxlength="3" pattern="[A-Za-z]{3}" autocapitalize="characters">
        <small>All totals are converted into this currency with live exchange rates.</small></label>
      <label>Price refresh (seconds)<input name="refreshSec" type="number" inputmode="numeric" min="15" step="5" value="${esc(st.refreshSec)}">
        <small>Free Finnhub keys allow 60 requests a minute.</small></label>
      <label class="span-2">Finnhub API key (live stock prices)<input name="finnhubKey" value="${esc(st.finnhubKey)}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste key here">
        <small>Free key at <a href="https://finnhub.io/register" target="_blank" rel="noopener">finnhub.io/register</a>. Crypto prices and exchange rates don’t need one. Synced to your other devices.</small></label>
      <label>Monthly check-in day<input name="checkinDay" type="number" inputmode="numeric" min="1" max="31" step="1" value="${esc(st.checkinDay || 1)}">
        <small>1–31. In shorter months it falls on the last day (e.g. 31 → 30 April, 28 February).</small></label>
      <label>Stock cost method<select name="costMethod">${COST_METHODS.map(([v, l]) => `<option value="${v}" ${(st.costMethod || 'average') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <small>Average: sales keep the cost and their profit is “realised”. Diluted: profit from sales lowers the cost of what’s left, as Futu and moomoo show it (it can go below zero). Only how it’s shown changes — switch any time. Each holding can override it.</small></label>
      <label>Theme (this device)<select name="theme">${[['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}" ${st.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="span-2 row-actions"><button class="btn primary" type="submit">Save settings</button></div>
    </form>
    <div class="card">
      <h2>📱 Use it like an app</h2>
      <p class="sub">On iPhone: open MoneyMonkey in Safari → Share → <strong>Add to Home Screen</strong>. On Android: Chrome menu → <strong>Install app</strong>. It then opens full-screen and works offline.</p>
    </div>
    <div class="card">
      <h2>Data</h2>
      <div class="row-actions wrap">
        <button class="btn" data-action="refresh">Refresh prices & rates</button>
        <button class="btn" data-action="export-json">Export backup (JSON)</button>
        <label class="btn">Import backup<input type="file" accept="application/json,.json" id="import-file" hidden></label>
        <button class="btn" data-action="export-csv">Export holdings (CSV)</button>
        <button class="btn" data-action="demo">Load demo data</button>
        <button class="btn danger" data-action="reset">Erase this device’s data</button>
      </div>
      <p class="sub">Net worth history: ${state.history.length} daily snapshots${state.history.length ? ` since ${fmtDate(state.history[0].date)}` : ''}. Exchange rates for ${Object.keys(state.fx.rates || {}).length} currencies, updated ${ago(state.fx.updatedAt)}.</p>
    </div>`;
}
