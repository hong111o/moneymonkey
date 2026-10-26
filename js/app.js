/*
 * MoneyMonkey — UI, state, live prices and sync.
 * Data lives in this browser's localStorage and, if sync is set up, in an encrypted secret
 * GitHub Gist. Price APIs only ever see ticker symbols / coin ids / your base currency.
 */
(function () {
  'use strict';

  const { Calc, Charts, Prices, Sync } = window;
  const STORE_KEY = 'moneymonkey.v1';
  const SYNC_KEY = 'moneymonkey.sync';
  const HISTORY_MAX = 3650;
  const FX_MAX_AGE_MS = 60 * 60 * 1000;
  const SYNC_INTERVAL_MS = 2 * 60 * 1000;
  const LIST_SECTIONS = ['accounts', 'stocks', 'crypto', 'deposits', 'properties', 'others', 'liabilities', 'cashflows', 'spending', 'goals'];
  const PLATFORM_SECTIONS = ['accounts', 'stocks', 'crypto', 'deposits', 'properties', 'others', 'liabilities'];

  const todayISO = () => Calc.toISO(new Date());
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, el = document) => el.querySelector(sel);
  const round2 = (v) => Math.round(v * 100) / 100;

  // ===================================================================== state

  function defaultState() {
    return {
      version: 2,
      settings: { baseCurrency: 'USD', finnhubKey: '', refreshSec: 60, theme: 'auto', privacy: false },
      settingsMt: 0,
      accounts: [], stocks: [], crypto: [], deposits: [], properties: [], others: [], liabilities: [], cashflows: [], spending: [], goals: [],
      activity: [],
      platformMeta: {},
      deleted: {},
      history: [],
      fx: { base: 'USD', rates: { USD: 1 }, updatedAt: null },
      pricesUpdatedAt: null,
    };
  }

  function normalize(raw) {
    const d = defaultState();
    const s = { ...d, ...(raw || {}) };
    s.settings = { ...d.settings, ...(raw && raw.settings) };
    for (const k of [...LIST_SECTIONS, 'activity', 'history']) if (!Array.isArray(s[k])) s[k] = [];
    for (const k of ['platformMeta', 'deleted']) if (!s[k] || typeof s[k] !== 'object') s[k] = {};
    if (!s.fx || !s.fx.rates) s.fx = d.fx;
    Calc.migratePlatforms(s);
    Calc.migrateAccounts(s);
    Calc.linkDeposits(s);
    s.version = 2;
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

  // Sync credentials are kept apart from the data so they never end up in backups or in the gist.
  function loadSyncCfg() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSyncCfg() {
    const toStore = { ...syncCfg };
    if (!toStore.remember) delete toStore.passphrase;
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(toStore)); } catch (e) { /* storage unavailable */ }
  }
  let syncCfg = loadSyncCfg();
  let sessionPass = syncCfg.passphrase || '';

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
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  };
  const opt = (pairs) => pairs.map(([value, label]) => ({ value, label }));
  const labelOf = (options, v) => (options.find((o) => o.value === v) || {}).label || v || '';
  const lastMonth = () => Calc.toISO(Calc.addMonths(new Date(), -1)).slice(0, 7);
  const fmtMonth = (ym) => {
    const d = Calc.parseDate(`${ym}-01`);
    return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : ym;
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // "12 months", "3 months 5 days", "45 days"
  function termText(v) {
    const m = v.termMonths;
    const rest = Calc.daysBetween(Calc.toISO(Calc.addMonths(Calc.parseDate(v.startDate), m)), v.maturityDate);
    if (!m) return plural(v.termDays, 'day');
    return rest > 0 ? `${plural(m, 'month')} ${plural(rest, 'day')}` : plural(m, 'month');
  }

  // ============================================================ field options

  const FREQ = opt([['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['semiannually', 'Every 6 months'], ['yearly', 'Yearly'], ['once', 'One-off']]);
  const COMPOUNDING = opt([['simple', 'Simple / paid at maturity'], ['monthly', 'Compounded monthly'], ['quarterly', 'Compounded quarterly'], ['semiannually', 'Compounded semi-annually'], ['annually', 'Compounded annually']]);
  const FLOW_KINDS = opt([['income', 'Income'], ['expense', 'Expense'], ['subscription', 'Subscription'], ['saving', 'Saving / investing']]);
  const ACCOUNT_TYPES = opt([['savings', 'Savings'], ['current', 'Current / checking'], ['ewallet', 'E-wallet'], ['cash', 'Cash on hand'], ['moneymarket', 'Money market'], ['other', 'Other']]);
  const OTHER_CATS = opt([['vehicle', 'Vehicle'], ['gold', 'Gold / precious metals'], ['retirement', 'Retirement / pension (MPF, SIPP…)'], ['insurance', 'Insurance cash value'], ['business', 'Business stake'], ['receivable', 'Money owed to me'], ['collectible', 'Collectibles'], ['other', 'Other']]);
  const LOAN_TYPES = opt([['mortgage', 'Mortgage'], ['car', 'Car loan'], ['personal', 'Personal loan'], ['credit', 'Credit card'], ['student', 'Student loan'], ['other', 'Other']]);
  const ON_MATURITY = opt([['cash', 'Move capital + interest to cash'], ['renew', 'Renew automatically (same term & rate)'], ['keep', 'Do nothing — I’ll update it myself']]);
  const EVENT_LABELS = { income: 'Income', expense: 'Expense', subscription: 'Subscription', saving: 'Saving', deposit: 'Deposit', property: 'Property' };
  const CATEGORY_COLORS = { cash: 'var(--series-1)', stocks: 'var(--series-2)', crypto: 'var(--series-3)', deposits: 'var(--series-4)', property: 'var(--series-5)', other: 'var(--series-6)' };
  const CATEGORY_LABELS = { cash: 'Cash & bank', stocks: 'Stocks & ETFs', crypto: 'Crypto', deposits: 'Fixed deposits', property: 'Property', other: 'Other assets' };
  const CATEGORY_VIEW = { cash: 'accounts', stocks: 'stocks', crypto: 'crypto', deposits: 'deposits', property: 'properties', other: 'others' };
  const PLATFORM_SUGGESTIONS = [
    'HSBC HK', 'Hang Seng Bank', 'Bank of China (HK)', 'Standard Chartered HK', 'ZA Bank', 'Mox', 'Futu / moomoo', 'Interactive Brokers', 'Tiger Brokers', 'MPF',
    'HSBC UK', 'Barclays', 'Lloyds', 'NatWest', 'Monzo', 'Starling', 'Chase UK', 'Revolut', 'Wise', 'Trading 212', 'Hargreaves Lansdown', 'Vanguard UK', 'AJ Bell', 'Freetrade', 'NS&I Premium Bonds',
  ];
  const REGION_SUGGESTIONS = ['Hong Kong', 'United Kingdom', 'United States', 'Singapore', 'Mainland China', 'Eurozone', 'Japan', 'Australia', 'Canada', 'Taiwan', 'Malaysia', 'Global'];

  const currencyField = { key: 'currency', label: 'Currency', type: 'currency', default: () => base() };
  const platformField = (label, placeholder, extra = {}) => ({ key: 'platform', label, list: 'platform-list', placeholder, ...extra });
  // NaN when a non-zero balance has no exchange rate yet, so we never show a misleading total.
  const accountTotal = (a) => Calc.accountBalances(a).reduce((t, b) => t + (+b.amount ? toBase(b.amount, b.currency) : 0), 0);
  const accountDeposits = (a) => state.deposits.filter((d) => d.accountId === a.id);
  const depositsTotal = (deps) => deps.reduce((t, d) => t + (toBase(Calc.depositValue(d, todayISO()).value, d.currency) || 0), 0);
  const accountName = (id) => (state.accounts.find((a) => a.id === id) || {}).name || '';
  const currenciesWord = (n) => `${n} ${n === 1 ? 'currency' : 'currencies'}`;
  const balanceList = (a) => `<div class="bal-list">${Calc.accountBalances(a).map((b) => `<div><span class="cur-tag">${esc(b.currency)}</span> ${money(b.amount, b.currency)}</div>`).join('')}</div>`;
  const platformLine = (item, more = '') => [item.platform, more].filter(Boolean).map(esc).join(' · ');

  // ================================================================ sections
  // Each list section is described once; the generic list/form code renders it.
  // `primary: true` marks the column shown big on the right of each card on phones.

  const SECTIONS = {
    accounts: {
      title: 'Cash & Bank',
      singular: 'account',
      intro: 'Your bank accounts, e-wallets and cash. Each account can hold cash in several currencies and fixed deposits. Tap an account to see everything in it.',
      rowAction: 'open-account',
      fields: [
        { key: 'name', label: 'Account name', required: true, placeholder: 'e.g. HSBC One' },
        platformField('Bank / platform', 'e.g. HSBC HK, Monzo'),
        { key: 'type', label: 'Type', type: 'select', options: ACCOUNT_TYPES },
        { key: 'balances', label: 'Balances', type: 'balances', required: true, span: true, default: () => [{ currency: base(), amount: null }], help: 'One line per currency held in this account.' },
        { key: 'note', label: 'Note' },
      ],
      editValues: (item) => ({ ...item, balances: Calc.accountBalances(item).map((b) => ({ ...b })) }),
      beforeSave: (item) => {
        item.updatedAt = new Date().toISOString();
        delete item.currency;
        delete item.balance;
      },
      columns: [
        { label: 'Account', render: (a) => `<strong>${esc(a.name)}</strong><div class="sub">${platformLine(a, labelOf(ACCOUNT_TYPES, a.type))}</div>` },
        { label: 'Cash', num: true, wide: true, render: balanceList },
        {
          label: 'Fixed deposits', num: true,
          render: (a) => { const deps = accountDeposits(a); return deps.length ? `${money(depositsTotal(deps))}<div class="sub">${plural(deps.length, 'deposit')}</div>` : '<span class="sub">—</span>'; },
        },
        {
          label: 'Total', num: true, primary: true,
          render: (a) => {
            const total = accountTotal(a) + depositsTotal(accountDeposits(a));
            const n = Calc.accountBalances(a).length;
            const note = isFinite(total) ? (n > 1 ? currenciesWord(n) : '') : 'waiting for exchange rate';
            return `${money(total)}${note ? `<div class="sub">${note}</div>` : ''}`;
          },
        },
        { label: 'Updated', render: (a) => `<span class="sub">${ago(a.updatedAt)}</span>` },
      ],
      total: (items) => items.reduce((s, a) => s + (accountTotal(a) || 0), 0),
    },

    stocks: {
      title: 'Stocks & ETFs',
      singular: 'holding',
      intro: 'Prices update live from Finnhub (free API key in Settings). For tickers it doesn’t cover, choose “Manual price”. Non-US listings use a suffix, e.g. 0700.HK, VOD.L.',
      fields: [
        { key: 'symbol', label: 'Ticker symbol', required: true, upper: true, placeholder: 'AAPL' },
        { key: 'name', label: 'Name', placeholder: 'Apple Inc.' },
        platformField('Broker / platform', 'e.g. Futu, Trading 212'),
        { key: 'quantity', label: 'Shares / units', type: 'number', required: true },
        { key: 'avgCost', label: 'Average cost per share', type: 'number', required: true, help: 'Used to calculate your profit and loss.' },
        { ...currencyField, label: 'Trading currency', help: 'Currency the stock is quoted in.' },
        { key: 'source', label: 'Price source', type: 'select', options: opt([['live', 'Live (Finnhub)'], ['manual', 'Manual price']]) },
        { key: 'manualPrice', label: 'Current price', type: 'number', showIf: (v) => v.source === 'manual' },
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
      intro: 'Prices update live from CoinGecko (no key needed). Use the CoinGecko coin id — e.g. bitcoin, ethereum, solana — shown in the coin’s URL on coingecko.com.',
      fields: [
        { key: 'coinId', label: 'CoinGecko id', required: true, lower: true, placeholder: 'bitcoin' },
        { key: 'symbol', label: 'Symbol', upper: true, placeholder: 'BTC' },
        platformField('Exchange / wallet', 'e.g. Coinbase, Ledger'),
        { key: 'quantity', label: 'Quantity', type: 'number', required: true },
        { key: 'avgCost', label: 'Average cost per coin', type: 'number', required: true },
        { ...currencyField, label: 'Cost currency' },
        { key: 'source', label: 'Price source', type: 'select', options: opt([['live', 'Live (CoinGecko)'], ['manual', 'Manual price']]) },
        { key: 'manualPrice', label: 'Current price', type: 'number', showIf: (v) => v.source === 'manual' },
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
      intro: 'All your fixed deposits across your bank accounts. Each deposit is held in a bank account; open an account in Cash & Bank to see its cash and deposits together. Interest accrues day by day, and at maturity the money can go back into the account automatically.',
      fields: [
        {
          key: 'accountId', label: 'Held in bank account', type: 'select', required: true, span: true,
          options: () => [
            ...state.accounts.map((a) => ({ value: a.id, label: `${a.name}${a.platform ? ` · ${a.platform}` : ''}` })),
            { value: '__new', label: '+ New bank account…' },
          ],
        },
        { key: 'newAccountName', label: 'New account name', required: true, transient: true, placeholder: 'e.g. HSBC One', showIf: (v) => v.accountId === '__new' },
        { key: 'newAccountPlatform', label: 'Bank / platform', required: true, transient: true, list: 'platform-list', placeholder: 'e.g. HSBC HK', showIf: (v) => v.accountId === '__new' },
        { key: 'name', label: 'Reference (optional)', placeholder: 'e.g. 6-month HKD promo' },
        currencyField,
        { key: 'principal', label: 'Amount deposited', type: 'number', required: true },
        { key: 'startDate', label: 'Start date', type: 'date', required: true, default: todayISO },
        { key: 'termMode', label: 'Term entered as', type: 'select', options: opt([['months', 'Number of months'], ['enddate', 'End (maturity) date']]), transient: true },
        { key: 'termMonths', label: 'Term (months)', type: 'number', required: true, default: () => 12, step: '1', showIf: (v) => v.termMode !== 'enddate' },
        { key: 'endDate', label: 'Maturity date', type: 'date', required: true, showIf: (v) => v.termMode === 'enddate' },
        { key: 'compounding', label: 'Interest type', type: 'select', options: COMPOUNDING },
        { key: 'rateMode', label: 'I know the…', type: 'select', options: opt([['rate', 'Interest rate (% p.a.)'], ['interest', 'Total interest amount at maturity']]), transient: true },
        { key: 'rate', label: 'Interest rate (% per year)', type: 'number', showIf: (v) => v.rateMode !== 'interest', required: true },
        { key: 'interestAmount', label: 'Total interest at maturity', type: 'number', showIf: (v) => v.rateMode === 'interest', required: true, transient: true },
        { key: 'onMaturity', label: 'When it matures', type: 'select', options: ON_MATURITY, span: true },
        {
          key: 'payoutAccountId', label: 'Move the money into', type: 'select', span: true, showIf: (v) => v.onMaturity === 'cash',
          options: (v) => [
            { value: '', label: v.accountId && v.accountId !== '__new' ? `Back into ${accountName(v.accountId) || 'the same account'}` : 'Back into the account it’s held in' },
            ...state.accounts.map((a) => ({ value: a.id, label: `${a.name}${a.platform ? ` · ${a.platform}` : ''} (${Calc.accountBalances(a).map((b) => b.currency).join(', ') || 'empty'})` })),
          ],
          help: 'Paid in the deposit’s own currency — added to that currency’s balance in the account.',
        },
      ],
      preview: depositPreview,
      validate: (v) => {
        if (v.termMode === 'enddate' && v.endDate && v.startDate && v.endDate <= v.startDate) return 'The maturity date must be after the start date.';
        if (v.termMode !== 'enddate' && !(v.termMonths >= 1)) return 'The term must be at least 1 month (or enter an end date).';
        return null;
      },
      editValues: (item) => ({ ...item, termMode: item.endDate ? 'enddate' : 'months' }),
      beforeSave: (item) => {
        if (item.termMode === 'enddate') item.termMonths = Calc.monthsBetween(item.startDate, item.endDate);
        else item.endDate = null;
        if (item.rateMode === 'interest') item.rate = +Calc.impliedRate(item.principal, item.interestAmount, item.startDate, item.termMonths, item.compounding, item.endDate).toFixed(8);
        if (item.onMaturity !== 'cash') delete item.payoutAccountId;
        if (item.accountId === '__new') {
          const acct = { id: uid(), name: item.newAccountName, platform: item.newAccountPlatform, type: 'savings', balances: [], updatedAt: new Date().toISOString(), _mt: Date.now() };
          state.accounts.push(acct);
          item.accountId = acct.id;
        }
        item.platform = (state.accounts.find((a) => a.id === item.accountId) || {}).platform || '';
      },
      columns: [
        { label: 'Deposit', render: (d) => `<strong>${esc(d.platform || 'Fixed deposit')}</strong><div class="sub">${[accountName(d.accountId), d.name].filter(Boolean).map(esc).join(' · ')}</div>` },
        {
          label: 'Period',
          render: (d) => {
            const v = Calc.depositValue(d, todayISO());
            return `<span class="nowrap">${fmtDate(v.startDate)}</span> → <span class="nowrap">${fmtDate(v.maturityDate)}</span>
              <div class="sub">${termText(v)} · ${v.matured ? 'matured' : `${plural(v.daysLeft, 'day')} left`}</div>
              <div class="bar"><span style="width:${(v.progress * 100).toFixed(1)}%"></span></div>`;
          },
          wide: true,
        },
        { label: 'Deposited', num: true, render: (d) => money(d.principal, d.currency) },
        { label: 'Rate', num: true, render: (d) => `${num(d.rate, 3)}%<div class="sub">${esc(labelOf(COMPOUNDING, d.compounding).replace('Compounded ', '').replace('Simple / paid at maturity', 'simple'))}</div>` },
        { label: 'Interest so far', num: true, render: (d) => { const v = Calc.depositValue(d, todayISO()); return `<span class="pos">${money(v.interest, d.currency)}</span><div class="sub">+${money(v.dailyInterest, d.currency)}/day</div>`; } },
        { label: 'Value today', num: true, primary: true, render: (d) => money(Calc.depositValue(d, todayISO()).value, d.currency) },
        {
          label: 'At maturity',
          num: true,
          render: (d) => {
            const v = Calc.depositValue(d, todayISO());
            const what = { cash: '→ moves to cash', renew: '↻ renews', keep: '' }[d.onMaturity || 'keep'];
            return `${money(v.maturityValue, d.currency)}<div class="sub">${v.matured && (d.onMaturity || 'keep') === 'keep' ? '<span class="badge warn">Matured</span>' : esc(what)}</div>`;
          },
        },
      ],
      total: (items) => items.reduce((s, d) => s + (toBase(Calc.depositValue(d, todayISO()).value, d.currency) || 0), 0),
    },

    properties: {
      title: 'Property',
      singular: 'property',
      intro: 'Record a new valuation weekly or monthly (from a valuation site, agent or bank). You’ll get a reminder when an update is due.',
      fields: [
        { key: 'name', label: 'Name', required: true, placeholder: 'e.g. London flat' },
        { key: 'address', label: 'Address / note' },
        platformField('Group under platform (optional)', 'e.g. UK property', { help: 'Lets it count towards a region on the Platforms page.' }),
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
      },
      actions: [{ id: 'valuation', label: 'Update value' }],
      columns: [
        { label: 'Property', render: (p) => `<strong>${esc(p.name)}</strong><div class="sub">${platformLine(p, p.address)}</div>` },
        { label: 'Value', num: true, primary: true, render: (p) => `${money(Calc.propertyValue(p, todayISO()).value, p.currency, 0)}${Charts.sparkline([...(p.valuations || [])].sort((a, b) => (a.date < b.date ? -1 : 1)).map((v) => +v.value))}` },
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
      intro: 'Anything else you own: car, gold, MPF / pension, insurance cash value, money owed to you… A yearly % change lets the value drift automatically (e.g. −15% for a car).',
      fields: [
        { key: 'name', label: 'Name', required: true },
        { key: 'category', label: 'Category', type: 'select', options: OTHER_CATS },
        platformField('Provider / platform', 'e.g. MPF provider, pension provider'),
        currencyField,
        { key: 'value', label: 'Value', type: 'number', required: true },
        { key: 'valueDate', label: 'Valued on', type: 'date', default: todayISO },
        { key: 'annualChangePct', label: 'Expected change per year (%)', type: 'number', help: 'Negative for depreciation. Leave blank to keep the value fixed.' },
      ],
      columns: [
        { label: 'Asset', render: (o) => `<strong>${esc(o.name)}</strong><div class="sub">${platformLine(o, labelOf(OTHER_CATS, o.category))}</div>` },
        { label: 'Recorded value', num: true, render: (o) => `${money(o.value, o.currency)}<div class="sub">${fmtDate(o.valueDate)}</div>` },
        { label: 'Change / yr', num: true, render: (o) => (o.annualChangePct ? pct(o.annualChangePct / 100) : '—') },
        { label: 'Estimated today', num: true, primary: true, render: (o) => money(Calc.otherAssetValue(o, todayISO()), o.currency) },
      ],
      total: (items) => items.reduce((s, o) => s + (toBase(Calc.otherAssetValue(o, todayISO()), o.currency) || 0), 0),
    },

    liabilities: {
      title: 'Loans & Debts',
      singular: 'loan',
      intro: 'Mortgages, car loans, credit cards. “Auto” lets the balance fall each month from the repayment schedule; “Manual” lets you type the balance yourself.',
      fields: [
        { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Home mortgage' },
        { key: 'type', label: 'Type', type: 'select', options: LOAN_TYPES },
        platformField('Lender / platform', 'e.g. HSBC UK'),
        currencyField,
        { key: 'mode', label: 'Balance tracking', type: 'select', options: opt([['amortizing', 'Auto — from repayment schedule'], ['manual', 'Manual — I’ll enter the balance']]) },
        { key: 'balance', label: 'Current balance owed', type: 'number', required: true, showIf: (v) => v.mode === 'manual' },
        { key: 'principal', label: 'Original loan amount', type: 'number', required: true, showIf: (v) => v.mode !== 'manual' },
        { key: 'startDate', label: 'Loan start date', type: 'date', required: true, showIf: (v) => v.mode !== 'manual', help: 'First repayment is assumed one month after this date.' },
        { key: 'rate', label: 'Interest rate (% per year)', type: 'number' },
        { key: 'payment', label: 'Monthly repayment', type: 'number', required: true, showIf: (v) => v.mode !== 'manual' },
        { key: 'paymentManual', label: 'Monthly repayment (optional)', type: 'number', showIf: (v) => v.mode === 'manual', transient: true },
      ],
      beforeSave: (item) => {
        if (item.mode === 'manual') item.payment = item.paymentManual ?? item.payment ?? null;
      },
      editValues: (item) => ({ ...item, paymentManual: item.payment }),
      columns: [
        { label: 'Loan', render: (l) => `<strong>${esc(l.name)}</strong><div class="sub">${platformLine(l, labelOf(LOAN_TYPES, l.type))}</div>` },
        { label: 'Rate', num: true, render: (l) => (l.rate ? `${num(l.rate, 3)}%` : '—') },
        { label: 'Repayment / mo', num: true, render: (l) => (l.payment ? money(l.payment, l.currency) : '—') },
        { label: 'Balance owed', num: true, primary: true, render: (l) => `<span class="neg">${money(Calc.loanBalance(l, todayISO()).balance, l.currency)}</span>` },
        { label: 'Debt-free', render: (l) => { const v = Calc.loanBalance(l, todayISO()); if (v.monthsLeft == null) return '—'; if (!isFinite(v.monthsLeft)) return '<span class="badge warn">Repayment too low</span>'; return `${fmtDate(Calc.toISO(Calc.addMonths(new Date(), v.monthsLeft)))}<div class="sub">${v.monthsLeft} payments left</div>`; } },
      ],
      total: (items) => items.reduce((s, l) => s + (toBase(Calc.loanBalance(l, todayISO()).balance, l.currency) || 0), 0),
      negative: true,
    },

    cashflows: {
      title: 'Cash Flow',
      singular: 'item',
      intro: 'Recurring income, bills, subscriptions and regular savings, normalised to a monthly figure so you can see where your money goes.',
      fields: [
        { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Salary, Netflix, Rent' },
        { key: 'kind', label: 'Type', type: 'select', options: FLOW_KINDS },
        { key: 'category', label: 'Category', placeholder: 'e.g. Housing, Food', list: 'category-list' },
        { key: 'amount', label: 'Amount', type: 'number', required: true },
        currencyField,
        { key: 'frequency', label: 'How often', type: 'select', options: FREQ, default: () => 'monthly' },
        { key: 'nextDate', label: 'Next payment date', type: 'date', default: todayISO },
        { key: 'onCard', label: 'Paid by credit card (already included in the card spending I record)', type: 'checkbox', span: true, showIf: (v) => v.kind === 'expense' || v.kind === 'subscription' },
        { key: 'active', label: 'Active', type: 'checkbox', default: () => true },
      ],
      columns: [
        { label: 'Item', render: (c) => `<strong>${esc(c.name)}</strong><div class="sub"><span class="badge kind-${esc(c.kind)}">${esc(labelOf(FLOW_KINDS, c.kind))}</span>${c.onCard ? ' <span class="badge" title="Paid by credit card">💳 card</span>' : ''} ${esc(c.category || '')}</div>` },
        { label: 'Amount', num: true, primary: true, render: (c) => `${money(c.amount, c.currency)}<div class="sub">${esc(labelOf(FREQ, c.frequency))}</div>` },
        { label: 'Per month', num: true, render: (c) => money(toBase(Calc.monthlyAmount(c), c.currency)) },
        { label: 'Per year', num: true, render: (c) => money(toBase(Calc.monthlyAmount(c) * 12, c.currency)) },
        { label: 'Next', render: (c) => (c.active === false ? '<span class="badge">Paused</span>' : fmtDate(Calc.nextOccurrence(c, todayISO()))) },
      ],
    },

    spending: {
      title: 'Monthly spending',
      singular: 'spending record',
      fields: [
        { key: 'month', label: 'Month', type: 'month', required: true, default: lastMonth },
        platformField('Card / account', 'e.g. HSBC Red card, Amex'),
        { key: 'amount', label: 'Amount spent', type: 'number', required: true, help: 'e.g. the total of that month’s credit card statement. Add one record per card.' },
        currencyField,
        { key: 'note', label: 'Note', placeholder: 'optional, e.g. incl. flights' },
      ],
      validate: (v) => (/^\d{4}-\d{2}$/.test(v.month || '') ? null : 'Pick a month (YYYY-MM).'),
      columns: [],
    },

    goals: {
      title: 'Goals',
      singular: 'goal',
      intro: 'Set targets and see how long your current monthly surplus will take to get there.',
      fields: [
        { key: 'name', label: 'Goal', required: true, placeholder: 'e.g. Emergency fund' },
        { key: 'metric', label: 'Measure progress by', type: 'select', options: opt([['netWorth', 'Net worth'], ['cash', 'Cash & bank'], ['invest', 'Stocks + crypto'], ['deposits', 'Fixed deposits'], ['manual', 'Amount I enter']]) },
        { key: 'saved', label: 'Amount saved so far', type: 'number', showIf: (v) => v.metric === 'manual' },
        { key: 'target', label: 'Target amount (base currency)', type: 'number', required: true },
        { key: 'targetDate', label: 'Target date (optional)', type: 'date' },
      ],
    },
  };

  function holdingColumns(kind) {
    return [
      { label: kind === 'coin' ? 'Coin' : 'Holding', render: (h) => `<strong>${esc(kind === 'coin' ? h.symbol || h.coinId : h.symbol)}</strong><div class="sub">${platformLine(h, kind === 'coin' ? h.coinId : h.name)}</div>` },
      { label: 'Qty', num: true, render: (h) => num(h.quantity, 8) },
      { label: 'Avg cost', num: true, render: (h) => money(h.avgCost, h.currency) },
      { label: 'Price', num: true, render: (h) => { const v = Calc.holdingValue(h); return `${money(v.price, h.currency)}<div class="sub">${v.live ? '<span class="live-dot"></span>live' : h.source === 'manual' ? 'manual' : 'waiting…'}</div>`; } },
      { label: kind === 'coin' ? '24h' : 'Today', num: true, render: (h) => { const v = Calc.holdingValue(h); return v.live && h.prevClose ? `${signed(v.dayChange, h.currency)}<div class="sub">${pct(v.dayChangePct)}</div>` : '—'; } },
      { label: 'Market value', num: true, primary: true, render: (h) => money(Calc.holdingValue(h).marketValue, h.currency) },
      { label: 'Profit / loss', num: true, render: (h) => { const v = Calc.holdingValue(h); return `${signed(v.pnl, h.currency)}<div class="sub">${pct(v.pnlPct)}</div>`; } },
    ];
  }

  function depositPreview(v) {
    if (!(v.principal > 0) || !v.startDate) return '';
    const dep = { ...v, endDate: v.termMode === 'enddate' ? v.endDate : null };
    if (dep.endDate && dep.endDate <= dep.startDate) return '';
    if (!dep.endDate && !(dep.termMonths >= 1)) return '';
    const rate = v.rateMode === 'interest' ? Calc.impliedRate(v.principal, v.interestAmount || 0, v.startDate, v.termMonths, v.compounding, dep.endDate) : +v.rate || 0;
    const r = Calc.depositValue({ ...dep, rate }, todayISO());
    const cur = /^[A-Z]{3}$/.test(v.currency || '') ? v.currency : base();
    const then = { cash: ' It will then move to your cash automatically.', renew: ' It will then renew automatically.', keep: '' }[v.onMaturity] || '';
    return `<strong>${fmtDate(r.startDate)} → ${fmtDate(r.maturityDate)}</strong> (${termText(r)}).<br>
      Interest ${money(r.maturityInterest, cur)} at ${rate.toFixed(3)}% p.a. — you’ll get <strong>${money(r.maturityValue, cur)}</strong>.${then}`;
  }

  // ================================================================== views

  const VIEWS = [
    { id: 'dashboard', label: 'Dashboard', icon: '◎', group: 'Overview' },
    { id: 'platforms', label: 'Platforms', icon: '▦', group: 'Overview' },
    { id: 'accounts', label: 'Cash & Bank', icon: '¤', group: 'Assets' },
    { id: 'stocks', label: 'Stocks', icon: '↗', group: 'Assets' },
    { id: 'crypto', label: 'Crypto', icon: '₿', group: 'Assets' },
    { id: 'deposits', label: 'Fixed Deposits', icon: '%', group: 'Assets', hidden: true },
    { id: 'properties', label: 'Property', icon: '⌂', group: 'Assets' },
    { id: 'others', label: 'Other Assets', icon: '◆', group: 'Assets' },
    { id: 'liabilities', label: 'Loans & Debts', icon: '−', group: 'Owe & spend' },
    { id: 'cashflows', label: 'Cash Flow', icon: '⇄', group: 'Owe & spend' },
    { id: 'goals', label: 'Goals', icon: '★', group: 'Owe & spend' },
    { id: 'settings', label: 'Settings & Sync', icon: '⚙', group: '' },
    { id: 'account', hidden: true },
    { id: 'platform', hidden: true },
  ];
  // Detail pages highlight their parent in the navigation.
  const NAV_PARENT = { account: 'accounts', deposits: 'accounts', platform: 'platforms' };

  let currentView = 'dashboard';
  let viewParam = null;
  let historyRange = '90';
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
      return `${head}<a href="#${v.id}" class="${v.id === active ? 'active' : ''}"><span class="icon" aria-hidden="true">${v.icon}</span><span>${v.label}</span>${navCount(v.id)}</a>`;
    }).join('');
    const tab = (id, icon, label) => `<a href="#${id}" class="${active === id ? 'active' : ''}"><span class="icon" aria-hidden="true">${icon}</span><span>${label}</span></a>`;
    const inMore = !['dashboard', 'platforms', 'cashflows'].includes(active);
    $('#tabbar').innerHTML = `${tab('dashboard', '◎', 'Home')}${tab('platforms', '▦', 'Platforms')}
      <button class="tab-add" data-action="quick-add" aria-label="Add something"><span>+</span></button>
      ${tab('cashflows', '⇄', 'Cash flow')}
      <button data-action="menu" class="${inMore ? 'active' : ''}"><span class="icon" aria-hidden="true">☰</span><span>More</span></button>`;
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
    pb.innerHTML = state.settings.privacy ? '<span aria-hidden="true">◉</span><span class="hide-sm"> Show amounts</span>' : '<span aria-hidden="true">◎</span><span class="hide-sm"> Hide amounts</span>';
    pb.title = state.settings.privacy ? 'Show amounts' : 'Hide amounts';
    renderNav();
    renderStatus();
    const main = $('#main');
    if (currentView === 'dashboard') main.innerHTML = renderDashboard();
    else if (currentView === 'settings') main.innerHTML = renderSettings();
    else if (currentView === 'platforms') main.innerHTML = renderPlatforms();
    else if (currentView === 'cashflows') main.innerHTML = renderCashflows();
    else if (currentView === 'goals') main.innerHTML = renderGoals();
    else if (currentView === 'account') main.innerHTML = renderAccount(viewParam);
    else if (currentView === 'platform') main.innerHTML = renderPlatformDetail(viewParam ?? '');
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

  function tile(label, value, sub = '', extra = '') {
    return `<div class="tile ${extra}"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
  }

  function activityText(e) {
    const ref = e.ref ? ` (${esc(e.ref)})` : '';
    if (e.kind === 'deposit-cash') return `Fixed deposit at ${esc(e.platform)}${ref} matured — ${money(e.amount, e.currency)} incl. ${money(e.interest, e.currency)} interest moved to “${esc(e.accountName)}”.`;
    if (e.kind === 'deposit-renew') return `Fixed deposit at ${esc(e.platform)}${ref} matured and renewed with ${money(e.amount, e.currency)} (incl. ${money(e.interest, e.currency)} interest).`;
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

    const events = s.events.slice(0, 10).map((e) => `<li><span class="ev-date">${fmtDate(e.date)}</span><span class="ev-label"><span class="badge kind-${esc(e.kind)}">${esc(EVENT_LABELS[e.kind] || e.kind)}</span> ${esc(e.label)}</span><span class="num">${e.amount != null ? money(e.amount) : ''}</span></li>`).join('');
    const recent = state.activity.filter((e) => Calc.daysBetween(e.date, todayISO()) <= 14).slice(0, 3);
    const alerts = [...recent.map((e) => ({ level: 'good', html: activityText(e) })), ...s.alerts, ...setupAlerts()]
      .map((a) => `<li class="alert ${a.level}"><span aria-hidden="true">${a.level === 'warn' ? '⚠' : a.level === 'good' ? '✓' : 'ℹ'}</span><span>${a.html || esc(a.text)}</span></li>`).join('');

    const { platforms, regions } = Calc.platformBreakdown(state, todayISO());
    const named = platforms.filter((p) => p.name);
    const maxAbs = Math.max(1, ...named.map((p) => Math.abs(p.net)));
    const platformBars = named.slice(0, 8).map((p) => `<a class="hbar link" href="#platform/${encodeURIComponent(p.name)}"><span class="hbar-label">${esc(p.name)}<span class="sub"> ${esc(p.region)}</span></span>
      <span class="hbar-track"><span class="${p.net < 0 ? 'neg-bar' : ''}" style="width:${(Math.abs(p.net) / maxAbs) * 100}%"></span></span><span class="num">${money(p.net, base(), 0)}</span></a>`).join('');
    const regionPills = regions.filter((r) => r.region).map((r) => `<div class="pill"><span class="sub">${esc(r.region)}</span><strong>${money(r.net, base(), 0)}</strong></div>`).join('');

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
        ${s.depositDaily > 0 ? `<div class="live-interest"><div class="tile-label">Interest earned today</div><div class="tile-value pos" id="live-interest">${money(0, base(), 4)}</div><div class="tile-sub">${money(s.depositDaily)} per day from fixed deposits</div></div>` : ''}
      </section>

      ${alerts ? `<ul class="alerts">${alerts}</ul>` : ''}

      <section class="tiles">
        ${tile('Total assets', money(s.assets, base(), 0))}
        ${tile('Liabilities', `<span class="${s.liabilities ? 'neg' : ''}">${money(s.liabilities, base(), 0)}</span>`, s.assets ? `Debt-to-asset ${(s.debtToAsset * 100).toFixed(1)}%` : '')}
        ${tile('Investment P&L', signed(s.investPnl, base(), 0), s.investCost ? `${pct(s.investPnlPct)} on ${money(s.investCost, base(), 0)}` : 'No holdings yet')}
        ${tile('Net cash flow / mo', signed(s.netMonthly, base(), 0), `${money(s.flow.income, base(), 0)} in · ${money(s.spending, base(), 0)} out${s.spendingSource === 'actual' ? ' (actual)' : ''}`)}
        ${tile('Savings rate', s.flow.income ? pct(s.savingsRate, false) : '—', 'of monthly income')}
        ${tile('Passive income / mo', money(s.passiveMonthly, base(), 0), 'deposit interest + rent')}
        ${tile('Emergency runway', isFinite(s.runwayMonths) ? `${s.runwayMonths.toFixed(1)} mo` : '—', 'cash ÷ monthly spending')}
        ${tile('Subscriptions / mo', money(s.flow.subscription, base(), 0), `${money(s.flow.subscription * 12, base(), 0)} per year`)}
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
          ${platformBars || '<p class="sub">Add a platform (e.g. HSBC HK, Monzo, Futu) to your accounts and holdings to see the split.</p>'}
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

  function setupAlerts() {
    const out = [];
    if (state.stocks.some((s) => s.source !== 'manual') && !state.settings.finnhubKey) {
      out.push({ level: 'warn', html: 'Live stock prices need a free Finnhub API key — add it in <a href="#settings">Settings</a>. Until then, holdings are valued at cost.' });
    }
    const lm = lastMonth();
    if (state.spending.length && !state.spending.some((e) => e.month === lm) && new Date().getDate() >= 3) {
      out.push({ level: 'info', html: `Time to record ${fmtMonth(lm)}’s spending (e.g. your credit card statement). <a href="#" data-action="add" data-sec="spending">Record it now</a>` });
    }
    if (syncCfg.token && !sessionPass) out.push({ level: 'warn', html: 'Sync is locked on this device. <a href="#" data-action="unlock">Enter your passphrase</a> to sync.' });
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

  function sectionTiles(key, items) {
    const sec = SECTIONS[key];
    if (!sec.total) return '';
    const t = todayISO();
    let extra = '';
    if (key === 'accounts') {
      const rows = Calc.cashByCurrency({ ...state, accounts: items });
      const cur = filters.accountsCurrency;
      const r = cur && rows.find((x) => x.currency === cur);
      if (cur) {
        return `<section class="tiles">${tile(`${esc(cur)} across accounts`, money(r ? r.amount : 0, cur), r ? `${cur !== base() ? `≈ ${money(r.base, base(), 0)} · ` : ''}${plural(r.accounts.length, 'account')}` : '')}${tile(`All cash (${esc(base())})`, money(sec.total(state.accounts)))}</section>`;
      }
      const allRated = rows.every((x) => isFinite(x.base));
      const deps = state.deposits.filter((d) => items.some((a) => a.id === d.accountId));
      return `<section class="tiles">
        ${tile(`Cash (${esc(base())})`, money(sec.total(items)))}
        ${tile('Fixed deposits', money(depositsTotal(deps)), deps.length ? `${plural(deps.length, 'deposit')} · <a href="#deposits">see all</a>` : 'add one from an account')}
        ${tile('Currencies', String(rows.length), rows[0] && allRated ? `Largest: ${esc(rows[0].currency)} (${pct(rows[0].share, false)})` : rows.length ? 'waiting for exchange rates' : '')}
      </section>`;
    } else if (key === 'stocks' || key === 'crypto') {
      let mv = 0, cost = 0, day = 0;
      for (const h of items) {
        const v = Calc.holdingValue(h);
        mv += toBase(v.marketValue, h.currency) || 0;
        cost += toBase(v.cost, h.currency) || 0;
        day += toBase(v.dayChange, h.currency) || 0;
      }
      extra = tile('Profit / loss', signed(mv - cost), cost ? `${pct((mv - cost) / cost)} on ${money(cost, base(), 0)}` : '') + tile(key === 'crypto' ? 'Last 24h' : 'Today', signed(day));
    } else if (key === 'deposits') {
      let interest = 0, daily = 0;
      for (const d of items) {
        const v = Calc.depositValue(d, t);
        interest += toBase(v.interest, d.currency) || 0;
        daily += toBase(v.dailyInterest, d.currency) || 0;
      }
      const next = items.map((d) => Calc.depositValue(d, t)).filter((v) => !v.matured).sort((a, b) => (a.maturityDate < b.maturityDate ? -1 : 1))[0];
      extra = tile('Interest so far', `<span class="pos">${money(interest)}</span>`, `${money(daily)} per day`) + tile('Next maturity', next ? fmtDate(next.maturityDate) : '—', next ? `in ${plural(next.daysLeft, 'day')}` : '');
    } else if (key === 'liabilities') {
      extra = tile('Repayments / mo', money(items.reduce((s, l) => s + (Calc.loanBalance(l, t).balance > 0 ? toBase(l.payment, l.currency) || 0 : 0), 0)));
    } else if (key === 'properties') {
      extra = tile('Rent / mo', money(items.reduce((s, p) => s + (toBase(p.monthlyRent, p.currency) || 0), 0)));
    }
    return `<section class="tiles">${tile(`Total (${esc(base())})`, `<span class="${sec.negative ? 'neg' : ''}">${money(sec.total(items))}</span>`)}${extra}</section>`;
  }

  function renderSection(key, opts = {}) {
    const sec = SECTIONS[key];
    const all = state[key];
    const platformNames = [...new Set(all.map((x) => x.platform || ''))].sort();
    const filter = filters[key] ?? null;
    let items = filter == null ? all : all.filter((x) => (x.platform || '') === filter);
    const showFilter = PLATFORM_SECTIONS.includes(key) && platformNames.length > 1;
    const curFilter = key === 'accounts' ? filters.accountsCurrency ?? null : null;
    const currencies = key === 'accounts' ? [...new Set(all.flatMap((a) => Calc.accountBalances(a).map((b) => b.currency)))].sort() : [];
    if (curFilter) items = items.filter((a) => Calc.accountBalances(a).some((b) => b.currency === curFilter));

    return `${key === 'deposits' ? '<a class="back" href="#accounts">‹ Cash &amp; Bank</a>' : ''}
      <div class="page-head">
        <div><h1>${sec.title}</h1><p class="sub intro">${sec.intro}</p></div>
        <div class="row-actions">
          ${showFilter ? `<select class="filter" data-filter="${key}" aria-label="Filter by platform"><option value="__all">All platforms</option>${platformNames.map((p) => `<option value="${esc(p)}" ${filter === p ? 'selected' : ''}>${esc(p || 'No platform')}</option>`).join('')}</select>` : ''}
          ${currencies.length > 1 ? `<select class="filter" data-filter="accountsCurrency" aria-label="Filter by currency"><option value="__all">All currencies</option>${currencies.map((c) => `<option value="${esc(c)}" ${curFilter === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
          ${key === 'stocks' || key === 'crypto' ? '<button class="btn" data-action="refresh">↻ Prices</button>' : ''}
          <button class="btn primary" data-action="add" data-sec="${key}">+ Add</button>
        </div>
      </div>
      ${opts.tiles ?? sectionTiles(key, items)}
      ${key === 'accounts' ? renderCashByCurrency(filter == null ? all : all.filter((x) => (x.platform || '') === filter)) : ''}
      ${items.length ? renderItemsTable(key, items)
        : `<div class="card empty">No ${sec.singular}s${filter != null || curFilter ? ' match this filter' : ' yet'}. <button class="btn primary" data-action="add" data-sec="${key}">+ Add ${sec.singular}</button></div>`}
      ${key === 'deposits' ? renderDepositHistory() : ''}
      ${opts.after || ''}`;
  }

  // The list of items for a section, as a table on wide screens and tappable cards on phones.
  function renderItemsTable(key, items) {
    const sec = SECTIONS[key];
    const rows = items
      .map((item) => `<tr class="clickable" data-action="${sec.rowAction || 'edit'}" data-sec="${key}" data-id="${esc(item.id)}" tabindex="0">
        ${sec.columns.map((c) => `<td class="${c.num ? 'num' : ''} ${c.primary ? 'primary' : ''} ${c.wide ? 'wide' : ''}" data-label="${esc(c.label)}">${c.render(item)}</td>`).join('')}
        <td class="actions">${(sec.actions || []).map((a) => `<button class="btn small" data-action="${a.id}" data-sec="${key}" data-id="${esc(item.id)}">${a.label}</button>`).join('')}<span class="chev" aria-hidden="true">›</span></td></tr>`)
      .join('');
    return `<div class="card table-card"><table class="data"><thead><tr>${sec.columns.map((c) => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('')}<th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ---------------------------------------------------------------- one bank account

  function renderAccount(id) {
    const a = state.accounts.find((x) => x.id === id);
    if (!a) return '<a class="back" href="#accounts">‹ Cash &amp; Bank</a><div class="card empty">This account no longer exists.</div>';
    const t = todayISO();
    const deps = accountDeposits(a);
    const bals = Calc.accountBalances(a);
    const cash = accountTotal(a);
    const fd = depositsTotal(deps);
    let interest = 0, daily = 0;
    for (const d of deps) {
      const v = Calc.depositValue(d, t);
      interest += toBase(v.interest, d.currency) || 0;
      daily += toBase(v.dailyInterest, d.currency) || 0;
    }
    const balRows = bals.map((b) => `<li class="clickable" data-action="edit" data-sec="accounts" data-id="${esc(a.id)}" tabindex="0">
        <span class="cur-tag">${esc(b.currency)}</span><strong class="grow">${money(b.amount, b.currency)}</strong>
        <span class="sub">${b.currency !== base() ? `≈ ${money(toBase(b.amount, b.currency), base(), 0)}` : ''}</span></li>`).join('');
    const history = state.activity.filter((e) => e.kind && e.kind.startsWith('deposit-') && (e.accountId === a.id || e.heldIn === a.id)).slice(0, 10);
    const meta = [a.platform ? `<a href="#platform/${encodeURIComponent(a.platform)}">${esc(a.platform)}</a>` : '', esc(labelOf(ACCOUNT_TYPES, a.type)), esc(a.note || '')].filter(Boolean).join(' · ');
    return `<a class="back" href="#accounts">‹ Cash &amp; Bank</a>
      <div class="page-head">
        <div><h1>${esc(a.name)}</h1><p class="sub">${meta}</p></div>
        <div class="row-actions"><button class="btn" data-action="edit" data-sec="accounts" data-id="${esc(a.id)}">Edit account</button></div>
      </div>
      <section class="tiles">
        ${tile(`Total (${esc(base())})`, money(cash + fd))}
        ${tile('Cash', money(cash), bals.length ? currenciesWord(bals.length) : 'no balances yet')}
        ${tile('Fixed deposits', money(fd), deps.length ? `${plural(deps.length, 'deposit')} · +${money(daily)}/day` : 'none yet')}
        ${deps.length ? tile('Interest so far', `<span class="pos">${money(interest)}</span>`) : ''}
      </section>
      <div class="section-head"><h2>Cash</h2><button class="btn small" data-action="edit" data-sec="accounts" data-id="${esc(a.id)}">Update balances</button></div>
      <div class="card">
        ${bals.length ? `<ul class="acct-bals">${balRows}</ul>` : '<p class="sub">No cash in this account yet. Tap “Update balances” to add one line per currency.</p>'}
        <p class="sub">Balances updated ${ago(a.updatedAt)}</p>
      </div>
      <div class="section-head"><h2>Fixed deposits</h2><button class="btn small primary" data-action="add" data-sec="deposits" data-account="${esc(a.id)}">+ Add fixed deposit</button></div>
      ${deps.length ? renderItemsTable('deposits', deps) : '<div class="card"><p class="sub">No fixed deposits in this account.</p></div>'}
      ${history.length ? `<div class="section-head"><h2>Matured deposits</h2></div><div class="card"><ul class="events">${history.map((e) => `<li><span class="ev-date">${fmtDate(e.date)}</span><span class="ev-label">${activityText(e)}</span><span></span></li>`).join('')}</ul></div>` : ''}`;
  }

  // Each currency's total across accounts, as a stacked bar split by account plus a legend list.
  function renderCashByCurrency(accounts) {
    const rows = Calc.cashByCurrency({ ...state, accounts });
    if (!rows.length) return '';
    const cur = filters.accountsCurrency;
    const blocks = rows.map((r) => {
      const segs = r.accounts.map((a, i) => ({ ...a, color: i < 6 ? `var(--series-${i + 1})` : 'var(--muted)' }));
      const bar = segs.map((g) => `<span style="flex-grow:${Math.max(g.amount, 0)};background:${g.color}" data-tip="${esc(g.name)}: ${esc(money(g.amount, r.currency))}"></span>`).join('');
      const list = segs.map((g) => `<li><span class="swatch" style="background:${g.color}"></span><span class="grow">${esc(g.name)}${g.platform ? ` <span class="sub">· ${esc(g.platform)}</span>` : ''}</span><span class="num">${money(g.amount, r.currency)}</span></li>`).join('');
      const share = isFinite(r.base) ? `${(r.share * 100).toFixed(1)}% of cash` : 'no exchange rate yet';
      return `<div class="cur-block ${cur === r.currency ? 'on' : ''}">
        <button class="cur-head" data-action="cur-filter" data-cur="${esc(r.currency)}" aria-pressed="${cur === r.currency}">
          <span class="cur-tag">${esc(r.currency)}</span><strong class="grow">${money(r.amount, r.currency)}</strong>
          <span class="sub">${r.currency !== base() && isFinite(r.base) ? `≈ ${money(r.base, base(), 0)} · ` : ''}${share}</span>
        </button>
        <div class="stack" aria-hidden="true">${bar}</div>
        <ul class="cur-accounts">${list}</ul>
      </div>`;
    }).join('');
    return `<div class="card">
      <div class="card-head"><h2>Cash by currency</h2>${cur ? '<button class="btn small" data-action="cur-filter" data-cur="">Show all currencies</button>' : ''}</div>
      <p class="sub">Each currency’s total across all your accounts. Tap a currency to list only the accounts holding it.</p>
      ${blocks}
    </div>`;
  }

  function renderDepositHistory() {
    const done = state.activity.filter((e) => e.kind && e.kind.startsWith('deposit-')).slice(0, 10);
    if (!done.length) return '';
    return `<div class="card"><h2>Matured deposits</h2><ul class="events">${done.map((e) => `<li><span class="ev-date">${fmtDate(e.date)}</span><span class="ev-label">${activityText(e)}</span><span></span></li>`).join('')}</ul></div>`;
  }

  // ---------------------------------------------------------------- platforms

  function renderPlatforms() {
    const { platforms, regions } = Calc.platformBreakdown(state, todayISO());
    const net = summary.netWorth || 0;
    const regionTiles = regions.map((r) => tile(esc(r.region || 'No region'), money(r.net), `${plural(r.platforms, 'platform')}${net > 0 ? ` · ${((r.net / net) * 100).toFixed(1)}% of net worth` : ''}`)).join('');
    const cell = (v, cls = '') => (Math.abs(v) < 0.005 ? '<span class="sub">—</span>' : `<span class="${cls}">${money(v, base(), 0)}</span>`);
    const td = (label, v, cls = '') => `<td class="num ${Math.abs(v) < 0.005 ? 'empty-cell' : ''}" data-label="${label}">${cell(v, cls)}</td>`;
    const rows = platforms.map((p) => `<tr class="clickable" data-action="open-platform" data-name="${esc(p.name)}" tabindex="0">
        <td data-label="Platform"><strong>${esc(p.name || 'No platform set')}</strong><div class="sub">${p.region ? `${esc(p.region)}${p.regionGuessed ? ' <span class="badge" title="Guessed from currency — tap to set">guess</span>' : ''}` : (p.name ? 'Tap to set a region' : 'Edit items to add a platform')} · ${plural(p.count, 'item')} · ${esc(p.currencies.join(', '))}</div></td>
        ${td('Cash', p.cash)}${td('Investments', p.invest)}${td('Deposits', p.deposits)}${td('Property &amp; other', p.property + p.other)}${td('Debts', -p.debt, 'neg')}
        <td class="num primary" data-label="Net">${money(p.net, base(), 0)}<div class="sub">${net > 0 ? `${((p.net / net) * 100).toFixed(1)}%` : ''}</div></td>
        <td class="actions"><span class="chev" aria-hidden="true">›</span></td></tr>`).join('');
    return `<div class="page-head"><div><h1>Platforms</h1><p class="sub intro">Everything grouped by where it’s held — banks, brokers, exchanges, lenders. Tap a platform to see everything on it, edit items, or set its region (e.g. Hong Kong, United Kingdom).</p></div></div>
      ${regionTiles ? `<section class="tiles">${regionTiles}</section>` : ''}
      ${platforms.length ? `<div class="card table-card"><table class="data"><thead><tr><th>Platform</th><th class="num">Cash</th><th class="num">Investments</th><th class="num">Deposits</th><th class="num">Property & other</th><th class="num">Debts</th><th class="num">Net</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<div class="card empty">Nothing here yet. Add accounts, holdings or deposits with a platform name.</div>'}`;
  }

  // ---------------------------------------------------------------- one platform

  const PLATFORM_GROUP_TITLES = [['accounts', 'Bank accounts'], ['deposits', 'Fixed deposits'], ['stocks', 'Stocks & ETFs'], ['crypto', 'Crypto'], ['properties', 'Property'], ['others', 'Other assets'], ['liabilities', 'Loans & debts']];

  function renderPlatformDetail(name) {
    const p = Calc.platformBreakdown(state, todayISO()).platforms.find((x) => x.name === name);
    const back = '<a class="back" href="#platforms">‹ Platforms</a>';
    const title = esc(name || 'No platform set');
    if (!p) {
      return `${back}<div class="page-head"><div><h1>${title}</h1></div></div>
        <div class="card empty">Nothing on this platform any more.</div>`;
    }
    const net = summary.netWorth || 0;
    const tiles = [
      tile('Net', money(p.net), net > 0 ? `${((p.net / net) * 100).toFixed(1)}% of net worth` : ''),
      p.cash ? tile('Cash', money(p.cash)) : '',
      p.deposits ? tile('Fixed deposits', money(p.deposits)) : '',
      p.invest ? tile('Investments', money(p.invest)) : '',
      p.property + p.other ? tile('Property & other', money(p.property + p.other)) : '',
      p.debt ? tile('Debts', `<span class="neg">${money(p.debt)}</span>`) : '',
    ].join('');
    const groups = PLATFORM_GROUP_TITLES.map(([k, label]) => {
      const items = state[k].filter((x) => (x.platform || '') === name);
      if (!items.length) return '';
      return `<div class="section-head"><h2>${label}</h2><button class="btn small" data-action="add" data-sec="${k}" data-platform="${esc(name)}">+ Add</button></div>${renderItemsTable(k, items)}`;
    }).join('');
    const addMore = PLATFORM_GROUP_TITLES.filter(([k]) => !state[k].some((x) => (x.platform || '') === name))
      .map(([k, label]) => `<button class="btn small" data-action="add" data-sec="${k}" data-platform="${esc(name)}">+ ${label}</button>`).join('');
    const meta = [p.region ? `${esc(p.region)}${p.regionGuessed ? ' <span class="badge" title="Guessed from currency">guess</span>' : ''}` : '', esc(p.currencies.join(', '))].filter(Boolean).join(' · ');
    return `${back}
      <div class="page-head">
        <div><h1>${title}</h1><p class="sub">${meta}</p></div>
        ${name ? `<div class="row-actions"><button class="btn" data-action="edit-platform" data-name="${esc(name)}">Edit name &amp; region</button></div>` : ''}
      </div>
      <section class="tiles">${tiles}</section>
      ${groups}
      ${name && addMore ? `<div class="card"><p class="sub">Add something else held at ${title}:</p><div class="row-actions wrap">${addMore}</div></div>` : ''}`;
  }

  function editPlatform(name) {
    const meta = state.platformMeta[name] || {};
    const guess = Calc.platformBreakdown(state, todayISO()).platforms.find((p) => p.name === name);
    openForm({
      title: `Platform — ${name}`,
      fields: [
        { key: 'name', label: 'Name', required: true, list: 'platform-list', help: 'Renaming updates every item on this platform.' },
        { key: 'region', label: 'Region / country', list: 'region-list', placeholder: 'e.g. Hong Kong', help: 'Used for the “by region” totals.' },
      ],
      values: { name, region: meta.region || (guess && guess.region) || '' },
      onSave: (v) => {
        const now = Date.now();
        if (v.name !== name) {
          for (const s of PLATFORM_SECTIONS) for (const item of state[s]) if (item.platform === name) { item.platform = v.name; item._mt = now; }
          delete state.platformMeta[name];
        }
        state.platformMeta[v.name] = { region: v.region, _mt: now };
        if (currentView === 'platform' && viewParam === name) {
          viewParam = v.name;
          history.replaceState(null, '', `#platform/${encodeURIComponent(v.name)}`);
        }
        commit();
        toast('Platform updated');
      },
    });
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
        ${tile('Income / mo', `<span class="pos">${money(s.flow.income)}</span>`)}
        ${tile('Spending / mo', money(s.spending), s.spendingSource === 'actual' ? `actual · avg of last ${plural(s.spendAvgMonths, 'month')}` : 'estimated from your bills below')}
        ${tile('Left over / mo', signed(s.netMonthly), s.flow.income ? `Savings rate ${pct(s.savingsRate, false)}` : '')}
        ${tile('Fixed bills / mo', money(s.estimatedSpending), s.spendingSource === 'actual' ? `${money(s.notOnCard, base(), 0)} not paid by card` : '')}
        ${tile('Subscriptions / mo', money(s.flow.subscription), `${money(s.flow.subscription * 12, base(), 0)} per year`)}
        ${tile('Planned saving / mo', money(s.flow.saving))}
      </section>`;
    const after = renderSpendingCard() + (cats.length ? `<div class="card"><h2>Fixed bills by category</h2>${catBars}</div>` : '');
    return renderSection('cashflows', { tiles, after });
  }

  function renderSpendingCard() {
    const s = summary;
    const months = s.spendMonths.slice(0, 12);
    const max = Math.max(1, ...months.map((m) => m.total));
    const rows = months.map((m) => {
      const entries = state.spending.filter((e) => e.month === m.month);
      return `<div class="spend-month">
        <div class="hbar"><span class="hbar-label"><strong>${fmtMonth(m.month)}</strong></span><span class="hbar-track"><span style="width:${(m.total / max) * 100}%"></span></span><span class="num"><strong>${money(m.total, base(), 0)}</strong></span></div>
        <ul class="spend-entries">${entries.map((e) => `<li class="clickable" data-action="edit" data-sec="spending" data-id="${esc(e.id)}" tabindex="0"><span>${esc(e.platform || 'Spending')}${e.note ? ` <span class="sub">· ${esc(e.note)}</span>` : ''}</span><span class="num">${money(e.amount, e.currency)}</span></li>`).join('')}</ul>
      </div>`;
    }).join('');
    const avgNote = s.spendingSource === 'actual'
      ? `Average of the last ${plural(s.spendAvgMonths, 'month')}: <strong>${money(s.cardSpendAvg, base(), 0)}</strong>. Your cash flow uses this plus ${money(s.notOnCard, base(), 0)}/mo of fixed bills not paid by card — tick “Paid by credit card” on bills that are already in your statement so they aren’t counted twice.`
      : 'Record what you actually spend each month — e.g. each credit card statement total — and your cash flow, savings rate and runway will use real numbers instead of estimates.';
    return `<div class="card" id="spending">
      <div class="card-head"><h2>💳 Actual monthly spending</h2><button class="btn small primary" data-action="add" data-sec="spending">+ Record</button></div>
      <p class="sub">${avgNote}</p>
      ${rows}
    </div>`;
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
        <label>Base currency<input name="baseCurrency" list="currency-list" value="${esc(st.baseCurrency)}" required maxlength="3" pattern="[A-Za-z]{3}" autocapitalize="characters">
          <small>All totals are converted into this currency with live exchange rates.</small></label>
        <label>Price refresh (seconds)<input name="refreshSec" type="number" inputmode="numeric" min="15" step="5" value="${esc(st.refreshSec)}">
          <small>Free Finnhub keys allow 60 requests a minute.</small></label>
        <label class="span-2">Finnhub API key (live stock prices)<input name="finnhubKey" value="${esc(st.finnhubKey)}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste key here">
          <small>Free key at <a href="https://finnhub.io/register" target="_blank" rel="noopener">finnhub.io/register</a>. Crypto prices and exchange rates don’t need one. Synced to your other devices.</small></label>
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

  // ================================================================== forms

  const dialog = () => $('#dialog');

  function openForm({ title, fields, values = {}, isNew, onSave, onDelete, preview, validate, submitLabel = 'Save', intro = '' }) {
    const d = dialog();
    const vals = { ...values };
    const optionsOf = (f) => (typeof f.options === 'function' ? f.options(vals) : f.options);
    for (const f of fields) if (vals[f.key] === undefined && f.default) vals[f.key] = f.default();
    for (const f of fields) if (vals[f.key] === undefined && f.type === 'select') vals[f.key] = optionsOf(f)[0].value;

    const fieldHtml = (f) => {
      if (f.onlyNew && !isNew) return '';
      const v = vals[f.key];
      const cls = f.span ? 'span-2' : '';
      if (f.type === 'checkbox') return `<label class="check ${cls}" data-field="${f.key}"><input type="checkbox" name="${f.key}" ${v ? 'checked' : ''}> ${f.label}</label>`;
      if (f.type === 'balances') {
        const rows = (v && v.length ? v : [{ currency: base(), amount: null }]).map(balanceRow).join('');
        return `<div class="balances-field ${cls}" data-field="${f.key}"><span class="field-label">${f.label}${f.required ? ' <span class="req">*</span>' : ''}</span>
          <div class="bal-rows">${rows}</div>
          <button type="button" class="btn small" data-add-balance>+ Add currency</button>${f.help ? `<small>${f.help}</small>` : ''}</div>`;
      }
      let input;
      if (f.type === 'select') input = `<select name="${f.key}">${optionsOf(f).map((o) => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      else {
        const type = ['number', 'date', 'month', 'password'].includes(f.type) ? f.type : 'text';
        const attrs = [
          type === 'number' ? `step="${f.step || 'any'}" inputmode="decimal"` : '',
          f.type === 'currency' ? 'list="currency-list" maxlength="3" autocapitalize="characters"' : f.list ? `list="${f.list}"` : '',
          f.upper ? 'autocapitalize="characters"' : '',
          f.lower || f.type === 'password' ? 'autocapitalize="off" spellcheck="false"' : '',
          f.autocomplete ? `autocomplete="${f.autocomplete}"` : '',
        ].join(' ');
        input = `<input name="${f.key}" type="${type}" ${attrs} value="${esc(v ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.type === 'currency' ? 'style="text-transform:uppercase"' : ''}>`;
      }
      return `<label class="${cls}" data-field="${f.key}"><span>${f.label}${f.required ? ' <span class="req">*</span>' : ''}</span>${input}${f.help ? `<small>${f.help}</small>` : ''}</label>`;
    };

    d.innerHTML = `<form method="dialog" class="modal" novalidate>
      <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header>
      <div class="modal-body">
        ${intro ? `<p class="sub">${intro}</p>` : ''}
        <div class="form-grid">${fields.map(fieldHtml).join('')}</div>
        ${preview ? '<div class="form-preview" aria-live="polite"></div>' : ''}
        <div class="form-extra"></div>
        <p class="form-error" role="alert"></p>
      </div>
      <footer>${onDelete ? '<button type="button" class="btn ghost danger" data-delete>Delete</button>' : ''}<span class="grow"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${esc(submitLabel)}</button></footer>
    </form>`;
    const form = $('form', d);
    const read = () => {
      const out = {};
      for (const f of fields) {
        if (f.type === 'balances') {
          out[f.key] = [...form.querySelectorAll(`[data-field="${f.key}"] .bal-row`)]
            .map((r) => {
              const amt = $('.bal-amt', r).value;
              return { currency: $('.bal-cur', r).value.trim().toUpperCase(), amount: amt === '' ? null : +amt };
            })
            .filter((b) => b.currency || b.amount != null);
          continue;
        }
        const el = form.elements[f.key];
        if (!el) continue;
        if (f.type === 'checkbox') out[f.key] = el.checked;
        else if (f.type === 'number') out[f.key] = el.value === '' ? null : +el.value;
        else if (f.type === 'password') out[f.key] = el.value;
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
    const refresh = () => {
      const v = read();
      for (const f of fields) {
        const el = form.querySelector(`[data-field="${f.key}"]`);
        if (el) el.hidden = !visible(f, v);
        // Dynamic option lists (e.g. "Auto — HSBC cash account") follow other fields.
        if (typeof f.options === 'function' && form.elements[f.key]) {
          const sel = form.elements[f.key];
          const cur = sel.value;
          sel.innerHTML = f.options(v).map((o) => `<option value="${esc(o.value)}" ${o.value === cur ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
        }
      }
      if (preview) $('.form-preview', form).innerHTML = preview(v) || '';
    };
    form.addEventListener('change', refresh);
    form.addEventListener('input', () => { if (preview) $('.form-preview', form).innerHTML = preview(read()) || ''; });
    refresh();
    form.addEventListener('click', (e) => {
      if (e.target.closest('[data-add-balance]')) {
        const box = e.target.closest('.balances-field');
        const used = new Set([...box.querySelectorAll('.bal-cur')].map((i) => i.value.trim().toUpperCase()));
        const next = [base(), 'HKD', 'GBP', 'USD', 'EUR', 'CNY', 'SGD'].find((c) => !used.has(c)) || '';
        $('.bal-rows', box).insertAdjacentHTML('beforeend', balanceRow({ currency: next, amount: null }));
        $('.bal-row:last-child .bal-amt', box).focus();
      }
      const rm = e.target.closest('[data-remove-balance]');
      if (rm) {
        const box = rm.closest('.balances-field');
        rm.closest('.bal-row').remove();
        if (!box.querySelector('.bal-row')) $('.bal-rows', box).innerHTML = balanceRow({ currency: base(), amount: null });
      }
      if (e.target.closest('[data-close]')) d.close();
      if (e.target.closest('[data-delete]') && onDelete() !== false) d.close();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = read();
      for (const f of fields) {
        if (!visible(f, v) || (f.onlyNew && !isNew)) { if (f.showIf) delete v[f.key]; continue; }
        if (f.type === 'balances') {
          const err = balancesError(v[f.key], f.required);
          if (err) return showError(form, err);
          continue;
        }
        const empty = v[f.key] == null || v[f.key] === '';
        if (f.required && empty) return showError(form, `${f.label} is required.`);
        if (f.type === 'number' && !empty && !isFinite(v[f.key])) return showError(form, `${f.label} must be a number.`);
        if (f.type === 'currency' && !/^[A-Z]{3}$/.test(v[f.key])) return showError(form, 'Currency must be a 3-letter code like HKD, GBP or USD.');
      }
      const invalid = validate && validate(v);
      if (invalid) return showError(form, invalid);
      const err = onSave(v);
      if (err) return showError(form, err);
      d.close();
    });
    d.showModal();
    if (window.matchMedia('(min-width: 761px)').matches) {
      const firstInput = form.querySelector('input:not([type=checkbox]), select');
      if (firstInput) firstInput.focus();
    }
    return form;
  }

  function balanceRow(b) {
    return `<div class="bal-row">
      <input class="bal-cur" list="currency-list" maxlength="3" autocapitalize="characters" aria-label="Currency" placeholder="HKD" value="${esc(b.currency || '')}">
      <input class="bal-amt" type="number" step="any" inputmode="decimal" aria-label="Amount" placeholder="0.00" value="${esc(b.amount ?? '')}">
      <button type="button" class="icon-btn" data-remove-balance aria-label="Remove this currency">✕</button>
    </div>`;
  }

  function balancesError(list, required) {
    if (required && !list.length) return 'Add at least one currency balance.';
    const seen = new Set();
    for (const b of list) {
      if (!/^[A-Z]{3}$/.test(b.currency)) return `“${b.currency || '?'}” isn’t a currency code — use 3 letters like HKD, GBP or USD.`;
      if (b.amount == null || !isFinite(b.amount)) return `Enter an amount for ${b.currency} (0 is fine).`;
      if (seen.has(b.currency)) return `${b.currency} is listed twice — combine them into one line.`;
      seen.add(b.currency);
    }
    return null;
  }

  function showError(form, msg) {
    $('.form-error', form).textContent = msg;
  }

  // A sheet of choices (used for quick-add, the "More" menu and sync decisions).
  function openSheet(title, html, onClick) {
    const d = dialog();
    d.innerHTML = `<div class="modal"><header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header><div class="modal-body">${html}</div></div>`;
    d.firstChild.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return d.close();
      if (onClick) onClick(e);
    });
    d.showModal();
  }

  function editItem(sec, id, preset = {}) {
    const def = SECTIONS[sec];
    const prev = id ? state[sec].find((x) => x.id === id) : null;
    if (id && !prev) return;
    preset = { ...(filters[sec] ? { platform: filters[sec] } : {}), ...preset };
    if (sec === 'deposits' && !prev) {
      // Adding from an account or platform page: hold the deposit in that account.
      const acct = state.accounts.find((a) => a.id === preset.accountId) || (preset.platform != null ? state.accounts.find((a) => a.platform === preset.platform) : null);
      if (acct) {
        preset.accountId = acct.id;
        preset.currency = preset.currency || (Calc.accountBalances(acct)[0] || {}).currency;
      } else if (preset.platform) {
        preset.accountId = '__new';
        preset.newAccountPlatform = preset.platform;
      } else if (!state.accounts.length) preset.accountId = '__new';
      delete preset.platform;
    }
    openForm({
      title: `${prev ? 'Edit' : 'Add'} ${def.singular}`,
      fields: def.fields,
      values: prev ? (def.editValues ? def.editValues(prev) : { ...prev }) : preset,
      isNew: !prev,
      preview: def.preview,
      validate: def.validate,
      onDelete: prev ? () => {
        const deps = sec === 'accounts' ? accountDeposits(prev) : [];
        const extra = deps.length ? ` and its ${plural(deps.length, 'fixed deposit')}` : '';
        if (!confirm(`Delete “${prev.name || prev.symbol || prev.coinId || prev.platform}”${extra}?`)) return false;
        for (const d of deps) {
          state.deposits = state.deposits.filter((x) => x.id !== d.id);
          state.deleted[d.id] = Date.now();
        }
        removeItem(sec, prev.id);
        if (sec === 'accounts' && currentView === 'account') location.hash = '#accounts';
        return true;
      } : null,
      onSave: (v) => {
        const item = { ...(prev || {}), ...v, id: prev ? prev.id : uid() };
        if (def.beforeSave) def.beforeSave(item, prev);
        for (const f of def.fields) if (f.transient) delete item[f.key];
        item._mt = Date.now();
        if (prev) state[sec] = state[sec].map((x) => (x.id === id ? item : x));
        else state[sec].push(item);
        commit();
        toast(`${def.singular[0].toUpperCase() + def.singular.slice(1)} saved`);
        if ((sec === 'stocks' || sec === 'crypto') && item.source !== 'manual') refreshPrices();
      },
    });
  }

  function removeItem(sec, id) {
    state[sec] = state[sec].filter((x) => x.id !== id);
    state.deleted[id] = Date.now();
    commit();
  }

  function updateValuation(id) {
    const p = state.properties.find((x) => x.id === id);
    if (!p) return;
    const vals = [...(p.valuations || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
    const form = openForm({
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
        p._mt = Date.now();
        commit();
        toast('Valuation recorded');
      },
    });
    if (vals.length) {
      const hist = $('.form-extra', form);
      hist.innerHTML = `<div class="val-history"><h3>History</h3><ul>${vals.map((x) => `<li><span>${fmtDate(x.date)}</span><span class="num">${money(x.value, p.currency, 0)}</span><button type="button" class="btn small ghost danger" data-del-val="${esc(x.date)}">Remove</button></li>`).join('')}</ul></div>`;
      hist.addEventListener('click', (e) => {
        const b = e.target.closest('[data-del-val]');
        if (!b) return;
        p.valuations = p.valuations.filter((x) => x.date !== b.dataset.delVal);
        p._mt = Date.now();
        commit();
        b.closest('li').remove();
      });
    }
  }

  function quickAdd() {
    const items = [['accounts', '¤', 'Bank / cash account'], ['stocks', '↗', 'Stock or ETF'], ['crypto', '₿', 'Crypto'], ['deposits', '%', 'Fixed deposit'], ['properties', '⌂', 'Property'], ['others', '◆', 'Other asset'], ['liabilities', '−', 'Loan or debt'], ['cashflows', '⇄', 'Income, bill or subscription'], ['spending', '💳', 'Monthly spending (card bill)'], ['goals', '★', 'Goal']];
    openSheet('Add…', `<div class="choice-grid">${items.map(([k, icon, label]) => `<button class="choice" data-sheet-add="${k}"><span class="icon" aria-hidden="true">${icon}</span>${label}</button>`).join('')}</div>`, (e) => {
      const b = e.target.closest('[data-sheet-add]');
      if (!b) return;
      const sec = b.dataset.sheetAdd;
      const view = sec === 'spending' ? 'cashflows' : sec;
      dialog().close();
      if (currentView !== view) {
        // Show the list we're adding to, then open the form on top of it.
        history.replaceState(null, '', `#${view}`);
        currentView = view;
        render();
      }
      editItem(sec);
    });
  }

  function openMenu() {
    openSheet('Menu', `<nav class="menu-list">${VIEWS.filter((v) => !v.hidden).map((v) => `<a href="#${v.id}" class="${v.id === (NAV_PARENT[currentView] || currentView) ? 'active' : ''}"><span class="icon" aria-hidden="true">${v.icon}</span>${v.label}${navCount(v.id)}</a>`).join('')}</nav>`, (e) => {
      if (e.target.closest('a')) dialog().close();
    });
  }

  function commit() {
    Calc.linkDeposits(state);
    const settled = Calc.settleDeposits(state, todayISO(), Date.now());
    recordSnapshot();
    save();
    fillDatalists();
    render();
    for (const e of settled) toast(e.kind === 'deposit-cash' ? `Fixed deposit at ${e.platform} matured — moved to ${e.accountName}` : `Fixed deposit at ${e.platform} renewed`);
    queueSync();
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
      // Deposits paying into an account in another currency wait for FX rates to settle.
      const settled = Calc.settleDeposits(state, todayISO(), Date.now());
      recordSnapshot();
      save();
      if (settled.length) queueSync();
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
    state.history = Calc.upsertHistory(state.history, { date: todayISO(), netWorth: round2(s.netWorth), assets: round2(s.assets), liabilities: round2(s.liabilities), currency: base(), t: Date.now() }, HISTORY_MAX);
  }

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

  // ================================================================== sync

  let syncing = false;
  let syncAgain = false;
  let syncTimer = null;

  function queueSync(delay = 1500) {
    if (!syncCfg.token || !sessionPass) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow(), delay);
  }

  function hasData() {
    return LIST_SECTIONS.some((k) => state[k].length);
  }

  function askFirstSync() {
    return new Promise((resolve) => {
      openSheet('Synced data found', `<p>Your GitHub already has MoneyMonkey data, and this device has data too. What should happen?</p>
        <div class="choice-list">
          <button class="choice" data-choice="replace"><strong>Use the synced data</strong><span class="sub">Replace what’s on this device. Best for a new phone or laptop.</span></button>
          <button class="choice" data-choice="merge"><strong>Combine both</strong><span class="sub">Keep items from both. Pick this if you’ve entered different things on each device.</span></button>
        </div>`, (e) => {
        const b = e.target.closest('[data-choice]');
        if (!b) return;
        resolve(b.dataset.choice);
        dialog().close();
      });
      dialog().addEventListener('close', () => resolve('cancel'), { once: true });
    });
  }

  async function syncNow({ firstConnect = false, manual = false } = {}) {
    if (!syncCfg.token || !sessionPass) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    renderSyncStatus();
    try {
      const token = syncCfg.token;
      let gist = null;
      if (syncCfg.gistId) {
        try { gist = await Sync.getGist(token, syncCfg.gistId); } catch (e) { if (e.status !== 404) throw e; }
      }
      if (!gist) gist = await Sync.findGist(token);

      const t = todayISO();
      const local = Sync.toSyncable(state, t);
      let remote = null;
      let salt;
      if (gist) {
        const env = await Sync.readEnvelope(gist);
        if (env) { remote = await Sync.decrypt(env, sessionPass); salt = env.kdf.salt; }
      }

      let merged = local;
      if (remote) {
        let choice = 'merge';
        if (firstConnect) choice = hasData() ? await askFirstSync() : 'replace';
        if (choice === 'cancel') { syncCfg.lastError = 'First sync cancelled — tap Sync now to choose again.'; return; }
        merged = choice === 'replace' ? remote : Sync.mergeSyncable(local, remote);
      }

      const oldBase = base();
      const changedLocally = Sync.canonical(merged) !== Sync.canonical(local);
      state = normalize(Sync.applySyncable(state, merged, t));
      if (Calc.settleDeposits(state, t, Date.now()).length) merged = Sync.toSyncable(state, t);

      if (!remote || Sync.canonical(merged) !== Sync.canonical(remote)) {
        const env = await Sync.encrypt(merged, sessionPass, salt);
        gist = gist ? await Sync.updateGist(token, gist.id, env) : await Sync.createGist(token, env);
      }
      syncCfg.gistId = gist.id;
      syncCfg.lastSync = new Date().toISOString();
      syncCfg.lastError = null;
      recordSnapshot();
      save();
      if (changedLocally) {
        fillDatalists();
        schedule();
        if (!dialog().open) render();
        if (base() !== oldBase) refreshPrices({ force: true });
        else if (state.stocks.some((s) => s.lastPrice == null) || state.crypto.some((c) => c.lastPrice == null)) refreshPrices();
      }
      if (manual) toast(firstConnect ? 'Sync is set up' : 'Synced');
    } catch (e) {
      syncCfg.lastError = e.message;
      if (e.code === 'BAD_PASSPHRASE') {
        sessionPass = '';
        delete syncCfg.passphrase;
      }
      if (manual || e.code === 'BAD_PASSPHRASE') toast(`Sync: ${e.message}`, 'error');
    } finally {
      syncing = false;
      saveSyncCfg();
      if (currentView === 'settings' && !dialog().open) render();
      else renderStatus();
      if (syncAgain) { syncAgain = false; queueSync(500); }
    }
  }

  function setupSync() {
    openForm({
      title: 'Set up sync',
      intro: 'Use the same passphrase on every device. It never leaves your devices — if you lose it, the synced copy can’t be recovered.',
      fields: [
        { key: 'token', label: 'GitHub token (gist permission only)', type: 'password', required: true, autocomplete: 'off', help: '<a href="https://github.com/settings/tokens/new?scopes=gist&description=MoneyMonkey%20sync" target="_blank" rel="noopener">Create one here</a> — only “gist” ticked.', span: true },
        { key: 'passphrase', label: 'Passphrase', type: 'password', required: true, autocomplete: 'new-password' },
        { key: 'confirm', label: 'Repeat passphrase', type: 'password', required: true, autocomplete: 'new-password' },
        { key: 'remember', label: 'Remember the passphrase on this device', type: 'checkbox', default: () => true, span: true },
      ],
      validate: (v) => {
        if (v.passphrase !== v.confirm) return 'The passphrases don’t match.';
        if (v.passphrase.length < 8) return 'Use at least 8 characters — a few random words works well.';
        return null;
      },
      submitLabel: 'Connect',
      onSave: (v) => {
        syncCfg = { token: v.token.trim(), remember: v.remember, passphrase: v.passphrase };
        sessionPass = v.passphrase;
        saveSyncCfg();
        setTimeout(() => syncNow({ firstConnect: true, manual: true }), 0);
      },
    });
  }

  function unlockSync() {
    openForm({
      title: 'Unlock sync',
      fields: [
        { key: 'passphrase', label: 'Passphrase', type: 'password', required: true, autocomplete: 'current-password' },
        { key: 'remember', label: 'Remember on this device', type: 'checkbox', default: () => !!syncCfg.remember },
      ],
      submitLabel: 'Unlock',
      onSave: (v) => {
        sessionPass = v.passphrase;
        syncCfg.remember = v.remember;
        syncCfg.passphrase = v.passphrase;
        syncCfg.lastError = null;
        saveSyncCfg();
        setTimeout(() => syncNow({ manual: true }), 0);
      },
    });
  }

  function disconnectSync() {
    if (!confirm('Disconnect sync on this device? Your data stays here and in the gist; this device just stops syncing.')) return;
    syncCfg = {};
    sessionPass = '';
    try { localStorage.removeItem(SYNC_KEY); } catch (e) { /* ignore */ }
    render();
    toast('Sync disconnected on this device');
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
    const rows = [['Section', 'Name', 'Platform', 'Currency', 'Value', `Value (${base()})`]];
    const names = { accounts: 'Cash', stocks: 'Stocks', crypto: 'Crypto', deposits: 'Fixed deposit', properties: 'Property', others: 'Other', liabilities: 'Liability' };
    for (const s of PLATFORM_SECTIONS) {
      for (const item of state[s]) {
        const sign = s === 'liabilities' ? -1 : 1;
        for (const part of Calc.itemParts(s, item, t)) {
          const v = sign * part.value;
          rows.push([names[s], item.name || item.symbol || item.coinId || '', item.platform || '', part.currency, round2(v), round2(toBase(v, part.currency))]);
        }
      }
    }
    const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
    download(`moneymonkey-${t}.csv`, csv, 'text/csv');
  }

  function demoState() {
    const t = new Date();
    const d = (days) => Calc.toISO(Calc.addDays(t, days));
    const m = (months) => Calc.toISO(Calc.addMonths(t, months));
    const now = new Date().toISOString();
    const s = defaultState();
    s.settings = { ...state.settings, baseCurrency: 'HKD' };
    const region = (r) => ({ region: r });
    s.platformMeta = {
      'HSBC HK': region('Hong Kong'), 'ZA Bank': region('Hong Kong'), Futu: region('Hong Kong'), MPF: region('Hong Kong'),
      Monzo: region('United Kingdom'), 'Trading 212': region('United Kingdom'), Nationwide: region('United Kingdom'), Revolut: region('United Kingdom'), Wise: region('United Kingdom'), 'UK property': region('United Kingdom'),
    };
    s.accounts = [
      { id: uid(), name: 'HSBC One', platform: 'HSBC HK', type: 'current', balances: [{ currency: 'HKD', amount: 38500 }, { currency: 'USD', amount: 2400 }, { currency: 'GBP', amount: 300 }], updatedAt: now },
      { id: uid(), name: 'Savings', platform: 'ZA Bank', type: 'savings', balances: [{ currency: 'HKD', amount: 120000 }], updatedAt: now },
      { id: uid(), name: 'Current account', platform: 'Monzo', type: 'current', balances: [{ currency: 'GBP', amount: 2350 }], updatedAt: now },
      { id: uid(), name: 'Multi-currency', platform: 'Wise', type: 'ewallet', balances: [{ currency: 'USD', amount: 850 }, { currency: 'EUR', amount: 400 }, { currency: 'GBP', amount: 120 }], updatedAt: now },
    ];
    s.stocks = [
      { id: uid(), symbol: '0700.HK', name: 'Tencent', platform: 'Futu', quantity: 200, avgCost: 310, manualPrice: 455, currency: 'HKD', source: 'manual' },
      { id: uid(), symbol: 'AAPL', name: 'Apple', platform: 'Futu', quantity: 25, avgCost: 165, currency: 'USD', source: 'live' },
      { id: uid(), symbol: 'VUSA.L', name: 'Vanguard S&P 500 UCITS ETF', platform: 'Trading 212', quantity: 60, avgCost: 68, manualPrice: 88.4, currency: 'GBP', source: 'manual' },
    ];
    s.crypto = [{ id: uid(), coinId: 'bitcoin', symbol: 'BTC', platform: 'Revolut', quantity: 0.05, avgCost: 42000, currency: 'USD', source: 'live' }];
    s.deposits = [
      { id: uid(), platform: 'HSBC HK', name: '12-month HKD', currency: 'HKD', principal: 200000, startDate: m(-5), termMonths: 12, compounding: 'simple', rate: 3.8, onMaturity: 'cash' },
      { id: uid(), platform: 'ZA Bank', name: '3-month promo', currency: 'HKD', principal: 100000, startDate: Calc.toISO(Calc.addDays(Calc.addMonths(t, -3), 9)), termMonths: 3, compounding: 'simple', rate: 4.2, onMaturity: 'renew' },
      { id: uid(), platform: 'Monzo', name: '1-year fixed saver', currency: 'GBP', principal: 5000, startDate: m(-2), endDate: m(10), termMonths: 12, compounding: 'annually', rate: 4.1, onMaturity: 'cash' },
    ];
    s.properties = [{
      id: uid(), name: 'Flat', address: 'Manchester', platform: 'UK property', currency: 'GBP', purchasePrice: 240000, purchaseDate: m(-40), updateFrequency: 'monthly', monthlyRent: 1150,
      valuations: [[-5, 251000], [-4, 252500], [-3, 251800], [-2, 254000], [-1, 255500]].map(([mo, v]) => ({ date: m(mo), value: v })),
    }];
    s.others = [
      { id: uid(), name: 'MPF', category: 'retirement', platform: 'MPF', currency: 'HKD', value: 380000, valueDate: d(-20), annualChangePct: 4 },
      { id: uid(), name: 'Gold bar', category: 'gold', currency: 'HKD', value: 48000, valueDate: m(-6), annualChangePct: 6 },
    ];
    s.liabilities = [
      { id: uid(), name: 'Buy-to-let mortgage', type: 'mortgage', platform: 'Nationwide', currency: 'GBP', mode: 'amortizing', principal: 180000, startDate: m(-40), rate: 4.4, payment: 990 },
      { id: uid(), name: 'Credit card', type: 'credit', platform: 'HSBC HK', currency: 'HKD', mode: 'manual', balance: 6200, rate: 0, payment: 6200 },
    ];
    s.cashflows = [
      { id: uid(), name: 'Salary', kind: 'income', category: 'Work', amount: 62000, currency: 'HKD', frequency: 'monthly', nextDate: d(9), active: true },
      { id: uid(), name: 'Rent from flat', kind: 'income', category: 'Property', amount: 1150, currency: 'GBP', frequency: 'monthly', nextDate: d(3), active: true },
      { id: uid(), name: 'Mortgage', kind: 'expense', category: 'Housing', amount: 990, currency: 'GBP', frequency: 'monthly', nextDate: d(5), active: true },
      { id: uid(), name: 'Rent (HK)', kind: 'expense', category: 'Housing', amount: 18000, currency: 'HKD', frequency: 'monthly', nextDate: d(1), active: true },
      { id: uid(), name: 'Groceries', kind: 'expense', category: 'Food', amount: 1200, currency: 'HKD', frequency: 'weekly', nextDate: d(2), active: true, onCard: true },
      { id: uid(), name: 'Octopus & transport', kind: 'expense', category: 'Transport', amount: 1000, currency: 'HKD', frequency: 'monthly', nextDate: d(12), active: true },
      { id: uid(), name: 'Netflix', kind: 'subscription', category: 'Entertainment', amount: 93, currency: 'HKD', frequency: 'monthly', nextDate: d(7), active: true, onCard: true },
      { id: uid(), name: 'Spotify', kind: 'subscription', category: 'Entertainment', amount: 11.99, currency: 'GBP', frequency: 'monthly', nextDate: d(16), active: true },
      { id: uid(), name: 'Monthly investing', kind: 'saving', category: 'Investing', amount: 8000, currency: 'HKD', frequency: 'monthly', nextDate: d(10), active: true },
    ];
    const ym = (k) => Calc.toISO(Calc.addMonths(t, -k)).slice(0, 7);
    s.spending = [
      [1, 'HSBC Red card', 14200, 'HKD'], [1, 'Monzo', 310, 'GBP'],
      [2, 'HSBC Red card', 11850, 'HKD'], [2, 'Monzo', 280, 'GBP'],
      [3, 'HSBC Red card', 16900, 'HKD', 'incl. flights'], [3, 'Monzo', 295, 'GBP'],
      [4, 'HSBC Red card', 12400, 'HKD'],
    ].map(([k, platform, amount, currency, note]) => ({ id: uid(), month: ym(k), platform, amount, currency, note: note || '' }));
    s.goals = [
      { id: uid(), name: 'Emergency fund', metric: 'cash', target: 250000 },
      { id: uid(), name: 'HK$5M net worth', metric: 'netWorth', target: 5000000, targetDate: m(60) },
    ];
    s.fx = state.fx;
    return s;
  }

  // ================================================================== events

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
        return editItem(sec, null, preset);
      }
      case 'open-account': location.hash = `#account/${encodeURIComponent(id)}`; return;
      case 'open-platform': location.hash = `#platform/${encodeURIComponent(b.dataset.name)}`; return;
      case 'edit': return editItem(sec, id);
      case 'edit-platform': return editPlatform(b.dataset.name);
      case 'valuation': return updateValuation(id);
      case 'quick-add': return quickAdd();
      case 'menu': return openMenu();
      case 'range': historyRange = b.dataset.range; return render();
      case 'cur-filter':
        filters.accountsCurrency = b.dataset.cur && filters.accountsCurrency !== b.dataset.cur ? b.dataset.cur : null;
        return render();
      case 'refresh': return refreshPrices({ force: true });
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
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.clickable, .card.clickable, li.clickable')) {
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
    state.settings = { ...state.settings, baseCurrency: newBase, finnhubKey: f.finnhubKey.value.trim(), refreshSec: Math.max(15, +f.refreshSec.value || 60), theme: f.theme.value };
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
    if (t) tooltip.show(esc(t.dataset.tip), e.clientX, e.clientY);
  });
  document.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) tooltip.hide(); });
  // Tapping the backdrop around a dialog closes it.
  dialog().addEventListener('click', (e) => { if (e.target === dialog()) dialog().close(); });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refreshPrices();
    queueSync(200);
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

  // ================================================================== boot

  fillDatalists();
  Calc.settleDeposits(state, todayISO(), Date.now());
  route();
  recordSnapshot();
  save();
  refreshPrices();
  schedule();
  syncNow();
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
})();
