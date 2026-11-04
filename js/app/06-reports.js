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
  // The forecast's date for this goal (middle outcome, with your forecast settings).
  const fc = cur < target ? goalForecastLine(g, target) : '';
  return `<div class="goal"><div class="goal-head"><strong>${esc(g.name)}</strong><span>${money(cur, base(), 0)} / ${money(target, base(), 0)}</span></div>
    <div class="bar big"><span style="width:${(p * 100).toFixed(1)}%"></span></div><div class="sub">${(p * 100).toFixed(1)}% · ${note}</div>${fc ? `<div class="sub goal-fc">${fc}</div>` : ''}</div>`;
}

function renderGoals() {
  const sec = SECTIONS.goals;
  const goals = state.goals.length ? state.goals.map((g) => `<div class="card clickable" data-action="edit" data-sec="goals" data-id="${esc(g.id)}" tabindex="0">${goalCard(g)}</div>`).join('')
    : '<div class="card empty">No goals yet.</div>';
  // Each part is a box you can move or hide (Edit layout).
  return `<div class="page-head"><div><h1>${sec.title}</h1><p class="sub intro">${sec.intro}</p></div>
    <div class="row-actions"><button class="btn primary" data-action="add" data-sec="goals">+ Add</button></div></div>
    <section class="boxes" data-layout="sections">
      <div data-box="forecast" data-name="Forecast">${forecastCard()}</div>
      <div data-box="mix" data-name="Target mix">${targetMixCard()}</div>
      <div data-box="goals" data-name="Goals">${goals}</div>
    </section>`;
}

// ---------------------------------------------------------------- target mix

const mixLabel = (k) => CATEGORY_LABELS[k];
// How your assets are spread against the % you're aiming for, with suggested moves.
function targetMixCard() {
  const cfg = state.settings.targetMix;
  if (!cfg) {
    return `<div class="card mix-card"><div class="card-head"><h2>Target mix</h2></div>
      <p class="sub">Decide how much of your assets should be in each area, e.g. 50% stocks, 20% cash, 20% fixed deposits, 10% crypto. You’ll see how far off you are and roughly what to move.</p>
      <button class="btn primary" data-action="target-mix">Set target mix</button></div>`;
  }
  const mix = Calc.targetMix(summary.totals, cfg, summary.netMonthly);
  const tol = cfg.tolerance ?? 5;
  const rows = mix.rows.filter((r) => r.target > 0 || r.amount > 0).map((r) => {
    const status = r.onTarget ? '<span class="badge good">On target</span>' : `<span class="badge warn">${r.gap > 0 ? `Add ${money(r.gap, base(), 0)}` : `Over by ${money(-r.gap, base(), 0)}`}</span>`;
    return `<div class="mix-row">
        <div class="mix-head"><span><span class="dot" style="background:${CATEGORY_COLORS[r.key]}"></span><strong>${esc(mixLabel(r.key))}</strong></span>${status}</div>
        <div class="mix-bar" title="Now ${r.pct.toFixed(1)}% · target ${r.target}%"><span class="mix-fill" style="width:${Math.min(100, r.pct)}%;background:${CATEGORY_COLORS[r.key]}"></span><span class="mix-mark" style="left:${Math.min(100, r.target)}%"></span></div>
        <div class="sub">Now ${r.pct.toFixed(1)}% (${money(r.amount, base(), 0)}) · target ${r.target}%${r.onTarget ? '' : ` · ${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1)} points`}</div>
      </div>`;
  }).join('');
  const moves = mix.moves.length && !mix.onTarget ? `<h3>Rebalance now</h3><ul class="mix-moves">${mix.moves.map((m) => `<li>Move about <strong>${money(m.amount, base(), 0)}</strong> from ${esc(mixLabel(m.from))} to ${esc(mixLabel(m.to))}</li>`).join('')}</ul>` : '';
  const split = mix.split.length && !mix.onTarget ? `<h3>With new money (no selling)</h3><p class="sub">Put this month’s surplus of ${money(summary.netMonthly, base(), 0)} into:</p><ul class="mix-moves">${mix.split.map((x) => `<li>${esc(mixLabel(x.key))} <strong>${x.pct.toFixed(1)}%</strong> · ${money(x.amount, base(), 0)}</li>`).join('')}</ul>` : '';
  return `<div class="card mix-card">
      <div class="card-head"><h2>Target mix</h2><button class="btn small" data-action="target-mix">Edit</button></div>
      ${mix.onTarget ? '<p class="mix-ok"><span class="badge good">On target</span> Every area is within ±' + tol + ' points of your target.</p>' : ''}
      <div class="mix-rows">${rows}</div>
      ${moves}${split}
      <p class="sub mix-foot">Based on assets of ${money(mix.total, base(), 0)}${cfg.includeProperty ? ' (including property)' : ' (property not included)'} · on target within ±${tol} points · debts aren’t counted.</p>
    </div>`;
}

// Set the target % for each area (must add up to 100%), whether property counts, and the tolerance.
function openTargetMix() {
  const cfg = state.settings.targetMix || { targets: {}, includeProperty: false, tolerance: 5 };
  const keys = Calc.MIX_KEYS;
  const sumOf = (v) => keys.filter((k) => v.includeProperty || k !== 'property').reduce((t, k) => t + (+v[`t_${k}`] || 0), 0);
  openForm({
    title: 'Target mix',
    intro: 'What % of your assets you’d like in each area. They need to add up to 100%. Leave an area at 0 if you don’t want any there.',
    fields: [
      { key: 'includeProperty', label: 'Include property', type: 'checkbox', span: true },
      ...keys.map((k) => ({ key: `t_${k}`, label: `${mixLabel(k)} %`, type: 'number', showIf: k === 'property' ? (v) => v.includeProperty : undefined })),
      { key: 'tolerance', label: 'On target within ± (points)', type: 'number', help: 'E.g. 5: a 50% target counts as on target from 45% to 55%.' },
    ],
    values: { includeProperty: !!cfg.includeProperty, tolerance: cfg.tolerance ?? 5, ...Object.fromEntries(keys.map((k) => [`t_${k}`, cfg.targets[k] ?? ''])) },
    preview: (v) => { const t = sumOf(v); return `Total: <strong>${num(t, 2)}%</strong>${Math.abs(t - 100) < 0.01 ? ' ✓' : ` · ${t < 100 ? `${num(100 - t, 2)}% still to place` : `${num(t - 100, 2)}% too much`}`}`; },
    validate: (v) => (Math.abs(sumOf(v) - 100) > 0.01 ? `The targets add up to ${num(sumOf(v), 2)}% — they need to add up to 100%.` : !(v.tolerance >= 0 && v.tolerance <= 50) ? 'Tolerance should be between 0 and 50 points.' : keys.some((k) => +v[`t_${k}`] < 0) ? 'Targets can’t be negative.' : null),
    buttons: state.settings.targetMix ? [{ label: 'Remove', onClick: () => { setTargetMix(null); toast('Target mix removed'); } }] : [],
    onSave: (v) => {
      const targets = {};
      for (const k of keys) if ((v.includeProperty || k !== 'property') && +v[`t_${k}`] > 0) targets[k] = +v[`t_${k}`];
      setTargetMix({ targets, includeProperty: !!v.includeProperty, tolerance: +v.tolerance });
      toast('Target mix saved');
    },
  });
}
function setTargetMix(cfg) {
  const settings = { ...state.settings, targetMix: cfg };
  if (!cfg) delete settings.targetMix;
  state.settings = settings;
  state.settingsMt = Date.now();
  commit();
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
  const issues = healthIssues();
  const warn = issues.filter((x) => x.level === 'warn').length;
  return `<div class="page-head"><div><h1>Settings & Sync</h1></div></div>
    <a class="card health-link" href="#health"><span class="grow"><strong>Data health check</strong><span class="sub">${issues.length ? `${plural(issues.length, 'thing')} to look at${warn ? ` · ${warn} may affect your numbers` : ''}` : 'All clear'} · storage ${storagePct().toFixed(0)}% used</span></span>${issues.length ? `<span class="badge ${warn ? 'warn' : ''}">${issues.length}</span>` : '<span class="badge good">✓</span>'}<span class="chev" aria-hidden="true">›</span></a>
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

// ---------------------------------------------------------------- data health check

const storagePct = () => Math.min(100, (storageUsed / STORAGE_LIMIT) * 100);

// Things in your data that may be making your numbers wrong ('warn') or are worth a look ('info').
// Each: { key, level, title, text, fixes: [{ label, fix, id, extra, primary }] }.
function healthIssues() {
  const out = [];
  const t = todayISO();
  // 1. A stock whose currency doesn't match where its ticker trades: its price is misread.
  for (const h of state.stocks) {
    const want = currencyMismatch(h);
    if (!want) continue;
    out.push({ key: `cur:${h.id}`, level: 'warn', title: `${h.symbol}: currency ${h.currency || '—'}, but it trades in ${want}`, text: `Its live price is read as ${want}, so its value and profit are off. Set its currency to ${want} and check its average cost is in ${want}.`, fixes: [{ label: 'Open holding', fix: 'open', id: `stocks:${h.id}`, primary: true }] });
  }
  // 2. Rent on a property, and an income item that looks like the same rent but isn't linked.
  const linkedRent = new Set(state.cashflows.filter((c) => c.propertyId).map((c) => c.propertyId));
  const matched = new Set((summary ? summary.rentMatches : []).map((m) => m.cashflowId));
  for (const p of state.properties.filter((x) => +x.monthlyRent > 0 && !linkedRent.has(x.id))) {
    if (summary && summary.rentMatches.some((m) => m.propertyId === p.id)) continue;
    const like = state.cashflows.filter((c) => c.kind === 'income' && c.frequency !== 'once' && c.active !== false && !c.propertyId && !c.notRent && !matched.has(c.id) && !Calc.hasEnded(c, t)
      && (/rent|租/i.test(`${c.name} ${c.category || ''}`) || (c.currency === p.currency && Math.abs(Calc.amountOn(c, t) - +p.monthlyRent) <= 0.1 * +p.monthlyRent)));
    for (const c of like) {
      out.push({ key: `rent:${p.id}:${c.id}`, level: 'warn', title: `“${c.name}” and the rent on ${p.name} may be counted twice`, text: `${p.name} has rent of ${money(p.monthlyRent, p.currency)}/mo, and “${c.name}” is ${money(Calc.amountOn(c, t), c.currency)}/mo of income. If they’re the same rent, link them so it’s counted once.`, fixes: [{ label: 'Same rent — link them', fix: 'link-rent', id: c.id, extra: p.id, primary: true }, { label: 'Not the same', fix: 'not-rent', id: c.id }] });
    }
  }
  // 3. A linked bill or income that hasn't been confirmed for a while: maybe it was cancelled.
  const pend = Calc.pendingPayments(state, t).filter((x) => x.type === 'cashflow');
  const byItem = new Map();
  for (const x of pend) byItem.set(x.id, [...(byItem.get(x.id) || []), x]);
  const stale = Calc.toISO(Calc.addDays(new Date(), -45));
  for (const [id, list] of byItem) {
    const c = state.cashflows.find((x) => x.id === id);
    if (!c || list[0].date > stale || list.length < 2) continue;
    out.push({ key: `stale:${id}`, level: 'warn', title: `“${c.name}”: ${list.length} payments not confirmed since ${fmtDate(list[0].date)}`, text: 'Still paying it? Confirm the payments. If it was cancelled, end it so it stops counting in your spending.', fixes: [{ label: 'Review payments', fix: 'payments', primary: true }, { label: 'It was cancelled — end it', fix: 'end', id }] });
  }
  // 4. Past months without a card statement (card spending is estimated for them).
  for (const card of state.cards) {
    const missing = missingStatementMonths(card).slice(0, 6);
    if (!missing.length) continue;
    out.push({ key: `stmt:${card.id}`, level: 'info', title: `${card.name}: no statement for ${missing.map((m) => fmtMonth(m)).join(', ')}`, text: 'Card spending for those months is estimated from bills paid by card until you add the statement.', fixes: [{ label: `+ Add ${fmtMonth(missing[0])}`, fix: 'add-stmt', id: card.id, extra: missing[0], primary: true }] });
  }
  // 5. Long gaps in the daily history (days the app wasn't opened).
  const yearAgo = Calc.toISO(Calc.addDays(new Date(), -365));
  const days = state.history.map((h) => h.date).filter((d) => d >= yearAgo).sort();
  const gaps = [];
  for (let i = 1; i < days.length; i++) { const n = Calc.daysBetween(days[i - 1], days[i]); if (n > 14) gaps.push([days[i - 1], days[i], n - 1]); }
  if (gaps.length) out.push({ key: 'gaps', level: 'info', title: `${plural(gaps.length, 'gap')} in your daily history this year`, text: `No snapshot on ${gaps.slice(-3).map(([a, b, n]) => `${fmtDate(a)} – ${fmtDate(b)} (${plural(n, 'day')})`).join('; ')}. Charts join the dots; What changed and those months’ figures are less precise. Opening the app now and then fills it in — nothing to fix.`, fixes: [] });
  // 6. Storage space.
  const pct = storagePct();
  if (pct >= 70) out.push({ key: 'storage', level: 'warn', title: `Storage ${pct.toFixed(0)}% full`, text: 'Your browser only allows about 5 MB. Export a backup now; then older history can be trimmed.', fixes: [{ label: 'Export backup', fix: 'backup', primary: true }] });
  return out;
}

function renderHealth() {
  const issues = healthIssues();
  const pct = storagePct();
  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  const group = (level, title) => {
    const list = issues.filter((x) => x.level === level);
    if (!list.length) return '';
    return `<h2 class="health-h">${title}</h2>${list.map((x) => `<div class="card health-item ${x.level}">
        <div class="health-title">${icon(x.level === 'warn' ? 'alert' : 'info')}<strong class="keep-case">${esc(x.title)}</strong></div>
        <p class="sub">${esc(x.text)}</p>
        ${x.fixes.length ? `<div class="row-actions">${x.fixes.map((f) => `<button class="btn small ${f.primary ? 'primary' : ''}" data-action="health-fix" data-fix="${f.fix}" data-id="${esc(f.id || '')}" data-extra="${esc(f.extra || '')}">${esc(f.label)}</button>`).join('')}</div>` : ''}
      </div>`).join('')}`;
  };
  return `<a class="back" href="#settings">‹ Settings</a>
    <div class="page-head"><div><h1>Data health check</h1><p class="sub intro">Looks for things in your data that may be making your numbers wrong, and how much storage your data uses.</p></div></div>
    <div class="card storage-card"><div class="card-head"><h2>Storage</h2><span class="sub">${mb(storageUsed)} of about ${mb(STORAGE_LIMIT)}</span></div>
      <div class="mix-bar"><span class="mix-fill" style="width:${Math.max(1, pct)}%;background:${pct >= 70 ? 'var(--neg)' : 'var(--ink)'}"></span></div>
      <p class="sub">${pct.toFixed(1)}% used. Daily item values are kept for 90 days, then one per month, so it grows slowly — about 0.3 MB a year for most people.</p></div>
    ${issues.length ? '' : '<div class="card empty">✓ All clear — nothing found.</div>'}
    ${group('warn', 'May affect your numbers')}
    ${group('info', 'Worth a look')}`;
}

// The buttons on each finding.
function healthFix(fix, id, extra) {
  if (fix === 'open') { const [sec, x] = id.split(':'); return editItem(sec, x); }
  if (fix === 'payments') return reviewPayments();
  if (fix === 'backup') return download(`moneymonkey-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
  if (fix === 'add-stmt') return editItem('spending', null, { cardId: id, month: extra });
  if (fix === 'end') { endCashflow(id); return; }
  if (fix === 'link-rent') {
    updateCashflow(id, { propertyId: extra, notRent: undefined });
    return toast('Linked — the rent is counted once');
  }
  if (fix === 'not-rent') { updateCashflow(id, { notRent: true }); return toast('Kept as separate income'); }
}

// ---------------------------------------------------------------- forecast

const FC_KEY = { netWorth: 'nw', cash: 'cash', invest: 'invest', deposits: 'deposits' };
let fcExtra = 0; // "what if" extra saving per month (not saved)
let fcReturnShift = 0; // "what if" change to investment growth, in points (not saved)

// Your forecast settings (synced), with defaults from your data.
function fcSettings() {
  const t = summary.totals;
  const liquidish = t.cash + t.deposits + t.stocks + t.crypto;
  const investShare = liquidish > 0 ? Math.round(((t.stocks + t.crypto) / liquidish) * 10) * 10 : 0;
  return { years: 10, investShare, invReturn: 5, propGrowth: 2, inflation: 0, real: false, ...(state.settings.forecast || {}) };
}
// Where you are now, in the shape the forecast needs.
function fcStart() {
  const t = summary.totals;
  const skip = Calc.illiquidIds(state);
  const items = Calc.itemValues(state, todayISO());
  const loans = state.liabilities.filter((l) => l.type !== 'credit').map((l) => ({ balance: items[l.id] || 0, rate: (+l.rate || 0) / 100, payment: toBase(+l.payment || 0, l.currency) || 0, secured: skip.has(l.id) }));
  const loanSum = loans.reduce((x, d) => x + d.balance, 0);
  const otherVal = state.others.reduce((x, o) => x + (items[o.id] || 0), 0);
  const otherGrowth = otherVal > 0 ? state.others.reduce((x, o) => x + (items[o.id] || 0) * ((+o.annualChangePct || 0) / 100), 0) / otherVal : 0;
  return {
    start: { cash: t.cash, deposits: t.deposits, invest: t.stocks + t.crypto, property: t.property, other: t.other, liquidOther: state.others.filter((o) => o.liquid).reduce((x, o) => x + (items[o.id] || 0), 0), debts: loans, otherDebt: Math.max(0, summary.liabilities - loanSum) },
    otherGrowth,
  };
}
// Three outcomes: cautious, middle and good (investment growth ±4 points, property ±2).
function fcRuns() {
  const st = fcSettings();
  const { start, otherGrowth } = fcStart();
  const months = st.years * 12;
  const a = (dr, dp) => ({ saving: summary.netMonthly + fcExtra, investShare: st.investShare / 100, invReturn: (st.invReturn + fcReturnShift + dr) / 100, propGrowth: (st.propGrowth + dp) / 100, otherGrowth, inflation: st.real ? st.inflation / 100 : 0 });
  return { st, mid: Calc.forecast(start, a(0, 0), months), low: Calc.forecast(start, a(-4, -2), months), high: Calc.forecast(start, a(4, 2), months) };
}
const fcDate = (m) => fmtMonth(Calc.toISO(Calc.addMonths(new Date(), m)).slice(0, 7));

// A goal's line: when the forecast reaches it, against its target date.
function goalForecastLine(g, target) {
  const key = FC_KEY[g.metric || 'netWorth'];
  if (!key) return '';
  const runs = fcRuns();
  const m = Calc.reachMonth(runs.mid, key, target);
  if (m == null) return `Forecast: not within ${runs.st.years} years at this pace.`;
  let vs = '';
  if (g.targetDate) {
    const by = Calc.monthsBetween(todayISO(), g.targetDate);
    vs = m <= by ? ` · <span class="pos">${by - m ? `${plural(by - m, 'month')} early` : 'on time'}</span>` : ` · <span class="warn-text">${plural(m - by, 'month')} late</span>`;
  }
  return `Forecast: reached around <strong>${fcDate(m)}</strong>${vs}`;
}

// The chart: a shaded range (cautious to good) and the middle line, with your goals marked.
function fcChart(runs, key) {
  const W = 640, H = 220, pad = { l: 8, r: 8, t: 14, b: 8 };
  const n = runs.mid.length - 1;
  const vals = [...runs.low, ...runs.high].map((p) => p[key]);
  const goals = key === 'nw' ? state.goals.filter((g) => (g.metric || 'netWorth') === 'netWorth' && +g.target > runs.mid[0].nw) : [];
  let min = Math.min(...vals), max = Math.max(...vals, ...goals.map((g) => +g.target).filter((v) => v <= Math.max(...vals) * 1.15));
  if (min === max) { min -= 1; max += 1; }
  const x = (m) => pad.l + (m / n) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.m).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const band = `${line(runs.high)}${runs.low.slice().reverse().map((p) => `L${x(p.m).toFixed(1)},${y(p[key]).toFixed(1)}`).join('')}Z`;
  const marks = goals.filter((g) => +g.target <= max).map((g) => {
    const m = Calc.reachMonth(runs.mid, 'nw', +g.target);
    return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(+g.target)}" y2="${y(+g.target)}" class="fc-goal" vector-effect="non-scaling-stroke"/>${m != null ? `<circle cx="${x(m)}" cy="${y(+g.target)}" r="4" class="fc-dot"/>` : ''}`;
  }).join('');
  const labels = goals.filter((g) => +g.target <= max).map((g) => `<span class="fc-label" style="top:${(y(+g.target) / H) * 100}%">${esc(g.name)}</span>`).join('');
  const years = runs.st.years;
  return `<div class="fc-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Forecast">
      <path d="${band}" class="fc-band"/>${marks}<path d="${line(runs.mid)}" class="fc-line" vector-effect="non-scaling-stroke"/></svg>${labels}
      <div class="axis-labels"><span>Now</span><span>${Math.round(years / 2)} years</span><span>${years} years</span></div></div>`;
}

// The numbers and chart (redrawn while you move the "what if" sliders).
function fcOut() {
  const runs = fcRuns();
  const key = liquidView ? 'liquid' : 'nw';
  const at = (yr) => Math.min(yr * 12, runs.mid.length - 1);
  const yrs = [1, 5, runs.st.years].filter((v, i, arr) => v <= runs.st.years && arr.indexOf(v) === i);
  const stats = yrs.map((yr) => `<div class="m-stat"><span class="tile-label">In ${plural(yr, 'year')}</span><strong>${moneyShort(runs.mid[at(yr)][key])}</strong><span class="sub">${moneyShort(runs.low[at(yr)][key])} – ${moneyShort(runs.high[at(yr)][key])}</span></div>`).join('');
  const goalLines = state.goals.filter((g) => FC_KEY[g.metric || 'netWorth'] && goalCurrent(g) < +g.target).map((g) => `<li><span class="grow keep-case">${esc(g.name)}</span><span>${goalForecastLine(g, +g.target).replace(/^Forecast: /, '')}</span></li>`).join('');
  return `<div class="m-stats fc-stats">${stats}</div>
    ${fcChart(runs, key)}
    ${goalLines ? `<ul class="fc-goals">${goalLines}</ul>` : ''}`;
}

function forecastCard() {
  const st = fcSettings();
  const seg = [['all', 'All'], ['liquid', 'Liquid']].map(([k, l]) => `<button class="${(liquidView ? 'liquid' : 'all') === k ? 'on' : ''}" data-nw-view="${k}">${l}</button>`).join('');
  const yrs = [5, 10, 20].map((y) => `<option value="${y}" ${st.years === y ? 'selected' : ''}>${y} years</option>`).join('');
  return `<div class="card fc-card">
      <div class="card-head"><h2>Forecast</h2><div class="invest-controls"><div class="seg">${seg}</div><select class="range-select" data-fc-years aria-label="Forecast length">${yrs}</select></div></div>
      <p class="sub">${liquidView ? 'Liquid net worth' : 'Net worth'}${st.real ? ` in today’s money (${st.inflation}% inflation)` : ''}, if you keep saving ${money(summary.netMonthly + fcExtra, base(), 0)} a month. The shaded range is cautious to good (investment growth ±4 points, property ±2).</p>
      <div class="fc-out">${fcOut()}</div>
      <div class="fc-whatif">
        <label><span class="keep-case">What if I save <strong class="fc-extra-v">${fcExtra >= 0 ? '+' : '−'}${money(Math.abs(fcExtra), base(), 0)}</strong> a month</span><input type="range" min="-30000" max="30000" step="1000" value="${fcExtra}" data-fc-extra aria-label="Extra saving per month"></label>
        <label><span class="keep-case">…and investments grow <strong class="fc-ret-v">${st.invReturn + fcReturnShift}%</strong> a year</span><input type="range" min="-5" max="5" step="0.5" value="${fcReturnShift}" data-fc-ret aria-label="Investment growth"></label>
      </div>
      <details class="fc-assume"><summary>Assumptions</summary>
        <p class="sub">Saving is your Left Over each month (it already includes interest, dividends and rent). Growth below is price growth only. Loans are paid down on their schedules.</p>
        <div class="form-grid">
          <label>Of what you save, invested (%)<input type="number" min="0" max="100" step="5" value="${st.investShare}" data-fc-set="investShare"></label>
          <label>Investment growth (% a year)<input type="number" step="0.5" value="${st.invReturn}" data-fc-set="invReturn"></label>
          <label>Property growth (% a year)<input type="number" step="0.5" value="${st.propGrowth}" data-fc-set="propGrowth"></label>
          <label>Inflation (% a year)<input type="number" step="0.5" value="${st.inflation}" data-fc-set="inflation"></label>
          <label class="check span-2"><input type="checkbox" ${st.real ? 'checked' : ''} data-fc-set="real"> Show in today’s money (after inflation)</label>
        </div>
      </details>
    </div>`;
}
function saveFc(patch) {
  state.settings = { ...state.settings, forecast: { ...fcSettings(), ...patch } };
  state.settingsMt = Date.now();
  commit();
}
document.addEventListener('input', (e) => {
  const ex = e.target.closest('[data-fc-extra], [data-fc-ret]');
  if (!ex) return;
  if (ex.matches('[data-fc-extra]')) fcExtra = +ex.value; else fcReturnShift = +ex.value;
  const card = ex.closest('.fc-card');
  $('.fc-out', card).innerHTML = fcOut();
  $('.fc-extra-v', card).textContent = `${fcExtra >= 0 ? '+' : '−'}${money(Math.abs(fcExtra), base(), 0)}`;
  $('.fc-ret-v', card).textContent = `${fcSettings().invReturn + fcReturnShift}%`;
});
document.addEventListener('change', (e) => {
  const y = e.target.closest('[data-fc-years]');
  if (y) return saveFc({ years: +y.value });
  const f = e.target.closest('[data-fc-set]');
  if (!f) return;
  const k = f.dataset.fcSet;
  saveFc({ [k]: k === 'real' ? f.checked : +f.value || 0 });
});
