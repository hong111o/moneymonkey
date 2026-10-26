/*
 * MoneyMonkey — UI, state and live-update loop.
 * All data lives in this browser's localStorage. Nothing is sent anywhere except
 * ticker/coin symbols to the price APIs and your base currency to the FX API.
 */
(function () {
  'use strict';

  const { Calc, Charts, Prices } = window;
  const STORE_KEY = 'moneymonkey.v1';
  const HISTORY_MAX = 3650;
  const FX_MAX_AGE_MS = 60 * 60 * 1000;

  const todayISO = () => Calc.toISO(new Date());
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, el = document) => el.querySelector(sel);

  // ===================================================================== state

  function defaultState() {
    return {
      version: 1,
      settings: { baseCurrency: 'USD', finnhubKey: '', refreshSec: 60, theme: 'auto', privacy: false },
      accounts: [], stocks: [], crypto: [], deposits: [], properties: [], others: [], liabilities: [], cashflows: [], goals: [],
      history: [],
      fx: { base: 'USD', rates: { USD: 1 }, updatedAt: null },
      pricesUpdatedAt: null,
    };
  }

  function normalize(raw) {
    const s = { ...defaultState(), ...(raw || {}) };
    s.settings = { ...defaultState().settings, ...(raw && raw.settings) };
    for (const k of ['accounts', 'stocks', 'crypto', 'deposits', 'properties', 'others', 'liabilities', 'cashflows', 'goals', 'history']) {
      if (!Array.isArray(s[k])) s[k] = [];
    }
    if (!s.fx || !s.fx.rates) s.fx = defaultState().fx;
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return normalize(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save — browser storage is unavailable or full. Export a backup in Settings.', 'error');
    }
  }

  let state = load();

  // ================================================================ formatting

  const base = () => state.settings.baseCurrency;
  const hidden = () => state.settings.privacy;

  function money(v, cur = base(), dp = 2) {
    if (hidden()) return '••••••';
    if (v == null || !isFinite(v)) return '—';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, minimumFractionDigits: dp, maximumFractionDigits: dp }).format(v);
    } catch (e) {
      return `${cur} ${(+v).toFixed(dp)}`;
    }
  }

  function signed(v, cur = base(), dp = 2) {
    if (hidden()) return '<span>••••••</span>';
    if (!isFinite(v)) return '—';
    const cls = v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : '';
    const arrow = v > 0.005 ? '▲ ' : v < -0.005 ? '▼ ' : '';
    return `<span class="${cls}">${arrow}${money(Math.abs(v), cur, dp)}</span>`;
  }

  function pct(v, withSign = true) {
    if (!isFinite(v)) return '—';
    const s = (v * 100).toFixed(2) + '%';
    if (!withSign) return s;
    const cls = v > 0.00005 ? 'pos' : v < -0.00005 ? 'neg' : '';
    return `<span class="${cls}">${v > 0 ? '+' : ''}${s}</span>`;
  }

  const num = (v, dp = 4) => (v == null || !isFinite(v) ? '—' : (+v).toLocaleString(undefined, { maximumFractionDigits: dp }));
  const toBase = (amt, cur) => {
    const v = Calc.convert(+amt || 0, cur || base(), base(), state.fx);
    return isFinite(v) ? v : NaN;
  };
  const fmtDate = (iso) => {
    const d = Calc.parseDate(iso);
    return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  };
  const ago = (iso) => {
    if (!iso) return 'never';
    const s = Math.round((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  };
  const opt = (pairs) => pairs.map(([value, label]) => ({ value, label }));
  const labelOf = (options, v) => (options.find((o) => o.value === v) || {}).label || v || '';

  // ============================================================ field options

  const FREQ = opt([['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['semiannually', 'Every 6 months'], ['yearly', 'Yearly'], ['once', 'One-off']]);
  const COMPOUNDING = opt([['simple', 'Simple / paid at maturity'], ['monthly', 'Compounded monthly'], ['quarterly', 'Compounded quarterly'], ['semiannually', 'Compounded semi-annually'], ['annually', 'Compounded annually']]);
  const FLOW_KINDS = opt([['income', 'Income'], ['expense', 'Expense'], ['subscription', 'Subscription'], ['saving', 'Saving / investing']]);
  const EVENT_LABELS = { income: 'Income', expense: 'Expense', subscription: 'Subscription', saving: 'Saving', deposit: 'Deposit', property: 'Property' };
  const CATEGORY_COLORS = { cash: 'var(--series-1)', stocks: 'var(--series-2)', crypto: 'var(--series-3)', deposits: 'var(--series-4)', property: 'var(--series-5)', other: 'var(--series-6)' };
  const CATEGORY_LABELS = { cash: 'Cash & bank', stocks: 'Stocks & ETFs', crypto: 'Crypto', deposits: 'Fixed deposits', property: 'Property', other: 'Other assets' };

  const currencyField = { key: 'currency', label: 'Currency', type: 'currency', default: () => base() };

  // ================================================================ sections
  // Each list section is described once; the generic table/form code renders it.

  const SECTIONS = {
    accounts: {
      title: 'Cash & Bank',
      singular: 'account',
      intro: 'Bank balances, e-wallets and cash. Update the balance whenever you check your bank app.',
      fields: [
        { key: 'name', label: 'Account name', required: true, placeholder: 'e.g. Everyday savings' },
        { key: 'institution', label: 'Bank / provider', placeholder: 'e.g. HSBC' },
        { key: 'type', label: 'Type', type: 'select', options: opt([['savings', 'Savings'], ['current', 'Current / checking'], ['ewallet', 'E-wallet'], ['cash', 'Cash on hand'], ['moneymarket', 'Money market'], ['other', 'Other']]) },
        currencyField,
        { key: 'balance', label: 'Balance', type: 'number', required: true },
        { key: 'note', label: 'Note' },
      ],
      beforeSave: (item) => { item.updatedAt = new Date().toISOString(); },
      columns: [
        { label: 'Account', render: (a) => `<strong>${esc(a.name)}</strong><div class="sub">${esc(a.institution || '')}</div>` },
        { label: 'Type', render: (a) => esc(labelOf(SECTIONS.accounts.fields[2].options, a.type)) },
        { label: 'Balance', num: true, render: (a) => money(a.balance, a.currency) },
        { label: `In base`, num: true, render: (a) => money(toBase(a.balance, a.currency)) },
        { label: 'Updated', render: (a) => `<span class="sub">${ago(a.updatedAt)}</span>` },
      ],
      total: (items) => items.reduce((s, a) => s + (toBase(a.balance, a.currency) || 0), 0),
    },

    stocks: {
      title: 'Stocks & ETFs',
      singular: 'holding',
      intro: 'Prices update live from Finnhub (add your free API key in Settings). For tickers Finnhub doesn’t cover, choose “Manual price”. Non-US listings usually use a suffix, e.g. 0700.HK, D05.SI, VOD.L.',
      fields: [
        { key: 'symbol', label: 'Ticker symbol', required: true, upper: true, placeholder: 'AAPL' },
        { key: 'name', label: 'Name', placeholder: 'Apple Inc.' },
        { key: 'quantity', label: 'Shares / units', type: 'number', required: true },
        { key: 'avgCost', label: 'Average cost per share', type: 'number', required: true, help: 'Used to calculate your profit and loss.' },
        { ...currencyField, label: 'Trading currency', help: 'Currency the stock is quoted in.' },
        { key: 'source', label: 'Price source', type: 'select', options: opt([['live', 'Live (Finnhub)'], ['manual', 'Manual price']]) },
        { key: 'manualPrice', label: 'Current price', type: 'number', showIf: (v) => v.source === 'manual' },
        { key: 'broker', label: 'Broker / account' },
      ],
      beforeSave: (item, prev) => {
        if (!prev || prev.symbol !== item.symbol || item.source === 'manual') { item.lastPrice = null; item.prevClose = null; }
      },
      columns: holdingColumns('symbol'),
      total: (items) => items.reduce((s, h) => s + (toBase(Calc.holdingValue(h).marketValue, h.currency) || 0), 0),
    },

    crypto: {
      title: 'Crypto',
      singular: 'coin',
      intro: 'Prices update live from CoinGecko (no key needed). Use the CoinGecko coin id — e.g. bitcoin, ethereum, solana, tether — shown in the URL of the coin’s page on coingecko.com.',
      fields: [
        { key: 'coinId', label: 'CoinGecko id', required: true, lower: true, placeholder: 'bitcoin' },
        { key: 'symbol', label: 'Symbol', upper: true, placeholder: 'BTC' },
        { key: 'quantity', label: 'Quantity', type: 'number', required: true },
        { key: 'avgCost', label: 'Average cost per coin', type: 'number', required: true },
        { ...currencyField, label: 'Cost currency' },
        { key: 'source', label: 'Price source', type: 'select', options: opt([['live', 'Live (CoinGecko)'], ['manual', 'Manual price']]) },
        { key: 'manualPrice', label: 'Current price', type: 'number', showIf: (v) => v.source === 'manual' },
        { key: 'wallet', label: 'Exchange / wallet' },
      ],
      beforeSave: (item, prev) => {
        if (!prev || prev.coinId !== item.coinId || prev.currency !== item.currency || item.source === 'manual') { item.lastPrice = null; item.prevClose = null; }
      },
      columns: holdingColumns('coin'),
      total: (items) => items.reduce((s, h) => s + (toBase(Calc.holdingValue(h).marketValue, h.currency) || 0), 0),
    },

    deposits: {
      title: 'Fixed Deposits',
      singular: 'fixed deposit',
      intro: 'Interest accrues day by day. Enter either the interest rate, or the total interest the bank quoted you — MoneyMonkey works out the other.',
      fields: [
        { key: 'bank', label: 'Bank', required: true },
        { key: 'name', label: 'Reference / label', placeholder: 'e.g. 12-month promo' },
        currencyField,
        { key: 'principal', label: 'Principal (amount deposited)', type: 'number', required: true },
        { key: 'startDate', label: 'Start date', type: 'date', required: true, default: todayISO },
        { key: 'termMonths', label: 'Term (months)', type: 'number', required: true, default: () => 12, step: '1' },
        { key: 'compounding', label: 'Interest type', type: 'select', options: COMPOUNDING },
        { key: 'rateMode', label: 'I know the…', type: 'select', options: opt([['rate', 'Interest rate (% p.a.)'], ['interest', 'Total interest amount at maturity']]), transient: true },
        { key: 'rate', label: 'Interest rate (% per year)', type: 'number', showIf: (v) => v.rateMode !== 'interest', required: true },
        { key: 'interestAmount', label: 'Total interest at maturity', type: 'number', showIf: (v) => v.rateMode === 'interest', required: true, transient: true },
      ],
      beforeSave: (item) => {
        if (item.rateMode === 'interest') item.rate = +Calc.impliedRate(item.principal, item.interestAmount, item.startDate, item.termMonths, item.compounding).toFixed(4);
        delete item.rateMode;
        delete item.interestAmount;
      },
      columns: [
        { label: 'Deposit', render: (d) => `<strong>${esc(d.bank)}</strong><div class="sub">${esc(d.name || '')}</div>` },
        { label: 'Principal', num: true, render: (d) => money(d.principal, d.currency) },
        { label: 'Rate', num: true, render: (d) => `${num(d.rate, 3)}%<div class="sub">${esc(labelOf(COMPOUNDING, d.compounding).replace('Compounded ', ''))}</div>` },
        { label: 'Term', render: (d) => { const v = Calc.depositValue(d, todayISO()); return `${fmtDate(d.startDate)} → ${fmtDate(v.maturityDate)}<div class="bar"><span style="width:${(v.progress * 100).toFixed(1)}%"></span></div>`; } },
        { label: 'Interest so far', num: true, render: (d) => { const v = Calc.depositValue(d, todayISO()); return `<span class="pos">${money(v.interest, d.currency)}</span><div class="sub">+${money(v.dailyInterest, d.currency)}/day</div>`; } },
        { label: 'Value today', num: true, render: (d) => money(Calc.depositValue(d, todayISO()).value, d.currency) },
        { label: 'At maturity', num: true, render: (d) => { const v = Calc.depositValue(d, todayISO()); return `${money(v.maturityValue, d.currency)}<div class="sub">${v.matured ? '<span class="badge warn">Matured</span>' : `${v.daysLeft} days left`}</div>`; } },
      ],
      total: (items) => items.reduce((s, d) => s + (toBase(Calc.depositValue(d, todayISO()).value, d.currency) || 0), 0),
    },

    properties: {
      title: 'Property',
      singular: 'property',
      intro: 'Record a new valuation weekly or monthly (from a valuation site, agent or bank). You’ll get a reminder on the dashboard when an update is due.',
      fields: [
        { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Home' },
        { key: 'address', label: 'Address / note' },
        currencyField,
        { key: 'purchasePrice', label: 'Purchase price', type: 'number' },
        { key: 'purchaseDate', label: 'Purchase date', type: 'date' },
        { key: 'currentValue', label: 'Current estimated value', type: 'number', required: true, onlyNew: true, transient: true },
        { key: 'updateFrequency', label: 'Remind me to update the value', type: 'select', options: opt([['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']]), default: () => 'monthly' },
        { key: 'monthlyRent', label: 'Monthly rental income (if let)', type: 'number', help: 'Counted as passive income. Add it in Cash flow too if you want it in your budget.' },
      ],
      beforeSave: (item, prev) => {
        item.valuations = prev ? prev.valuations || [] : [];
        if (!prev && isFinite(item.currentValue)) item.valuations.push({ date: todayISO(), value: item.currentValue });
        delete item.currentValue;
      },
      actions: [{ id: 'valuation', label: 'Update value' }],
      columns: [
        { label: 'Property', render: (p) => `<strong>${esc(p.name)}</strong><div class="sub">${esc(p.address || '')}</div>` },
        { label: 'Value', num: true, render: (p) => `${money(Calc.propertyValue(p, todayISO()).value, p.currency, 0)}${Charts.sparkline([...(p.valuations || [])].sort((a, b) => (a.date < b.date ? -1 : 1)).map((v) => +v.value))}` },
        { label: 'Purchase', num: true, render: (p) => `${money(p.purchasePrice, p.currency, 0)}<div class="sub">${p.purchaseDate ? fmtDate(p.purchaseDate) : ''}</div>` },
        { label: 'Gain', num: true, render: (p) => { const v = Calc.propertyValue(p, todayISO()); return p.purchasePrice ? `${signed(v.gain, p.currency, 0)}<div class="sub">${pct(v.gainPct)}</div>` : '—'; } },
        { label: 'Rent / mo', num: true, render: (p) => (p.monthlyRent ? money(p.monthlyRent, p.currency, 0) : '—') },
        { label: 'Last valued', render: (p) => { const v = Calc.propertyValue(p, todayISO()); return `${fmtDate(v.lastDate)}${v.stale ? ' <span class="badge warn">Update due</span>' : `<div class="sub">next ${fmtDate(v.nextUpdate)}</div>`}`; } },
      ],
      total: (items) => items.reduce((s, p) => s + (toBase(Calc.propertyValue(p, todayISO()).value, p.currency) || 0), 0),
    },

    others: {
      title: 'Other Assets',
      singular: 'asset',
      intro: 'Anything else you own: car, gold, pension / retirement funds, insurance cash value, money owed to you… Set a yearly change to let the value drift automatically (e.g. −15% for a car).',
      fields: [
        { key: 'name', label: 'Name', required: true },
        { key: 'category', label: 'Category', type: 'select', options: opt([['vehicle', 'Vehicle'], ['gold', 'Gold / precious metals'], ['retirement', 'Retirement / pension fund'], ['insurance', 'Insurance cash value'], ['business', 'Business stake'], ['receivable', 'Money owed to me'], ['collectible', 'Collectibles'], ['other', 'Other']]) },
        currencyField,
        { key: 'value', label: 'Value', type: 'number', required: true },
        { key: 'valueDate', label: 'Valued on', type: 'date', default: todayISO },
        { key: 'annualChangePct', label: 'Expected change per year (%)', type: 'number', help: 'Negative for depreciation. Leave blank to keep the value fixed.' },
      ],
      columns: [
        { label: 'Asset', render: (o) => `<strong>${esc(o.name)}</strong>` },
        { label: 'Category', render: (o) => esc(labelOf(SECTIONS.others.fields[1].options, o.category)) },
        { label: 'Recorded value', num: true, render: (o) => `${money(o.value, o.currency)}<div class="sub">${fmtDate(o.valueDate)}</div>` },
        { label: 'Change / yr', num: true, render: (o) => (o.annualChangePct ? pct(o.annualChangePct / 100) : '—') },
        { label: 'Estimated today', num: true, render: (o) => money(Calc.otherAssetValue(o, todayISO()), o.currency) },
      ],
      total: (items) => items.reduce((s, o) => s + (toBase(Calc.otherAssetValue(o, todayISO()), o.currency) || 0), 0),
    },

    liabilities: {
      title: 'Loans & Debts',
      singular: 'loan',
      intro: 'Mortgages, car loans, credit cards. Choose “Auto” to let the balance fall each month based on the repayment schedule, or “Manual” to type the balance yourself.',
      fields: [
        { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Home mortgage' },
        { key: 'type', label: 'Type', type: 'select', options: opt([['mortgage', 'Mortgage'], ['car', 'Car loan'], ['personal', 'Personal loan'], ['credit', 'Credit card'], ['student', 'Student loan'], ['other', 'Other']]) },
        currencyField,
        { key: 'mode', label: 'Balance tracking', type: 'select', options: opt([['amortizing', 'Auto — calculate from repayment schedule'], ['manual', 'Manual — I’ll enter the balance']]) },
        { key: 'balance', label: 'Current balance owed', type: 'number', required: true, showIf: (v) => v.mode === 'manual' },
        { key: 'principal', label: 'Original loan amount', type: 'number', required: true, showIf: (v) => v.mode !== 'manual' },
        { key: 'startDate', label: 'Loan start date', type: 'date', required: true, showIf: (v) => v.mode !== 'manual', help: 'First repayment is assumed one month after this date.' },
        { key: 'rate', label: 'Interest rate (% per year)', type: 'number' },
        { key: 'payment', label: 'Monthly repayment', type: 'number', required: true, showIf: (v) => v.mode !== 'manual' },
        { key: 'paymentManual', label: 'Monthly repayment (optional)', type: 'number', showIf: (v) => v.mode === 'manual', transient: true },
      ],
      beforeSave: (item) => {
        if (item.mode === 'manual') item.payment = item.paymentManual ?? item.payment ?? null;
        delete item.paymentManual;
      },
      editValues: (item) => ({ ...item, paymentManual: item.payment }),
      columns: [
        { label: 'Loan', render: (l) => `<strong>${esc(l.name)}</strong><div class="sub">${esc(labelOf(SECTIONS.liabilities.fields[1].options, l.type))}</div>` },
        { label: 'Rate', num: true, render: (l) => (l.rate ? `${num(l.rate, 3)}%` : '—') },
        { label: 'Repayment / mo', num: true, render: (l) => (l.payment ? money(l.payment, l.currency) : '—') },
        { label: 'Balance owed', num: true, render: (l) => `<span class="neg">${money(Calc.loanBalance(l, todayISO()).balance, l.currency)}</span>` },
        { label: 'Debt-free', render: (l) => { const v = Calc.loanBalance(l, todayISO()); if (v.monthsLeft == null) return '—'; if (!isFinite(v.monthsLeft)) return '<span class="badge warn">Repayment too low</span>'; return `${fmtDate(Calc.toISO(Calc.addMonths(new Date(), v.monthsLeft)))}<div class="sub">${v.monthsLeft} payments left</div>`; } },
      ],
      total: (items) => items.reduce((s, l) => s + (toBase(Calc.loanBalance(l, todayISO()).balance, l.currency) || 0), 0),
      negative: true,
    },

    cashflows: {
      title: 'Cash Flow',
      singular: 'item',
      intro: 'Recurring income, bills, subscriptions and regular savings. Everything is normalised to a monthly figure so you can see where your money goes.',
      fields: [
        { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Salary, Netflix, Rent' },
        { key: 'kind', label: 'Type', type: 'select', options: FLOW_KINDS },
        { key: 'category', label: 'Category', placeholder: 'e.g. Housing, Food, Entertainment', list: 'category-list' },
        { key: 'amount', label: 'Amount', type: 'number', required: true },
        currencyField,
        { key: 'frequency', label: 'How often', type: 'select', options: FREQ, default: () => 'monthly' },
        { key: 'nextDate', label: 'Next payment date', type: 'date', default: todayISO },
        { key: 'active', label: 'Active', type: 'checkbox', default: () => true },
      ],
      columns: [
        { label: 'Item', render: (c) => `<strong>${esc(c.name)}</strong><div class="sub">${esc(c.category || '')}</div>` },
        { label: 'Type', render: (c) => `<span class="badge kind-${esc(c.kind)}">${esc(labelOf(FLOW_KINDS, c.kind))}</span>` },
        { label: 'Amount', num: true, render: (c) => `${money(c.amount, c.currency)}<div class="sub">${esc(labelOf(FREQ, c.frequency))}</div>` },
        { label: 'Per month', num: true, render: (c) => money(toBase(Calc.monthlyAmount(c), c.currency)) },
        { label: 'Per year', num: true, render: (c) => money(toBase(Calc.monthlyAmount(c) * 12, c.currency)) },
        { label: 'Next', render: (c) => (c.active === false ? '<span class="badge">Paused</span>' : fmtDate(Calc.nextOccurrence(c, todayISO()))) },
      ],
    },

    goals: {
      title: 'Goals',
      singular: 'goal',
      intro: 'Set targets and see how long your current monthly surplus will take to get there.',
      fields: [
        { key: 'name', label: 'Goal', required: true, placeholder: 'e.g. Emergency fund, First million' },
        { key: 'metric', label: 'Measure progress by', type: 'select', options: opt([['netWorth', 'Net worth'], ['cash', 'Cash & bank'], ['invest', 'Stocks + crypto'], ['deposits', 'Fixed deposits'], ['manual', 'Amount I enter']]) },
        { key: 'saved', label: 'Amount saved so far', type: 'number', showIf: (v) => v.metric === 'manual' },
        { key: 'target', label: 'Target amount (base currency)', type: 'number', required: true },
        { key: 'targetDate', label: 'Target date (optional)', type: 'date' },
      ],
    },
  };

  function holdingColumns(kind) {
    return [
      { label: kind === 'coin' ? 'Coin' : 'Holding', render: (h) => `<strong>${esc(kind === 'coin' ? h.symbol || h.coinId : h.symbol)}</strong><div class="sub">${esc(kind === 'coin' ? h.coinId : h.name || '')}</div>` },
      { label: 'Qty', num: true, render: (h) => num(h.quantity, 8) },
      { label: 'Avg cost', num: true, render: (h) => money(h.avgCost, h.currency) },
      { label: 'Price', num: true, render: (h) => { const v = Calc.holdingValue(h); return `${money(v.price, h.currency)}<div class="sub">${v.live ? '<span class="live-dot"></span>live' : h.source === 'manual' ? 'manual' : 'waiting…'}</div>`; } },
      { label: kind === 'coin' ? '24h' : 'Today', num: true, render: (h) => { const v = Calc.holdingValue(h); return v.live && h.prevClose ? `${signed(v.dayChange, h.currency)}<div class="sub">${pct(v.dayChangePct)}</div>` : '—'; } },
      { label: 'Market value', num: true, render: (h) => money(Calc.holdingValue(h).marketValue, h.currency) },
      { label: 'Profit / loss', num: true, render: (h) => { const v = Calc.holdingValue(h); return `${signed(v.pnl, h.currency)}<div class="sub">${pct(v.pnlPct)}</div>`; } },
    ];
  }

  // ================================================================== views

  const VIEWS = [
    { id: 'dashboard', label: 'Dashboard', icon: '◎' },
    { id: 'accounts', label: 'Cash & Bank', icon: '¤' },
    { id: 'stocks', label: 'Stocks', icon: '↗' },
    { id: 'crypto', label: 'Crypto', icon: '₿' },
    { id: 'deposits', label: 'Fixed Deposits', icon: '%' },
    { id: 'properties', label: 'Property', icon: '⌂' },
    { id: 'others', label: 'Other Assets', icon: '◆' },
    { id: 'liabilities', label: 'Loans & Debts', icon: '−' },
    { id: 'cashflows', label: 'Cash Flow', icon: '⇄' },
    { id: 'goals', label: 'Goals', icon: '★' },
    { id: 'settings', label: 'Settings', icon: '⚙' },
  ];

  let currentView = 'dashboard';
  let historyRange = '90';
  let summary = null;

  function route() {
    const id = location.hash.replace('#', '');
    currentView = VIEWS.some((v) => v.id === id) ? id : 'dashboard';
    render();
    window.scrollTo(0, 0);
  }

  function renderNav() {
    $('#nav').innerHTML = VIEWS.map(
      (v) => `<a href="#${v.id}" class="${v.id === currentView ? 'active' : ''}"><span class="icon" aria-hidden="true">${v.icon}</span><span>${v.label}</span>${navCount(v.id)}</a>`
    ).join('');
  }

  function navCount(id) {
    const n = Array.isArray(state[id]) ? state[id].length : 0;
    return n && SECTIONS[id] ? `<span class="count">${n}</span>` : '';
  }

  function render() {
    summary = Calc.summarize(state, todayISO());
    document.documentElement.dataset.theme = state.settings.theme === 'auto' ? '' : state.settings.theme;
    if (state.settings.theme === 'auto') delete document.documentElement.dataset.theme;
    $('#privacy-btn').setAttribute('aria-pressed', String(!!state.settings.privacy));
    $('#privacy-btn').textContent = state.settings.privacy ? 'Show amounts' : 'Hide amounts';
    renderNav();
    renderStatus();
    const main = $('#main');
    if (currentView === 'dashboard') main.innerHTML = renderDashboard();
    else if (currentView === 'settings') main.innerHTML = renderSettings();
    else if (currentView === 'cashflows') main.innerHTML = renderCashflows();
    else if (currentView === 'goals') main.innerHTML = renderGoals();
    else main.innerHTML = renderSection(currentView);
    Charts.bindLineHover(main, tooltip);
    tickLive();
  }

  function renderStatus() {
    const anyLive = state.stocks.some((s) => s.source !== 'manual') || state.crypto.some((c) => c.source !== 'manual');
    $('#status').innerHTML = refreshing
      ? '<span class="spinner"></span> Updating prices…'
      : `${anyLive ? '<span class="live-dot"></span>' : ''}Prices ${ago(state.pricesUpdatedAt)} · FX ${ago(state.fx.updatedAt)}`;
  }

  // ---------------------------------------------------------------- dashboard

  function tile(label, value, sub = '', extra = '') {
    return `<div class="tile ${extra}"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
  }

  function renderDashboard() {
    const s = summary;
    const isEmpty = !['accounts', 'stocks', 'crypto', 'deposits', 'properties', 'others', 'liabilities', 'cashflows'].some((k) => state[k].length);
    if (isEmpty) {
      return `<section class="empty-hero">
        <h1>Welcome to MoneyMonkey 🐒</h1>
        <p>Track everything you own and owe in one place — bank balances, live stock and crypto prices, fixed deposits that accrue interest every day, property values, loans, and your monthly cash flow.</p>
        <p class="sub">Your data stays in this browser. Nothing is uploaded.</p>
        <div class="row-actions center">
          <a class="btn primary" href="#accounts">Add your first account</a>
          <button class="btn" data-action="demo">Explore with demo data</button>
        </div>
        <p class="sub">First, set your base currency in <a href="#settings">Settings</a> (currently ${esc(base())}).</p>
      </section>`;
    }

    const segs = Object.keys(s.totals).map((k) => ({ label: CATEGORY_LABELS[k], value: s.totals[k], color: CATEGORY_COLORS[k], display: money(s.totals[k], base(), 0) }));
    const legend = Object.keys(s.totals)
      .filter((k) => s.totals[k] > 0)
      .map((k) => `<tr><td><span class="swatch" style="background:${CATEGORY_COLORS[k]}"></span><a href="#${k === 'cash' ? 'accounts' : k === 'property' ? 'properties' : k === 'other' ? 'others' : k}">${CATEGORY_LABELS[k]}</a></td><td class="num">${money(s.totals[k], base(), 0)}</td><td class="num sub">${s.assets ? ((s.totals[k] / s.assets) * 100).toFixed(1) : 0}%</td></tr>`)
      .join('');

    const hist = filteredHistory();
    const first = hist[0];
    const histChange = first && hist.length > 1 ? s.netWorth - first.value : null;

    const events = s.events.slice(0, 12).map((e) => `<li><span class="ev-date">${fmtDate(e.date)}</span><span class="ev-label"><span class="badge kind-${esc(e.kind)}">${esc(EVENT_LABELS[e.kind] || e.kind)}</span> ${esc(e.label)}</span><span class="num">${e.amount != null ? money(e.amount) : ''}</span></li>`).join('');
    const alerts = [...s.alerts, ...setupAlerts()].map((a) => `<li class="alert ${a.level}"><span aria-hidden="true">${a.level === 'warn' ? '⚠' : 'ℹ'}</span> ${a.html || esc(a.text)}</li>`).join('');

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
        <div class="live-interest">
          ${s.depositDaily > 0 ? `<div class="tile-label">Interest earned today</div><div class="tile-value pos" id="live-interest">${money(0, base(), 4)}</div><div class="tile-sub">${money(s.depositDaily)} per day from fixed deposits</div>` : ''}
        </div>
      </section>

      ${alerts ? `<ul class="alerts">${alerts}</ul>` : ''}

      <section class="tiles">
        ${tile('Total assets', money(s.assets))}
        ${tile('Total liabilities', `<span class="${s.liabilities ? 'neg' : ''}">${money(s.liabilities)}</span>`, s.assets ? `Debt-to-asset ${(s.debtToAsset * 100).toFixed(1)}%` : '')}
        ${tile('Investment P&L', signed(s.investPnl), s.investCost ? `${pct(s.investPnlPct)} on ${money(s.investCost, base(), 0)} invested` : 'No holdings yet')}
        ${tile('Monthly net cash flow', signed(s.netMonthly), `${money(s.flow.income, base(), 0)} in · ${money(s.spending, base(), 0)} out`)}
        ${tile('Savings rate', s.flow.income ? pct(s.savingsRate, false) : '—', s.flow.saving ? `${money(s.flow.saving, base(), 0)}/mo set aside for saving` : 'of monthly income')}
        ${tile('Passive income', money(s.passiveMonthly), 'per month · deposit interest + rent')}
        ${tile('Emergency runway', isFinite(s.runwayMonths) ? `${s.runwayMonths.toFixed(1)} months` : '—', 'cash ÷ monthly spending')}
        ${tile('Subscriptions', money(s.flow.subscription), `${money(s.flow.subscription * 12, base(), 0)} per year`)}
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
          <div class="card-head">
            <h2>Net worth over time</h2>
            <div class="seg" role="group" aria-label="History range">
              ${['30', '90', '365', 'all'].map((r) => `<button data-action="range" data-range="${r}" class="${historyRange === r ? 'on' : ''}">${r === 'all' ? 'All' : r === '365' ? '1Y' : r + 'D'}</button>`).join('')}
            </div>
          </div>
          ${Charts.lineChart(hist, { format: (v) => money(v) })}
        </div>
      </section>

      <section class="grid-2">
        <div class="card">
          <h2>Next 30 days</h2>
          ${events ? `<ul class="events">${events}</ul>` : '<p class="sub">Nothing scheduled. Add bills, income and subscriptions in <a href="#cashflows">Cash flow</a>.</p>'}
        </div>
        <div class="card">
          <h2>Goals</h2>
          ${state.goals.length ? state.goals.map(goalCard).join('') : '<p class="sub">No goals yet. <a href="#goals">Set one</a> — e.g. an emergency fund of 6 months’ expenses.</p>'}
        </div>
      </section>`;
  }

  function setupAlerts() {
    const out = [];
    if (state.stocks.some((s) => s.source !== 'manual') && !state.settings.finnhubKey) {
      out.push({ level: 'warn', html: 'Live stock prices need a free Finnhub API key — add it in <a href="#settings">Settings</a>. Until then, holdings are valued at cost.' });
    }
    if (lastErrors.length) out.push({ level: 'warn', text: `Last price update had problems: ${lastErrors.slice(0, 3).join('; ')}${lastErrors.length > 3 ? '…' : ''}` });
    return out;
  }

  function filteredHistory() {
    const pts = state.history.map((h) => ({ date: h.date, value: h.netWorth }));
    if (historyRange === 'all') return pts;
    const from = Calc.toISO(Calc.addDays(new Date(), -+historyRange));
    return pts.filter((p) => p.date >= from);
  }

  // ---------------------------------------------------------------- generic list section

  function renderSection(key, opts = {}) {
    const sec = SECTIONS[key];
    const items = state[key];
    const total = sec.total ? sec.total(items) : null;
    let extra = '';
    if (key === 'stocks' || key === 'crypto') {
      let mv = 0, cost = 0, day = 0;
      for (const h of items) {
        const v = Calc.holdingValue(h);
        mv += toBase(v.marketValue, h.currency) || 0;
        cost += toBase(v.cost, h.currency) || 0;
        day += toBase(v.dayChange, h.currency) || 0;
      }
      extra = tile('Cost basis', money(cost)) + tile('Unrealised P&L', signed(mv - cost), cost ? pct((mv - cost) / cost) : '') + tile(key === 'crypto' ? 'Last 24h' : 'Today', signed(day));
    } else if (key === 'deposits') {
      extra = tile('Interest earned so far', `<span class="pos">${money(summary.depositInterest)}</span>`) + tile('Earning per day', money(summary.depositDaily)) + tile('Per month (approx.)', money((summary.depositDaily * 365) / 12));
    } else if (key === 'liabilities') {
      extra = tile('Monthly repayments', money(summary.debtPayments));
    } else if (key === 'properties') {
      extra = tile('Rental income / mo', money(summary.rentMonthly));
    }

    const rows = items
      .map((item) => `<tr>${sec.columns.map((c) => `<td class="${c.num ? 'num' : ''}" data-label="${esc(c.label)}">${c.render(item)}</td>`).join('')}
        <td class="actions">${(sec.actions || []).map((a) => `<button class="btn small" data-action="${a.id}" data-sec="${key}" data-id="${item.id}">${a.label}</button>`).join('')}
          <button class="btn small ghost" data-action="edit" data-sec="${key}" data-id="${item.id}" aria-label="Edit">Edit</button>
          <button class="btn small ghost danger" data-action="delete" data-sec="${key}" data-id="${item.id}" aria-label="Delete">Delete</button></td></tr>`)
      .join('');

    return `
      <div class="page-head">
        <div><h1>${sec.title}</h1><p class="sub">${sec.intro}</p></div>
        <div class="row-actions">
          ${key === 'stocks' || key === 'crypto' ? '<button class="btn" data-action="refresh">Refresh prices</button>' : ''}
          <button class="btn primary" data-action="add" data-sec="${key}">+ Add ${sec.singular}</button>
        </div>
      </div>
      ${opts.tiles ?? (total != null ? `<section class="tiles">${tile(`Total (${esc(base())})`, `<span class="${sec.negative ? 'neg' : ''}">${money(total)}</span>`)}${extra}</section>` : '')}
      ${items.length ? `<div class="card table-card"><table class="data"><thead><tr>${sec.columns.map((c) => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('')}<th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="card empty">No ${sec.singular}s yet. <button class="btn primary" data-action="add" data-sec="${key}">+ Add ${sec.singular}</button></div>`}
      ${opts.after || ''}`;
  }

  // ---------------------------------------------------------------- cash flow

  function renderCashflows() {
    const s = summary;
    const byCat = {};
    for (const c of state.cashflows) {
      if (c.active === false || c.kind === 'income' || c.kind === 'saving') continue;
      const k = c.category || (c.kind === 'subscription' ? 'Subscriptions' : 'Uncategorised');
      byCat[k] = (byCat[k] || 0) + (toBase(Calc.monthlyAmount(c), c.currency) || 0);
    }
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const max = cats.length ? cats[0][1] : 0;
    const catBars = cats.map(([k, v]) => `<div class="hbar"><span class="hbar-label">${esc(k)}</span><span class="hbar-track"><span style="width:${max ? (v / max) * 100 : 0}%"></span></span><span class="num">${money(v, base(), 0)}</span></div>`).join('');
    const tiles = `<section class="tiles">
        ${tile('Income / month', `<span class="pos">${money(s.flow.income)}</span>`)}
        ${tile('Expenses / month', money(s.flow.expense))}
        ${tile('Subscriptions / month', money(s.flow.subscription), `${money(s.flow.subscription * 12, base(), 0)} per year`)}
        ${tile('Left over / month', signed(s.netMonthly), s.flow.income ? `Savings rate ${pct(s.savingsRate, false)}` : '')}
        ${tile('Planned saving / month', money(s.flow.saving))}
      </section>`;
    const after = cats.length ? `<div class="card"><h2>Monthly spending by category</h2>${catBars}</div>` : '';
    return renderSection('cashflows', { tiles, after });
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
    if (cur >= target) note = '🎉 Reached!';
    else if (g.targetDate) {
      const m = Math.max(1, Calc.monthsBetween(todayISO(), g.targetDate));
      const need = (target - cur) / m;
      note = `Need ${money(need, base(), 0)}/month to hit it by ${fmtDate(g.targetDate)} — ${need <= summary.netMonthly ? '<span class="pos">on track</span>' : '<span class="neg">behind</span>'} at your current surplus.`;
    } else note = isFinite(months) ? `About ${months} months at your current surplus (${fmtDate(Calc.toISO(Calc.addMonths(new Date(), months)))}).` : 'Add income in Cash flow to estimate when you’ll get there.';
    return `<div class="goal"><div class="goal-head"><strong>${esc(g.name)}</strong><span>${money(cur, base(), 0)} / ${money(target, base(), 0)}</span></div>
      <div class="bar big"><span style="width:${(p * 100).toFixed(1)}%"></span></div><div class="sub">${(p * 100).toFixed(1)}% · ${note}</div></div>`;
  }

  function renderGoals() {
    const sec = SECTIONS.goals;
    return `<div class="page-head"><div><h1>${sec.title}</h1><p class="sub">${sec.intro}</p></div>
      <div class="row-actions"><button class="btn primary" data-action="add" data-sec="goals">+ Add goal</button></div></div>
      ${state.goals.length ? state.goals.map((g) => `<div class="card">${goalCard(g)}<div class="row-actions">
        <button class="btn small ghost" data-action="edit" data-sec="goals" data-id="${g.id}">Edit</button>
        <button class="btn small ghost danger" data-action="delete" data-sec="goals" data-id="${g.id}">Delete</button></div></div>`).join('')
        : '<div class="card empty">No goals yet.</div>'}`;
  }

  // ---------------------------------------------------------------- settings

  function renderSettings() {
    const st = state.settings;
    return `<div class="page-head"><div><h1>Settings</h1><p class="sub">Everything is stored only in this browser. Export a backup regularly, and import it on another device.</p></div></div>
      <form class="card form-grid" id="settings-form">
        <label>Base currency<input name="baseCurrency" list="currency-list" value="${esc(st.baseCurrency)}" required maxlength="3" pattern="[A-Za-z]{3}">
          <small>All totals are converted into this currency using live exchange rates.</small></label>
        <label>Price refresh interval (seconds)<input name="refreshSec" type="number" min="15" step="5" value="${esc(st.refreshSec)}">
          <small>Free Finnhub keys allow 60 requests/minute.</small></label>
        <label class="span-2">Finnhub API key (for live stock prices)<input name="finnhubKey" value="${esc(st.finnhubKey)}" autocomplete="off" placeholder="Paste key here">
          <small>Get a free key at <a href="https://finnhub.io/register" target="_blank" rel="noopener">finnhub.io/register</a>. Crypto prices and exchange rates don’t need a key.</small></label>
        <label>Theme<select name="theme">${[['auto', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}" ${st.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="span-2 row-actions"><button class="btn primary" type="submit">Save settings</button></div>
      </form>
      <div class="card">
        <h2>Data</h2>
        <div class="row-actions wrap">
          <button class="btn" data-action="refresh">Refresh prices & rates now</button>
          <button class="btn" data-action="export-json">Export backup (JSON)</button>
          <label class="btn">Import backup<input type="file" accept="application/json,.json" id="import-file" hidden></label>
          <button class="btn" data-action="export-csv">Export holdings (CSV)</button>
          <button class="btn" data-action="demo">Load demo data</button>
          <button class="btn danger" data-action="reset">Erase all data</button>
        </div>
        <p class="sub">Net worth history: ${state.history.length} daily snapshots${state.history.length ? ` since ${fmtDate(state.history[0].date)}` : ''}. Exchange rates for ${Object.keys(state.fx.rates || {}).length} currencies, updated ${ago(state.fx.updatedAt)}.</p>
      </div>`;
  }

  // ================================================================== forms

  const dialog = () => $('#dialog');

  function openForm({ title, fields, values = {}, isNew, onSave, submitLabel = 'Save' }) {
    const d = dialog();
    const vals = { ...values };
    for (const f of fields) if (vals[f.key] === undefined && f.default) vals[f.key] = f.default();
    for (const f of fields) if (vals[f.key] === undefined && f.type === 'select') vals[f.key] = f.options[0].value;

    const fieldHtml = (f) => {
      if (f.onlyNew && !isNew) return '';
      const v = vals[f.key];
      let input;
      if (f.type === 'select') input = `<select name="${f.key}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      else if (f.type === 'checkbox') return `<label class="check" data-field="${f.key}"><input type="checkbox" name="${f.key}" ${v ? 'checked' : ''}> ${f.label}</label>`;
      else {
        const type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
        const list = f.type === 'currency' ? 'list="currency-list" maxlength="3"' : f.list ? `list="${f.list}"` : '';
        input = `<input name="${f.key}" type="${type}" ${type === 'number' ? `step="${f.step || 'any'}"` : ''} ${list} value="${esc(v ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.type === 'currency' ? 'style="text-transform:uppercase"' : ''}>`;
      }
      return `<label data-field="${f.key}">${f.label}${f.required ? ' <span class="req">*</span>' : ''}${input}${f.help ? `<small>${f.help}</small>` : ''}</label>`;
    };

    d.innerHTML = `<form method="dialog" class="modal">
      <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header>
      <div class="form-grid">${fields.map(fieldHtml).join('')}</div>
      <p class="form-error" role="alert"></p>
      <footer><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${esc(submitLabel)}</button></footer>
    </form>`;
    const form = $('form', d);
    const read = () => {
      const out = {};
      for (const f of fields) {
        const el = form.elements[f.key];
        if (!el) continue;
        if (f.type === 'checkbox') out[f.key] = el.checked;
        else if (f.type === 'number') out[f.key] = el.value === '' ? null : +el.value;
        else {
          let s = el.value.trim();
          if (f.upper || f.type === 'currency') s = s.toUpperCase();
          if (f.lower) s = s.toLowerCase();
          out[f.key] = s;
        }
      }
      return out;
    };
    const visible = (f, v) => !f.showIf || f.showIf(v);
    const sync = () => {
      const v = read();
      for (const f of fields) {
        const el = form.querySelector(`[data-field="${f.key}"]`);
        if (el) el.hidden = !visible(f, v);
      }
    };
    form.addEventListener('change', sync);
    sync();
    form.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) d.close(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = read();
      for (const f of fields) {
        if (!visible(f, v) || (f.onlyNew && !isNew)) { if (f.showIf) delete v[f.key]; continue; }
        const empty = v[f.key] == null || v[f.key] === '';
        if (f.required && empty) return showError(form, `${f.label} is required.`);
        if (f.type === 'number' && !empty && !isFinite(v[f.key])) return showError(form, `${f.label} must be a number.`);
        if (f.type === 'currency' && !/^[A-Z]{3}$/.test(v[f.key])) return showError(form, 'Currency must be a 3-letter code like USD, HKD or SGD.');
      }
      const err = onSave(v);
      if (err) return showError(form, err);
      d.close();
    });
    d.showModal();
    const firstInput = form.querySelector('input:not([type=checkbox]), select');
    if (firstInput) firstInput.focus();
  }

  function showError(form, msg) {
    $('.form-error', form).textContent = msg;
  }

  function editItem(sec, id) {
    const def = SECTIONS[sec];
    const prev = id ? state[sec].find((x) => x.id === id) : null;
    openForm({
      title: `${prev ? 'Edit' : 'Add'} ${def.singular}`,
      fields: def.fields,
      values: prev ? (def.editValues ? def.editValues(prev) : { ...prev }) : {},
      isNew: !prev,
      onSave: (v) => {
        const item = { ...(prev || {}), ...v, id: prev ? prev.id : uid() };
        if (def.beforeSave) def.beforeSave(item, prev);
        if (prev) state[sec] = state[sec].map((x) => (x.id === id ? item : x));
        else state[sec].push(item);
        commit();
        toast(`${def.singular[0].toUpperCase() + def.singular.slice(1)} saved`);
        if ((sec === 'stocks' || sec === 'crypto') && item.source !== 'manual') refreshPrices({ force: false, fxOnly: false });
      },
    });
  }

  function updateValuation(id) {
    const p = state.properties.find((x) => x.id === id);
    const vals = [...(p.valuations || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
    openForm({
      title: `Update value — ${p.name}`,
      fields: [
        { key: 'date', label: 'Date', type: 'date', required: true, default: todayISO },
        { key: 'value', label: `Estimated value (${p.currency})`, type: 'number', required: true },
      ],
      values: { value: vals[0] ? vals[0].value : p.purchasePrice },
      isNew: true,
      submitLabel: 'Add valuation',
      onSave: (v) => {
        p.valuations = (p.valuations || []).filter((x) => x.date !== v.date);
        p.valuations.push({ date: v.date, value: v.value });
        commit();
        toast('Valuation recorded');
      },
    });
    if (vals.length) {
      const hist = document.createElement('div');
      hist.className = 'val-history';
      hist.innerHTML = `<h3>History</h3><ul>${vals.map((x) => `<li><span>${fmtDate(x.date)}</span><span class="num">${money(x.value, p.currency, 0)}</span><button type="button" class="btn small ghost danger" data-del-val="${esc(x.date)}">Remove</button></li>`).join('')}</ul>`;
      hist.addEventListener('click', (e) => {
        const b = e.target.closest('[data-del-val]');
        if (!b) return;
        p.valuations = p.valuations.filter((x) => x.date !== b.dataset.delVal);
        commit();
        b.closest('li').remove();
      });
      $('#dialog .form-error').before(hist);
    }
  }

  function commit() {
    recordSnapshot();
    save();
    render();
  }

  // ================================================================== live data

  let refreshing = false;
  let lastErrors = [];

  async function refreshPrices({ force = false } = {}) {
    if (refreshing) return;
    refreshing = true;
    renderStatus();
    const errors = [];
    try {
      const fxStale = !state.fx.updatedAt || state.fx.base !== base() || Date.now() - new Date(state.fx.updatedAt) > FX_MAX_AGE_MS;
      if (force || fxStale) {
        try { state.fx = await Prices.fetchFx(base()); } catch (e) { errors.push(`exchange rates (${e.message})`); }
      }

      const liveStocks = state.stocks.filter((s) => s.source !== 'manual');
      if (liveStocks.length && state.settings.finnhubKey) {
        const symbols = [...new Set(liveStocks.map((s) => s.symbol))];
        for (const sym of symbols) {
          try {
            const q = await Prices.fetchStockQuote(sym, state.settings.finnhubKey);
            for (const s of state.stocks) if (s.symbol === sym && s.source !== 'manual') { s.lastPrice = q.price; s.prevClose = q.prevClose; }
          } catch (e) { errors.push(`${sym} (${e.message})`); }
          if (symbols.length > 1) await Prices.sleep(250);
        }
      }

      const liveCoins = state.crypto.filter((c) => c.source !== 'manual');
      if (liveCoins.length) {
        try {
          const data = await Prices.fetchCrypto([...new Set(liveCoins.map((c) => c.coinId))], [...new Set(liveCoins.map((c) => c.currency))]);
          for (const c of liveCoins) {
            const q = data[c.coinId] && data[c.coinId][c.currency];
            if (!q) { errors.push(`${c.coinId} in ${c.currency} (not found)`); continue; }
            c.lastPrice = q.price;
            c.prevClose = isFinite(q.changePct) ? q.price / (1 + q.changePct / 100) : null;
          }
        } catch (e) { errors.push(`crypto (${e.message})`); }
      }

      if (liveStocks.length || liveCoins.length) state.pricesUpdatedAt = new Date().toISOString();
    } finally {
      refreshing = false;
      lastErrors = errors;
      recordSnapshot();
      save();
      // Don't yank a form the user is filling in; the next tick re-renders.
      if (!dialog().open) render();
      else renderStatus();
      if (force && errors.length) toast(`Some prices failed: ${errors.slice(0, 2).join('; ')}`, 'error');
      else if (force) toast('Prices updated');
    }
  }

  function recordSnapshot() {
    const s = Calc.summarize(state, todayISO());
    if (!s.assets && !s.liabilities) return;
    state.history = Calc.upsertHistory(state.history, { date: todayISO(), netWorth: round2(s.netWorth), assets: round2(s.assets), liabilities: round2(s.liabilities), currency: base() }, HISTORY_MAX);
  }
  const round2 = (v) => Math.round(v * 100) / 100;

  // Ticks the "interest earned today" figure every second without a full re-render.
  function tickLive() {
    const el = $('#live-interest');
    if (!el || !summary) return;
    const now = new Date();
    const frac = (now - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000;
    el.textContent = money(summary.depositDaily * frac, base(), 4);
  }

  let priceTimer = null;
  function schedule() {
    clearInterval(priceTimer);
    const sec = Math.max(15, +state.settings.refreshSec || 60);
    priceTimer = setInterval(() => { if (!document.hidden) refreshPrices(); }, sec * 1000);
  }

  // ================================================================== misc UI

  const tooltip = {
    el: null,
    show(html, x, y) {
      this.el = this.el || $('#tooltip');
      this.el.innerHTML = html;
      this.el.hidden = false;
      const r = this.el.getBoundingClientRect();
      const left = Math.min(window.innerWidth - r.width - 8, x + 14);
      const top = y + 14 + r.height > window.innerHeight ? y - r.height - 10 : y + 14;
      this.el.style.left = `${Math.max(8, left)}px`;
      this.el.style.top = `${top}px`;
    },
    hide() { if (this.el) this.el.hidden = true; },
  };

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportCsv() {
    const t = todayISO();
    const rows = [['Section', 'Name', 'Currency', 'Value', `Value (${base()})`]];
    const add = (sec, name, cur, v) => rows.push([sec, name, cur, round2(v), round2(toBase(v, cur))]);
    state.accounts.forEach((a) => add('Cash', a.name, a.currency, +a.balance || 0));
    state.stocks.forEach((h) => add('Stocks', h.symbol, h.currency, Calc.holdingValue(h).marketValue));
    state.crypto.forEach((h) => add('Crypto', h.symbol || h.coinId, h.currency, Calc.holdingValue(h).marketValue));
    state.deposits.forEach((d) => add('Fixed deposit', d.bank, d.currency, Calc.depositValue(d, t).value));
    state.properties.forEach((p) => add('Property', p.name, p.currency, Calc.propertyValue(p, t).value));
    state.others.forEach((o) => add('Other', o.name, o.currency, Calc.otherAssetValue(o, t)));
    state.liabilities.forEach((l) => add('Liability', l.name, l.currency, -Calc.loanBalance(l, t).balance));
    const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
    download(`moneymonkey-${t}.csv`, csv, 'text/csv');
  }

  function demoState() {
    const t = new Date();
    const d = (days) => Calc.toISO(Calc.addDays(t, days));
    const m = (months) => Calc.toISO(Calc.addMonths(t, months));
    const s = defaultState();
    s.settings = { ...state.settings, baseCurrency: 'USD' };
    s.accounts = [
      { id: uid(), name: 'Everyday account', institution: 'Demo Bank', type: 'current', currency: 'USD', balance: 4250, updatedAt: new Date().toISOString() },
      { id: uid(), name: 'High-yield savings', institution: 'Demo Bank', type: 'savings', currency: 'USD', balance: 18400, updatedAt: new Date().toISOString() },
      { id: uid(), name: 'Travel wallet', institution: 'E-wallet', type: 'ewallet', currency: 'EUR', balance: 620, updatedAt: new Date().toISOString() },
    ];
    s.stocks = [
      { id: uid(), symbol: 'AAPL', name: 'Apple', quantity: 25, avgCost: 165, currency: 'USD', source: 'live' },
      { id: uid(), symbol: 'VOO', name: 'Vanguard S&P 500 ETF', quantity: 12, avgCost: 410, currency: 'USD', source: 'live' },
      { id: uid(), symbol: 'PRIVATECO', name: 'Employee shares (manual)', quantity: 500, avgCost: 4, manualPrice: 6.5, currency: 'USD', source: 'manual' },
    ];
    s.crypto = [{ id: uid(), coinId: 'bitcoin', symbol: 'BTC', quantity: 0.15, avgCost: 42000, currency: 'USD', source: 'live' }];
    s.deposits = [
      { id: uid(), bank: 'Demo Bank', name: '12-month promo', currency: 'USD', principal: 20000, startDate: m(-5), termMonths: 12, compounding: 'simple', rate: 4.1 },
      { id: uid(), bank: 'Other Bank', name: '6-month', currency: 'USD', principal: 10000, startDate: Calc.toISO(Calc.addDays(Calc.addMonths(t, -6), 12)), termMonths: 6, compounding: 'monthly', rate: 3.6 },
    ];
    s.properties = [{
      id: uid(), name: 'Apartment', address: 'Demo city', currency: 'USD', purchasePrice: 420000, purchaseDate: m(-40), updateFrequency: 'monthly', monthlyRent: 0,
      valuations: [[-5, 448000], [-4, 451000], [-3, 449500], [-2, 455000], [-1, 458000]].map(([mo, v]) => ({ date: m(mo), value: v })),
    }];
    s.others = [
      { id: uid(), name: 'Car', category: 'vehicle', currency: 'USD', value: 28000, valueDate: m(-14), annualChangePct: -15 },
      { id: uid(), name: 'Retirement fund', category: 'retirement', currency: 'USD', value: 61000, valueDate: d(-20), annualChangePct: 5 },
    ];
    s.liabilities = [
      { id: uid(), name: 'Mortgage', type: 'mortgage', currency: 'USD', mode: 'amortizing', principal: 336000, startDate: m(-40), rate: 3.9, payment: 1585 },
      { id: uid(), name: 'Credit card', type: 'credit', currency: 'USD', mode: 'manual', balance: 1240, rate: 24, payment: 300 },
    ];
    s.cashflows = [
      { id: uid(), name: 'Salary', kind: 'income', category: 'Work', amount: 6800, currency: 'USD', frequency: 'monthly', nextDate: d(9), active: true },
      { id: uid(), name: 'Freelance', kind: 'income', category: 'Side income', amount: 450, currency: 'USD', frequency: 'biweekly', nextDate: d(3), active: true },
      { id: uid(), name: 'Mortgage repayment', kind: 'expense', category: 'Housing', amount: 1585, currency: 'USD', frequency: 'monthly', nextDate: d(5), active: true },
      { id: uid(), name: 'Groceries', kind: 'expense', category: 'Food', amount: 160, currency: 'USD', frequency: 'weekly', nextDate: d(2), active: true },
      { id: uid(), name: 'Utilities', kind: 'expense', category: 'Housing', amount: 210, currency: 'USD', frequency: 'monthly', nextDate: d(12), active: true },
      { id: uid(), name: 'Car insurance', kind: 'expense', category: 'Transport', amount: 960, currency: 'USD', frequency: 'yearly', nextDate: d(24), active: true },
      { id: uid(), name: 'Netflix', kind: 'subscription', category: 'Entertainment', amount: 15.49, currency: 'USD', frequency: 'monthly', nextDate: d(7), active: true },
      { id: uid(), name: 'Spotify', kind: 'subscription', category: 'Entertainment', amount: 11.99, currency: 'USD', frequency: 'monthly', nextDate: d(16), active: true },
      { id: uid(), name: 'Cloud storage', kind: 'subscription', category: 'Software', amount: 99, currency: 'USD', frequency: 'yearly', nextDate: d(40), active: true },
      { id: uid(), name: 'Monthly ETF top-up', kind: 'saving', category: 'Investing', amount: 800, currency: 'USD', frequency: 'monthly', nextDate: d(10), active: true },
    ];
    s.goals = [
      { id: uid(), name: 'Emergency fund', metric: 'cash', target: 30000 },
      { id: uid(), name: 'Net worth 500k', metric: 'netWorth', target: 500000, targetDate: m(36) },
    ];
    s.fx = state.fx;
    return s;
  }

  // ================================================================== events

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const { action, sec, id } = b.dataset;
    switch (action) {
      case 'add': return editItem(sec);
      case 'edit': return editItem(sec, id);
      case 'delete': {
        const item = state[sec].find((x) => x.id === id);
        if (item && confirm(`Delete “${item.name || item.symbol || item.coinId || item.bank}”?`)) {
          state[sec] = state[sec].filter((x) => x.id !== id);
          commit();
        }
        return;
      }
      case 'valuation': return updateValuation(id);
      case 'range': historyRange = b.dataset.range; return render();
      case 'refresh': return refreshPrices({ force: true });
      case 'privacy': state.settings.privacy = !state.settings.privacy; save(); return render();
      case 'export-json': return download(`moneymonkey-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
      case 'export-csv': return exportCsv();
      case 'demo':
        if (hasData() && !confirm('Replace ALL your current data with demo data? Export a backup first if you want to keep it.')) return;
        state = demoState();
        commit();
        location.hash = '#dashboard';
        refreshPrices({ force: true });
        return;
      case 'reset':
        if (!confirm('Erase all MoneyMonkey data in this browser? This cannot be undone.')) return;
        state = defaultState();
        save();
        render();
        return;
      default:
    }
  });

  const hasData = () => ['accounts', 'stocks', 'crypto', 'deposits', 'properties', 'others', 'liabilities', 'cashflows', 'goals'].some((k) => state[k].length);

  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'settings-form') return;
    e.preventDefault();
    const f = e.target.elements;
    const newBase = f.baseCurrency.value.trim().toUpperCase();
    const baseChanged = newBase !== state.settings.baseCurrency;
    state.settings = { ...state.settings, baseCurrency: newBase, finnhubKey: f.finnhubKey.value.trim(), refreshSec: Math.max(15, +f.refreshSec.value || 60), theme: f.theme.value };
    save();
    schedule();
    render();
    toast('Settings saved');
    refreshPrices({ force: baseChanged });
  });

  document.addEventListener('change', (e) => {
    if (e.target.id !== 'import-file' || !e.target.files[0]) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== 'object' || !data.settings) throw new Error('not a MoneyMonkey backup');
        if (hasData() && !confirm('Replace your current data with this backup?')) return;
        state = normalize(data);
        save();
        render();
        refreshPrices({ force: true });
        toast('Backup imported');
      } catch (err) {
        toast(`Import failed: ${err.message}`, 'error');
      }
    };
    reader.readAsText(e.target.files[0]);
  });

  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t) tooltip.show(esc(t.dataset.tip), e.clientX, e.clientY);
  });
  document.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) tooltip.hide(); });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPrices(); });
  window.addEventListener('hashchange', route);
  window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) { state = load(); render(); } });

  // Cash-flow categories datalist for the form
  function fillDatalists() {
    const cats = new Set(['Housing', 'Food', 'Transport', 'Utilities', 'Entertainment', 'Health', 'Insurance', 'Education', 'Shopping', 'Software', 'Work', 'Investing']);
    state.cashflows.forEach((c) => c.category && cats.add(c.category));
    $('#category-list').innerHTML = [...cats].map((c) => `<option value="${esc(c)}">`).join('');
  }

  // ================================================================== boot

  fillDatalists();
  route();
  recordSnapshot();
  save();
  refreshPrices();
  schedule();
  setInterval(tickLive, 1000);
  // Re-render each minute so time-based values (deposit interest, depreciation, dates) stay current.
  setInterval(() => { if (!document.hidden && !dialog().open) { fillDatalists(); render(); } }, 60000);
})();
