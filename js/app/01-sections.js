/* MoneyMonkey app — Section definitions: each list's form fields and table columns.
 * The js/app/*.js files are loaded in order as plain scripts and share one scope (see index.html). */
'use strict';

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
      { key: 'balances', label: 'Balances', type: 'balances', required: true, span: true, default: () => [{ currency: base(), amount: null }], showRate: (v) => v.type === 'saver', help: 'One line per currency held in this account. For a saver, add each currency’s interest rate — interest is then estimated daily until you next update the balance.' },
      { key: 'note', label: 'Note' },
    ],
    editValues: (item) => ({ ...item, balances: Calc.accountBalances(item).map((b) => ({ ...b })) }),
    beforeSave: (item, prev) => {
      item.updatedAt = new Date().toISOString();
      const t = todayISO();
      const old = prev ? Calc.accountBalances(prev) : [];
      // A changed amount or rate is a newly confirmed balance: saver interest restarts from today.
      item.balances = item.balances.map((b) => {
        const o = old.find((x) => x.currency === b.currency);
        const line = { currency: b.currency, amount: b.amount };
        if (+b.rate) line.rate = +b.rate;
        const unchanged = o && +o.amount === +b.amount && (+o.rate || 0) === (+b.rate || 0);
        if (unchanged) {
          if (o.asOf) line.asOf = o.asOf;
          if (o.carry) line.carry = o.carry;
        } else if (line.rate) line.asOf = t;
        return line;
      });
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
      { key: 'avgCost', label: 'Average cost per share', type: 'number', required: true, signed: true, help: 'Used to calculate your profit and loss. If you copy a diluted cost from your broker (it can be negative), don’t also record those sales with Sell — choose the cost method instead.' },
      { ...currencyField, label: 'Trading currency', help: 'Currency the stock is quoted in.' },
      { key: 'costMethod', label: 'Cost method', type: 'select', options: () => COST_METHODS_FIELD(), help: 'Diluted (like Futu/moomoo): profit from sales lowers the cost of what’s left. Only how it’s shown changes.' },
      { key: 'source', label: 'Price source', type: 'select', options: opt([['live', 'Live (Finnhub)'], ['manual', 'Manual price']]) },
      { key: 'manualPrice', label: 'Current price', type: 'number', showIf: (v) => v.source === 'manual' },
      { key: 'divMode', label: 'Dividends', type: 'select', options: opt([['', 'None / not tracked'], ['perShare', 'Dividend per share (per year)'], ['yield', 'Dividend yield (%)']]) },
      { key: 'dividendPerShare', label: 'Dividend per share, per year', type: 'number', required: true, showIf: (v) => v.divMode === 'perShare', help: 'In the trading currency — the yearly total, e.g. “TTM dividend” in your broker app.' },
      { key: 'dividendYield', label: 'Dividend yield (% per year)', type: 'number', required: true, showIf: (v) => v.divMode === 'yield', help: 'Applied to the current value of your shares.' },
      { key: 'dividendReinvest', label: 'Reinvested automatically (DRIP / accumulating fund)', type: 'checkbox', span: true, showIf: (v) => !!v.divMode },
    ],
    actions: [{ id: 'trade-buy', label: 'Buy' }, { id: 'trade-sell', label: 'Sell' }, { id: 'trade-more', label: 'Dividend / split' }],
    beforeSave: (item, prev) => {
      if (!prev || prev.symbol !== item.symbol || item.source === 'manual') { item.lastPrice = null; item.prevClose = null; }
      if (!item.divMode) { delete item.dividendPerShare; delete item.dividendYield; delete item.dividendReinvest; }
    },
    columns: holdingColumns('symbol'),
    total: (items) => items.reduce((s, h) => s + (toBase(hv(h).marketValue, h.currency) || 0), 0),
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
      { key: 'avgCost', label: 'Average cost per coin', type: 'number', required: true, signed: true },
      { key: 'costMethod', label: 'Cost method', type: 'select', options: () => COST_METHODS_FIELD() },
      { ...currencyField, label: 'Cost currency' },
      { key: 'source', label: 'Price source', type: 'select', options: opt([['live', 'Live (CoinGecko)'], ['manual', 'Manual price']]) },
      { key: 'manualPrice', label: 'Current price', type: 'number', showIf: (v) => v.source === 'manual' },
    ],
    beforeSave: (item, prev) => {
      if (!prev || prev.coinId !== item.coinId || prev.currency !== item.currency || item.source === 'manual') { item.lastPrice = null; item.prevClose = null; }
    },
    columns: holdingColumns('coin'),
    actions: [{ id: 'trade-buy', label: 'Buy' }, { id: 'trade-sell', label: 'Sell' }],
    total: (items) => items.reduce((s, h) => s + (toBase(hv(h).marketValue, h.currency) || 0), 0),
  },

  deposits: {
    title: 'Fixed Deposits',
    singular: 'fixed deposit',
    intro: 'All your fixed deposits and regular savers across your bank accounts. Each one is held in a bank account; open an account in Cash & Bank to see its cash and deposits together. Interest accrues day by day, and at maturity the money can go back into the account automatically.',
    fields: [
      { key: 'kind', label: 'Type', type: 'select', span: true, options: opt([['', 'Fixed deposit (one amount)'], ['regular', 'Regular saver (pay in every month, fixed rate)']]) },
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
      { key: 'principal', label: 'Amount deposited', type: 'number', required: true, showIf: (v) => v.kind !== 'regular' },
      { key: 'monthlyAmount', label: 'Monthly payment', type: 'number', required: true, showIf: (v) => v.kind === 'regular' },
      { key: 'startDate', label: 'Start date', type: 'date', required: true, default: todayISO },
      {
        key: 'payFromAccountId', label: 'Paid from', type: 'select', span: true, showIf: (v) => v.kind === 'regular',
        options: () => [{ value: '', label: 'No account — just record it' }, ...state.accounts.map((a) => ({ value: a.id, label: `${a.name}${a.platform ? ` · ${a.platform}` : ''}` }))],
        help: 'On each payment date you’re asked to confirm; it’s then moved from this account into the saver.',
      },
      { key: 'payDay', label: 'Payment day of month', type: 'number', step: '1', placeholder: 'Same day as start', showIf: (v) => v.kind === 'regular' },
      { key: 'interestDay', label: 'Interest paid on day', type: 'number', step: '1', placeholder: 'Same day as start', showIf: (v) => v.kind === 'regular', help: 'Interest is calculated daily and added to the saver on this day each month (31 = last day of the month).' },
      { key: 'termMode', label: 'Term entered as', type: 'select', options: opt([['months', 'Number of months'], ['enddate', 'End (maturity) date']]), transient: true },
      { key: 'termMonths', label: 'Term (months)', type: 'number', required: true, default: () => 12, step: '1', showIf: (v) => v.termMode !== 'enddate' },
      { key: 'endDate', label: 'Maturity date', type: 'date', required: true, showIf: (v) => v.termMode === 'enddate' },
      { key: 'compounding', label: 'Interest type', type: 'select', options: COMPOUNDING, showIf: (v) => v.kind !== 'regular' },
      { key: 'rateMode', label: 'I know the…', type: 'select', options: opt([['rate', 'Interest rate (% p.a.)'], ['interest', 'Total interest amount at maturity']]), transient: true, showIf: (v) => v.kind !== 'regular' },
      { key: 'rate', label: 'Interest rate (% per year)', type: 'number', showIf: (v) => v.kind === 'regular' || v.rateMode !== 'interest', required: true, help: 'For a regular saver, enter the AER.' },
      { key: 'interestAmount', label: 'Total interest at maturity', type: 'number', showIf: (v) => v.kind !== 'regular' && v.rateMode === 'interest', required: true, transient: true },
      { key: 'onMaturity', label: 'When it matures', type: 'select', options: (v) => (v.kind === 'regular' ? ON_MATURITY.filter((o) => o.value !== 'renew') : ON_MATURITY), span: true },
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
      for (const k of ['payDay', 'interestDay']) if (v.kind === 'regular' && v[k] != null && v[k] !== '' && !(v[k] >= 1 && v[k] <= 31)) return 'Days of the month go from 1 to 31.';
      return null;
    },
    editValues: (item) => ({ ...item, termMode: item.endDate ? 'enddate' : 'months' }),
    beforeSave: (item) => {
      if (item.termMode === 'enddate') item.termMonths = Calc.monthsBetween(item.startDate, item.endDate);
      else item.endDate = null;
      if (item.kind === 'regular') {
        delete item.principal; delete item.compounding;
        if (!item.trackFrom) item.trackFrom = todayISO();
        if (item.onMaturity === 'renew') item.onMaturity = 'cash';
        for (const k of ['payDay', 'interestDay', 'payFromAccountId']) if (!item[k]) delete item[k];
      } else {
        delete item.kind;
        for (const k of ['monthlyAmount', 'payFromAccountId', 'payDay', 'interestDay', 'trackFrom', 'paid', 'lastHandled']) delete item[k];
      }
      if (item.kind !== 'regular' && item.rateMode === 'interest') item.rate = +Calc.impliedRate(item.principal, item.interestAmount, item.startDate, item.termMonths, item.compounding, item.endDate).toFixed(8);
      if (item.onMaturity !== 'cash') delete item.payoutAccountId;
      if (item.accountId === '__new') {
        const acct = { id: uid(), name: item.newAccountName, platform: item.newAccountPlatform, type: 'savings', balances: [], updatedAt: new Date().toISOString(), _mt: Date.now() };
        state.accounts.push(acct);
        item.accountId = acct.id;
      }
      item.platform = (state.accounts.find((a) => a.id === item.accountId) || {}).platform || '';
    },
    columns: [
      { label: 'Deposit', render: (d) => `<strong>${esc(d.platform || 'Fixed deposit')}</strong><div class="sub">${[d.kind === 'regular' ? 'Regular saver' : '', accountName(d.accountId), d.name].filter(Boolean).map(esc).join(' · ')}</div>` },
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
      {
        label: 'Deposited', num: true,
        render: (d) => {
          if (d.kind !== 'regular') return money(d.principal, d.currency);
          const v = Calc.depositValue(d, todayISO());
          return `${money(v.paidIn, d.currency)}<div class="sub">${money(d.monthlyAmount, d.currency)}/mo${!v.matured && v.nextPayment ? ` · next ${fmtDate(v.nextPayment)}` : ''}</div>`;
        },
      },
      { label: 'Rate', num: true, render: (d) => `${num(d.rate, 3)}%${d.kind === 'regular' ? ' AER' : ''}<div class="sub">${d.kind === 'regular' ? 'daily, paid monthly' : esc(labelOf(COMPOUNDING, d.compounding).replace('Compounded ', '').replace('Simple / paid at maturity', 'simple'))}</div>` },
      { label: 'Interest so far', num: true, render: (d) => { const v = Calc.depositValue(d, todayISO()); return `<span class="pos">${money(v.interest, d.currency)}</span><div class="sub">+${money(v.dailyInterest, d.currency)}/day</div>`; } },
      { label: 'Value today', num: true, primary: true, render: (d) => money(Calc.depositValue(d, todayISO()).value, d.currency) },
      {
        label: 'At maturity',
        num: true,
        render: (d) => {
          const v = Calc.depositValue(d, todayISO());
          const what = { cash: '→ moves to cash', renew: '↻ renews', keep: '' }[d.onMaturity || 'keep'];
          return `${d.kind === 'regular' && !v.matured ? '≈ ' : ''}${money(v.maturityValue, d.currency)}<div class="sub">${v.matured && (d.onMaturity || 'keep') === 'keep' ? '<span class="badge warn">Matured</span>' : esc(what)}</div>`;
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
      { key: 'monthlyRent', label: 'Monthly rental income (if let)', type: 'number', help: 'Counted as income in Cash Flow and in passive income automatically — no need to add it in Cash Flow too.' },
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
      { label: 'Rent / mo', num: true, render: (p) => (p.monthlyRent ? `${money(p.monthlyRent, p.currency, 0)}${rentNote(p) ? `<div class="sub">${rentNote(p).replace(/^ · /, '')}</div>` : ''}` : '—') },
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
    title: 'Debts',
    singular: 'loan',
    intro: 'Mortgages, car and personal loans. “Auto” lets the balance fall each month from the repayment schedule; “Manual” lets you type the balance yourself. Credit cards are in Cash Flow → Credit cards.',
    fields: [
      { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Home mortgage' },
      // Credit cards are tracked with their statements (Cash Flow → Credit cards); the old
      // "Credit card" loan type is only offered for loans that already use it.
      { key: 'type', label: 'Type', type: 'select', options: (v) => LOAN_TYPES.filter((o) => o.value !== 'credit' || v.type === 'credit'), help: 'Credit cards: add them in Cash Flow → Credit cards, so each bill counts as debt once, until it’s paid.' },
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
      { label: 'Balance owed', num: true, primary: true, render: (l) => `<span class="owed">${money(Calc.loanBalance(l, todayISO()).balance, l.currency)}</span>` },
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
      { key: 'nextDate', label: 'Next payment date', type: 'date', default: todayISO, help: 'For a one-off: the date it happened (or will). It counts in that month only.' },
      { key: 'startDate', label: 'Starts (optional)', type: 'date', showIf: (v) => v.frequency !== 'once', help: 'Leave empty to count it from now. Before this month it isn’t counted.' },
      { key: 'endDate', label: 'Ends (optional)', type: 'date', showIf: (v) => v.frequency !== 'once', help: 'Leave empty if it keeps going. After this month it stops counting.' },
      { key: 'changes', label: 'Amount changes', type: 'changes', span: true, showIf: (v) => v.frequency !== 'once', help: 'A new amount and the date it starts, e.g. a price rise from next month. Earlier months keep the old amount.' },
      { key: 'onCard', label: 'Paid by credit card (already included in the card spending I record)', type: 'checkbox', span: true, showIf: (v) => v.kind === 'expense' || v.kind === 'subscription' },
      {
        key: 'rentLink', label: 'Is this rent from one of your properties?', type: 'select', span: true, transient: true, showIf: (v) => v.kind === 'income' && state.properties.some((p) => +p.monthlyRent > 0),
        options: () => [{ value: '', label: 'Detect automatically (same amount as a property’s rent)' }, { value: '__none', label: 'No — separate income' }, ...state.properties.filter((p) => +p.monthlyRent > 0).map((p) => ({ value: p.id, label: `Yes — rent from “${p.name}”` }))],
        help: 'Property rent already counts as income from the property itself; linking makes sure it’s only counted once.',
      },
      {
        key: 'saverLink', label: 'Is this the payment into a regular saver?', type: 'select', span: true, transient: true, showIf: (v) => v.kind === 'saving' && state.deposits.some((d) => d.kind === 'regular'),
        options: () => [{ value: '', label: 'Detect automatically (same amount as a regular saver)' }, { value: '__none', label: 'No — separate saving' }, ...state.deposits.filter((d) => d.kind === 'regular').map((d) => ({ value: d.id, label: `Yes — into the regular saver at ${d.platform || 'your bank'}${d.name ? ` (${d.name})` : ''}` }))],
        help: 'A regular saver’s payment already counts as saving; linking makes sure it’s only counted (and confirmed) once.',
      },
      {
        key: 'loanLink', label: 'Is this a loan repayment?', type: 'select', span: true, transient: true, showIf: (v) => v.kind === 'expense' && state.liabilities.some((l) => l.type !== 'credit'),
        options: () => [{ value: '', label: 'Detect automatically (same amount as a loan)' }, { value: '__none', label: 'No — not a loan repayment' }, ...state.liabilities.filter((l) => l.type !== 'credit').map((l) => ({ value: l.id, label: `Yes — repayment for “${l.name}”` }))],
        help: 'Loan repayments are counted in your spending from Debts; linking a bill here makes sure it’s only counted once.',
      },
      {
        key: 'accountId', label: 'Paid from / into account (optional — for a transfer: from)', type: 'select', span: true,
        showIf: (v) => !(v.onCard && (v.kind === 'expense' || v.kind === 'subscription')),
        options: () => [{ value: '', label: 'Not linked — just for my budget' }, ...state.accounts.map((a) => ({ value: a.id, label: `${a.name}${a.platform ? ` · ${a.platform}` : ''}` }))],
        help: 'On each payment date MoneyMonkey asks you to confirm before changing that account’s balance.',
      },
      {
        key: 'toAccountId', label: 'Into account', type: 'select', span: true, showIf: (v) => v.kind === 'transfer' || (v.kind === 'saving' && !!v.accountId),
        options: (v) => [{ value: '', label: v.kind === 'transfer' ? 'Choose the account it goes into' : 'Not tracked — e.g. spent on investments directly' }, ...state.accounts.filter((a) => a.id !== v.accountId).map((a) => ({ value: a.id, label: `${a.name}${a.platform ? ` · ${a.platform}` : ''}` }))],
        help: 'When you confirm it, the money leaves the first account and arrives here — e.g. HSBC → Futu cash each month. Your net worth stays the same.',
      },
      { key: 'active', label: 'Active', type: 'checkbox', default: () => true },
    ],
    validate: (v) => {
      if (v.kind === 'transfer' && (!v.accountId || !v.toAccountId)) return 'A transfer needs both accounts: where it comes from and where it goes.';
      if (v.startDate && v.endDate && v.endDate < v.startDate) return 'The end date is before the start date.';
      return null;
    },
    // In the form: end a recurring item now (it's kept under Ended), or restart an ended one.
    formButtons: (c, overrides) => (c.frequency === 'once' || overrides ? [] : Calc.hasEnded(c, todayISO())
      ? [{ label: 'Restart', onClick: () => { setTimeout(() => restartCashflow(c.id)); return true; } }]
      : [{ label: 'End now', onClick: () => endCashflow(c.id) }]),
    editValues: (item) => ({ ...item, loanLink: item.notLoan ? '__none' : item.loanId || '', rentLink: item.notRent ? '__none' : item.propertyId || '', saverLink: item.notSaver ? '__none' : item.saverId || '' }),
    beforeSave: (item, prev) => {
      if (item.rentLink !== undefined) {
        item.propertyId = item.rentLink && item.rentLink !== '__none' ? item.rentLink : '';
        item.notRent = item.rentLink === '__none';
        if (!item.propertyId) delete item.propertyId;
        if (!item.notRent) delete item.notRent;
      }
      if (item.saverLink !== undefined) {
        item.saverId = item.saverLink && item.saverLink !== '__none' ? item.saverLink : '';
        item.notSaver = item.saverLink === '__none';
        if (!item.saverId) delete item.saverId;
        if (!item.notSaver) delete item.notSaver;
      }
      if (item.loanLink !== undefined) {
        item.loanId = item.loanLink && item.loanLink !== '__none' ? item.loanLink : '';
        item.notLoan = item.loanLink === '__none';
        if (!item.loanId) delete item.loanId;
        if (!item.notLoan) delete item.notLoan;
      }
      // Start / end dates and amount changes (recurring items only).
      if (item.frequency === 'once') { delete item.startDate; delete item.endDate; delete item.changes; }
      for (const k of ['startDate', 'endDate']) if (!item[k]) delete item[k];
      if (item.startDate && (!item.nextDate || item.nextDate < item.startDate)) item.nextDate = item.startDate;
      if (item.changes) {
        item.changes = item.changes.filter((c) => c.from && isFinite(c.amount)).sort((a, b) => (a.from < b.from ? -1 : 1));
        if (!item.changes.length) delete item.changes;
      }
      if (!prev || prev.endDate !== item.endDate) delete item.endAsked;
      if (item.onCard && (item.kind === 'expense' || item.kind === 'subscription')) item.accountId = '';
      if (!item.toAccountId || !item.accountId) delete item.toAccountId;
      if (!item.accountId) {
        delete item.trackFrom;
        delete item.lastHandled;
      } else if (!prev || prev.accountId !== item.accountId) {
        // Only payments from today on are offered for confirmation.
        item.trackFrom = todayISO();
        delete item.lastHandled;
      }
    },
    columns: [
      { label: 'Item', render: (c) => `<strong>${esc(c.name)}</strong><div class="sub"><span class="badge kind-${esc(c.kind)}">${esc(labelOf(FLOW_KINDS, c.kind))}</span>${c.onCard ? ` <span class="badge" title="Paid by credit card">${icon('card')} card</span>` : ''}${c.accountId && accountName(c.accountId) ? ` <span class="badge" title="Linked account — you confirm each payment">↔ ${esc(accountName(c.accountId))}${c.toAccountId && accountName(c.toAccountId) ? ` → ${esc(accountName(c.toAccountId))}` : ''}</span>` : ''}${cfBadges(c)} ${esc(c.category || '')}</div>` },
      { label: 'Amount', num: true, primary: true, render: (c) => `${money(Calc.amountOn(c, todayISO()), c.currency)}<div class="sub">${esc(labelOf(FREQ, c.frequency))}</div>` },
      { label: 'Per month', num: true, render: (c) => (cfStatus(c) ? '<span class="sub">—</span>' : money(toBase(Calc.monthlyAmount(c, thisMonth()), c.currency))) },
      { label: 'Per year', num: true, render: (c) => (cfStatus(c) ? '<span class="sub">—</span>' : money(toBase(Calc.monthlyAmount(c, thisMonth()) * 12, c.currency))) },
      { label: 'Next', render: (c) => (c.active === false ? '<span class="badge">Paused</span>' : Calc.hasEnded(c, todayISO()) ? `<span class="badge">Ended ${esc(fmtMonth(c.endDate.slice(0, 7)))}</span>` : fmtDate(Calc.nextOccurrence(c, todayISO()))) },
    ],
  },

  spending: {
    title: 'Card statement',
    singular: 'statement',
    fields: [
      {
        key: 'cardId', label: 'Card', type: 'select', required: true, span: true,
        options: () => [...state.cards.map((c) => ({ value: c.id, label: `${c.name}${c.platform ? ` · ${c.platform}` : ''}` })), { value: '__new', label: '+ New card…' }],
      },
      { key: 'newCardName', label: 'New card name', required: true, transient: true, placeholder: 'e.g. HSBC Red, Amex', showIf: (v) => v.cardId === '__new' },
      { key: 'month', label: 'Month spent', type: 'month', required: true, default: lastMonth },
      { key: 'amount', label: 'Statement amount', type: 'number', required: true, help: 'The total of that month’s statement for this card.' },
      currencyField,
      { key: 'dueDate', label: 'Payment due date', type: 'date', help: 'Leave blank to use the card’s due day.' },
      {
        key: 'payFromAccountId', label: 'Paid from', type: 'select', span: true,
        options: (v) => {
          const c = cardById(v.cardId);
          return [{ value: '', label: c && c.payFromAccountId ? `The card’s usual account (${accountName(c.payFromAccountId)})` : 'Not linked — just remind me' }, ...accountOptions()];
        },
      },
      { key: 'paid', label: 'Already paid (e.g. an old statement)', type: 'checkbox', transient: true, span: true },
      { key: 'note', label: 'Note', placeholder: 'optional, e.g. incl. flights' },
    ],
    preview: (v) => {
      if (v.paid) return 'Recorded as paid — it won’t count as debt or ask you to pay.';
      const c = cardById(v.cardId);
      const due = v.dueDate || Calc.cardDueDate(c, v.month);
      if (!due) return 'No due date: set a due day on the card (or a date here) to get a reminder and track it as debt until it’s paid.';
      const acctId = v.payFromAccountId || (c && c.payFromAccountId);
      if (due < todayISO()) return `Due <strong>${fmtDate(due)}</strong>, which has passed. If you’ve already paid it, tick “Already paid” — otherwise it shows as overdue debt until you confirm the payment.`;
      return `Counts as debt until paid. Due <strong>${fmtDate(due)}</strong>${acctId ? ` — you’ll be asked to confirm paying it from <strong>${esc(accountName(acctId))}</strong>` : ' — you’ll be reminded to mark it paid'}.`;
    },
    editValues: (item) => ({ ...item, paid: !!item.paidOn }),
    beforeSave: (item, prev) => {
      if (item.cardId === '__new') {
        const c = { id: uid(), name: item.newCardName, platform: '', currency: item.currency, dueDay: null, payFromAccountId: '', _mt: Date.now() };
        state.cards.push(c);
        item.cardId = c.id;
      }
      const card = cardById(item.cardId);
      item.platform = card ? card.name : '';
      if (!item.dueDate) item.dueDate = Calc.cardDueDate(card, item.month);
      if (!item.dueDate) delete item.dueDate;
      if (!item.payFromAccountId) delete item.payFromAccountId;
      if (item.paid) item.paidOn = (prev && prev.paidOn) || todayISO();
      else delete item.paidOn;
    },
    validate: (v) => (/^\d{4}-\d{2}$/.test(v.month || '') ? null : 'Pick a month (YYYY-MM).'),
    columns: [],
  },

  cards: {
    title: 'Credit cards',
    singular: 'card',
    fields: [
      { key: 'name', label: 'Card name', required: true, placeholder: 'e.g. HSBC Red, Amex' },
      platformField('Bank / issuer', 'e.g. HSBC HK'),
      { ...currencyField, label: 'Billing currency' },
      { key: 'dueDay', label: 'Payment due day (each month)', type: 'number', step: '1', placeholder: 'e.g. 25', help: 'A statement for September is due on this day in October.' },
      {
        key: 'payFromAccountId', label: 'Usually paid from', type: 'select', span: true,
        options: () => [{ value: '', label: 'Not linked — just remind me' }, ...accountOptions()],
        help: 'On the due date you’ll be asked to confirm before the bill comes off this account.',
      },
      { key: 'note', label: 'Note', span: true },
    ],
    validate: (v) => (v.dueDay == null || (Number.isInteger(v.dueDay) && v.dueDay >= 1 && v.dueDay <= 31) ? null : 'The due day should be a day of the month, 1–31.'),
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
    { label: 'Avg cost', num: true, render: (h) => { const v = hv(h); return `${money(v.avgCost, h.currency)}${Calc.costMethod(state, h) === 'diluted' ? '<div class="sub">diluted</div>' : ''}`; } },
    { label: 'Price', num: true, render: (h) => { const v = hv(h); return `${money(v.price, h.currency)}<div class="sub">${v.live ? '<span class="live-dot"></span>live' : h.source === 'manual' ? 'manual' : 'waiting…'}</div>`; } },
    { label: kind === 'coin' ? '24h' : 'Today', num: true, render: (h) => { const v = hv(h); return v.live && h.prevClose ? `${signed(v.dayChange, h.currency)}<div class="sub">${pct(v.dayChangePct)}</div>` : '—'; } },
    { label: 'Market value', num: true, primary: true, render: (h) => money(hv(h).marketValue, h.currency) },
    ...(kind === 'coin' ? [] : [{
      label: 'Dividends / yr', num: true,
      render: (h) => {
        const y = Calc.dividendPerYear(h);
        const mv = hv(h).marketValue;
        return y > 0 ? `${money(y, h.currency)}<div class="sub">${mv ? `${((y / mv) * 100).toFixed(1)}% · ` : ''}${h.dividendReinvest ? 'reinvested' : 'paid out'}</div>` : '<span class="sub">—</span>';
      },
    }]),
    { label: 'Profit / loss', num: true, render: (h) => { const v = hv(h); return `${signed(v.pnl, h.currency)}<div class="sub">${pct(v.pnlPct)}</div>`; } },
  ];
}

function depositPreview(v) {
  if (v.kind === 'regular') return regularSaverPreview(v);
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

function regularSaverPreview(v) {
  if (!(v.monthlyAmount > 0) || !v.startDate || !(+v.rate >= 0)) return '';
  const dep = { ...v, endDate: v.termMode === 'enddate' ? v.endDate : null, trackFrom: v.trackFrom || todayISO() };
  if (dep.endDate && dep.endDate <= dep.startDate) return '';
  if (!dep.endDate && !(dep.termMonths >= 1)) return '';
  const t = todayISO();
  const r = Calc.regularSaverValue(dep, t);
  const cur = /^[A-Z]{3}$/.test(v.currency || '') ? v.currency : base();
  const n = Math.round(r.plannedIn / v.monthlyAmount);
  const past = v.trackFrom ? '' : r.paidIn > 0 ? `<br>Payments before today (${money(r.paidIn, cur)}) are assumed made on schedule; from today you confirm each one.` : '';
  const hist = r.history.filter((h) => h.amount > 0).slice(-8).reverse().map((h) => `<li><span class="ev-date">${fmtDate(h.date)}</span><span class="ev-label">${h.kind === 'interest' ? 'Interest added' : 'Paid in'}</span><span class="${h.kind === 'interest' ? 'pos' : ''}">${money(h.amount, cur)}</span></li>`).join('');
  return `<strong>${fmtDate(r.startDate)} → ${fmtDate(r.maturityDate)}</strong> (${termText(r)}).<br>
    ${plural(n, 'payment')} of ${money(v.monthlyAmount, cur)} = ${money(r.plannedIn, cur)}, about ${money(r.maturityInterest, cur)} interest at ${num(+v.rate, 2)}% AER (${num(r.grossRate, 2)}% gross, paid monthly) — about <strong>${money(r.maturityValue, cur)}</strong> at the end.${past}
    ${r.paidIn > 0 ? `<br>Now: ${money(r.paidIn, cur)} paid in + ${money(r.interest, cur)} interest = <strong>${money(r.value, cur)}</strong>${r.interestThisPeriod > 0.005 ? ` (incl. ${money(r.interestThisPeriod, cur)} building up this month)` : ''}.` : ''}
    ${hist ? `<ul class="events">${hist}</ul>` : ''}
    ${v.id ? saverPaymentList(dep, t, cur) : ''}`;
}

// A saved regular saver's payments so far, each correctable: "Undo" for an answer given in a
// payment box or check-in (reverses it and asks again), otherwise a plain paid / not-paid switch.
function saverPaymentList(dep, t, cur) {
  const { payDates } = Calc.regularSaverSchedule(dep, t);
  const rows = payDates.filter((d) => d <= t).reverse().map((date) => {
    const answered = state.activity.find((x) => x.id === `pay-rs:${dep.id}:${date}`);
    const amt = Calc.regularPaid(dep, date, false);
    const waiting = Calc.pendingPayments(state, t).some((p) => p.key === `rs:${dep.id}:${date}`);
    const status = waiting ? '<span class="sub">waiting to confirm</span>' : amt > 0 ? `paid ${money(amt, cur)}` : '<span class="sub">not paid</span>';
    const btn = waiting ? '' : `<button type="button" class="btn small ghost" data-action="saver-toggle" data-id="${esc(dep.id)}" data-date="${date}">${answered ? 'Undo' : amt > 0 ? 'Mark not paid' : 'Mark paid'}</button>`;
    return `<li><span class="ev-date">${fmtDate(date)}</span><span class="ev-label">${status}</span>${btn}</li>`;
  }).join('');
  return rows ? `<div class="saver-pays"><strong>Payments</strong> <span class="sub">— correct any month here. “Undo” reverses what you confirmed and asks again; “Mark paid / not paid” only changes the saver’s record.</span><ul class="events">${rows}</ul></div>` : '';
}
