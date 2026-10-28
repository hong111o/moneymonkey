/* MoneyMonkey app — Misc UI: menus, quick add, demo data and other helpers.
 * The js/app/*.js files are loaded in order as plain scripts and share one scope (see index.html). */
'use strict';

// ================================================================== misc UI

const tooltip = {
  el: null,
  timer: null,
  // With a finger, show the label above the touch point (centred) so the finger doesn't cover
  // it; with a mouse, beside the pointer. Flip to the other side when there's no room.
  show(html, x, y, pointerType) {
    clearTimeout(this.timer);
    this.el = this.el || $('#tooltip');
    this.el.innerHTML = html;
    this.el.hidden = false;
    const r = this.el.getBoundingClientRect();
    const touch = pointerType === 'touch' || pointerType === 'pen';
    let left, top;
    if (touch) {
      const finger = 48; // clearance for a fingertip
      left = x - r.width / 2;
      top = y - finger - r.height;
      if (top < 8) top = y + finger;
    } else {
      left = x + 14;
      top = y + 14 + r.height > window.innerHeight ? y - r.height - 10 : y + 14;
    }
    this.el.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, left))}px`;
    this.el.style.top = `${Math.max(8, top)}px`;
  },
  // After a tap the label stays a moment, so it can be read without a finger in the way.
  hide(pointerType) {
    clearTimeout(this.timer);
    if (!this.el) return;
    if (pointerType === 'touch' || pointerType === 'pen') this.timer = setTimeout(() => { this.el.hidden = true; }, 2500);
    else this.el.hidden = true;
  },
};

// Short messages at the top of the screen; at most two at once, each gone after 3 seconds.
function toast(msg, kind = '') {
  const host = $('#toasts');
  while (host.children.length >= 2) host.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 5000 : 3000);
}

// A message with an Undo button for 5 seconds. Shown inside an open box, so it can be tapped.
function undoToast(msg, onUndo) {
  const inBox = dialog().open && $('.modal-body', dialog());
  const el = document.createElement('div');
  el.className = `toast toast-undo${inBox ? ' in-dialog' : ''}`;
  el.innerHTML = `<span class="grow">${esc(msg)}</span><button type="button" class="btn small">Undo</button>`;
  if (inBox) $('.modal-body', dialog()).prepend(el);
  else { const host = $('#toasts'); while (host.children.length >= 2) host.firstElementChild.remove(); host.appendChild(el); }
  const timer = setTimeout(() => el.remove(), 5000);
  el.querySelector('button').addEventListener('click', (e) => {
    e.stopPropagation();
    clearTimeout(timer);
    el.remove();
    onUndo();
  });
}

// Puts the data back as it was in `snap` (a JSON copy taken just before an action). Restored
// items get a fresh edit time and items the action created are deleted, so sync keeps the undo.
function restoreSnapshot(snap) {
  const old = JSON.parse(snap);
  const now = Date.now();
  old.deleted = { ...(old.deleted || {}) };
  for (const sec of Sync.SECTIONS) {
    const cur = new Map((state[sec] || []).map((x) => [x.id, x]));
    const before = new Set();
    for (const item of old[sec] || []) {
      before.add(item.id);
      const c = cur.get(item.id);
      if (!c || JSON.stringify(c) !== JSON.stringify(item)) { item._mt = now; delete old.deleted[item.id]; }
    }
    for (const id of cur.keys()) if (!before.has(id)) old.deleted[id] = now;
  }
  state = normalize(old);
  commit();
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
  const names = { accounts: 'Cash', stocks: 'Stocks', crypto: 'Crypto', deposits: 'Fixed deposit', properties: 'Property', others: 'Other', liabilities: 'Debt' };
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
  // Balances last confirmed 5 days ago, so payments since then ask to be confirmed without a warning.
  const now = Calc.addDays(t, -5).toISOString();
  const s = defaultState();
  s.settings = { ...state.settings, baseCurrency: 'HKD' };
  const region = (r) => ({ region: r });
  s.platformMeta = {
    'HSBC HK': region('Hong Kong'), 'ZA Bank': region('Hong Kong'), Futu: region('Hong Kong'), MPF: region('Hong Kong'),
    Monzo: region('United Kingdom'), 'Trading 212': region('United Kingdom'), Nationwide: region('United Kingdom'), Revolut: region('United Kingdom'), Wise: region('United Kingdom'), 'UK property': region('United Kingdom'),
  };
  s.accounts = [
    { id: uid(), name: 'HSBC One', platform: 'HSBC HK', type: 'current', balances: [{ currency: 'HKD', amount: 38500 }, { currency: 'USD', amount: 2400 }, { currency: 'GBP', amount: 300 }], updatedAt: now },
    // A saver: interest is estimated day by day since the balance was last confirmed.
    { id: uid(), name: 'Savings', platform: 'ZA Bank', type: 'saver', balances: [{ currency: 'HKD', amount: 120000, rate: 3.2, asOf: d(-12) }], updatedAt: now },
    { id: uid(), name: 'Current account', platform: 'Monzo', type: 'current', balances: [{ currency: 'GBP', amount: 2350 }], updatedAt: now },
    { id: uid(), name: 'Multi-currency', platform: 'Wise', type: 'ewallet', balances: [{ currency: 'USD', amount: 850 }, { currency: 'EUR', amount: 400 }, { currency: 'GBP', amount: 120 }], updatedAt: now },
    // Uninvested cash in investment accounts.
    { id: uid(), name: 'Futu cash', platform: 'Futu', type: 'brokerage', balances: [{ currency: 'HKD', amount: 15000 }, { currency: 'USD', amount: 600 }], updatedAt: now },
    { id: uid(), name: 'Trading 212 cash', platform: 'Trading 212', type: 'brokerage', balances: [{ currency: 'GBP', amount: 420 }], updatedAt: now },
  ];
  s.stocks = [
    { id: uid(), symbol: '0700.HK', name: 'Tencent', platform: 'Futu', quantity: 200, avgCost: 310, manualPrice: 455, currency: 'HKD', source: 'manual', divMode: 'perShare', dividendPerShare: 3.4 },
    { id: uid(), symbol: 'AAPL', name: 'Apple', platform: 'Futu', quantity: 25, avgCost: 165, currency: 'USD', source: 'live' },
    { id: uid(), symbol: 'VUSA.L', name: 'Vanguard S&P 500 UCITS ETF', platform: 'Trading 212', quantity: 60, avgCost: 68, manualPrice: 88.4, currency: 'GBP', source: 'manual', divMode: 'yield', dividendYield: 1.1, dividendReinvest: true },
  ];
  s.crypto = [{ id: uid(), coinId: 'bitcoin', symbol: 'BTC', platform: 'Revolut', quantity: 0.05, avgCost: 42000, currency: 'USD', source: 'live' }];
  s.deposits = [
    // Matured a few days ago: moves into the account automatically when the demo loads.
    { id: uid(), platform: 'ZA Bank', name: '1-month promo', currency: 'HKD', principal: 50000, startDate: Calc.toISO(Calc.addDays(Calc.addMonths(t, -1), -4)), termMonths: 1, compounding: 'simple', rate: 4.5, onMaturity: 'cash' },
    { id: uid(), platform: 'HSBC HK', name: '12-month HKD', currency: 'HKD', principal: 200000, startDate: m(-5), termMonths: 12, compounding: 'simple', rate: 3.8, onMaturity: 'cash' },
    { id: uid(), platform: 'ZA Bank', name: '3-month promo', currency: 'HKD', principal: 100000, startDate: Calc.toISO(Calc.addDays(Calc.addMonths(t, -3), 9)), termMonths: 3, compounding: 'simple', rate: 4.2, onMaturity: 'renew' },
    { id: uid(), platform: 'Monzo', name: '1-year fixed saver', currency: 'GBP', principal: 5000, startDate: m(-2), endDate: m(10), termMonths: 12, compounding: 'annually', rate: 4.1, onMaturity: 'cash' },
    { id: uid(), kind: 'regular', platform: 'Monzo', name: '12-month saver', currency: 'GBP', monthlyAmount: 300, startDate: m(-4), termMonths: 12, rate: 6.5, onMaturity: 'cash', trackFrom: m(0) },
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
    // Same payment as the regular saver: counted once.
    { id: uid(), name: 'Into regular saver', kind: 'saving', category: 'Saving', amount: 300, currency: 'GBP', frequency: 'monthly', nextDate: d(30), active: true },
    { id: uid(), name: 'iCloud+', kind: 'subscription', category: 'Entertainment', amount: 2.99, currency: 'USD', frequency: 'monthly', nextDate: d(-1), active: true },
    // Quarterly and yearly bills are averaged per month.
    { id: uid(), name: 'Electricity', kind: 'expense', category: 'Utilities', amount: 1800, currency: 'HKD', frequency: 'quarterly', nextDate: d(20), active: true },
    { id: uid(), name: 'Home insurance', kind: 'expense', category: 'Insurance', amount: 3600, currency: 'HKD', frequency: 'yearly', nextDate: m(5), active: true },
    // A one-off: counts in its own month in Month by month, never in the regular plan.
    { id: uid(), name: 'Bonus', kind: 'income', category: 'One-off', amount: 30000, currency: 'HKD', frequency: 'once', nextDate: Calc.toISO(Calc.addDays(Calc.addMonths(t, -2), -3)), active: true },
    { id: uid(), name: 'Gym (paused)', kind: 'subscription', category: 'Health', amount: 480, currency: 'HKD', frequency: 'monthly', nextDate: d(4), active: false },
  ];
  const ym = (k) => Calc.toISO(Calc.addMonths(t, -k)).slice(0, 7);
  const hsbcId = s.accounts[0].id;
  const monzoId = s.accounts[2].id;
  s.deposits.find((x) => x.kind === 'regular').payFromAccountId = monzoId;
  const zaId = s.accounts[1].id;
  // Linked to an account, so the app asks you to confirm when they're paid. "iCloud+" is in USD
  // but paid from an HKD-only account, so its box asks how much HKD the bank took.
  const link = (name, accountId, nextDate) => Object.assign(s.cashflows.find((c) => c.name === name), { accountId, nextDate, trackFrom: nextDate });
  link('Salary', hsbcId, d(-2));
  // Saving into another account: confirmed like a payment, arrives at Futu cash.
  Object.assign(link('Monthly investing', hsbcId, d(10)), { toAccountId: s.accounts.find((a) => a.name === 'Futu cash').id });
  link('Rent (HK)', hsbcId, d(1));
  link('iCloud+', zaId, d(-1));
  s.cards = [
    { id: uid(), name: 'HSBC Red', platform: 'HSBC HK', currency: 'HKD', dueDay: Math.min(28, t.getDate() + 6), payFromAccountId: hsbcId },
    { id: uid(), name: 'Monzo Flex', platform: 'Monzo', currency: 'GBP', dueDay: 15, payFromAccountId: monzoId },
  ];
  s.spending = [
    [1, 0, 14200, '', false], [1, 1, 310, '', false],
    [2, 0, 11850, '', true], [2, 1, 280, '', true],
    [3, 0, 16900, 'incl. flights', true], [3, 1, 295, '', true],
    [4, 0, 12400, '', true],
    // Older statements, so "By year" has more than one year to show.
    ...Array.from({ length: 14 }, (_, i) => [5 + i, 0, Math.round(11500 + 2600 * Math.abs(Math.sin(i * 1.7))), '', true]),
  ].map(([k, ci, amount, note, paid]) => {
    const card = s.cards[ci];
    // Last month's Monzo Flex bill is a few days overdue, so it asks to be paid.
    const dueDate = k === 1 && ci === 1 ? d(-3) : Calc.cardDueDate(card, ym(k));
    return { id: uid(), cardId: card.id, month: ym(k), platform: card.name, amount, currency: card.currency, note, dueDate, ...(paid ? { paidOn: dueDate } : {}) };
  });
  s.goals = [
    { id: uid(), name: 'Emergency fund', metric: 'cash', target: 250000 },
    { id: uid(), name: 'HK$5M net worth', metric: 'netWorth', target: 5000000, targetDate: m(60) },
  ];
  // Past trades, so "Realised profit" and the account history have something to show.
  const futuCash = s.accounts.find((a) => a.name === 'Futu cash');
  const aapl = s.stocks.find((h) => h.symbol === 'AAPL');
  const vusa = s.stocks.find((h) => h.symbol === 'VUSA.L');
  const t212 = s.accounts.find((a) => a.name === 'Trading 212 cash');
  s.trades = [
    { id: `trade-${uid()}`, date: m(-1), side: 'sell', section: 'stocks', holdingId: aapl.id, symbol: 'AAPL', platform: 'Futu', quantity: 10, price: 228, fee: 1, currency: 'USD', total: 2279, before: { quantity: 35, avgCost: 165 }, realised: 629, accountId: futuCash.id, accountName: futuCash.name, cashCurrency: 'USD', cashAmount: 2279 },
    { id: `trade-${uid()}`, date: m(-3), side: 'buy', section: 'stocks', holdingId: vusa.id, symbol: 'VUSA.L', platform: 'Trading 212', quantity: 20, price: 80, fee: 0, currency: 'GBP', total: 1600, before: { quantity: 40, avgCost: 62 }, realised: null, accountId: t212.id, accountName: t212.name, cashCurrency: 'GBP', cashAmount: 1600 },
  ];
  s.activity = [
    { id: `tr-${uid()}`, date: d(-10), kind: 'transfer', amount: 500, currency: 'GBP', received: 500, toCurrency: 'GBP', accountId: hsbcId, accountName: 'HSBC One', toAccountId: monzoId, toAccountName: 'Current account', note: 'Top up for UK bills' },
  ];
  s.fx = state.fx;
  // A year and a half of net-worth history for the chart (values filled in when the snapshot is taken).
  s.history = Array.from({ length: 560 }, (_, i) => {
    const k = 560 - i;
    // Salary was HK$4,000 lower until four months ago, to show Month by month keeping old months.
    return { date: d(-k), raise: k > 100 ? 4000 : 0, demo: (1 - k * 0.0003) * (1 + 0.012 * Math.sin((i - 559) / 9) + 0.006 * Math.sin((i - 559) / 2.3)), netWorth: 0, assets: 0, liabilities: 0, currency: 'HKD', t: Date.now() };
  });
  return s;
}
