'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('addMonths clamps to month end', () => {
  assert.equal(C.toISO(C.addMonths(C.parseDate('2026-01-31'), 1)), '2026-02-28');
  assert.equal(C.toISO(C.addMonths(C.parseDate('2024-01-31'), 1)), '2024-02-29');
  assert.equal(C.toISO(C.addMonths(C.parseDate('2026-03-15'), -3)), '2025-12-15');
});

test('monthsBetween counts whole months', () => {
  assert.equal(C.monthsBetween('2026-01-15', '2026-02-14'), 0);
  assert.equal(C.monthsBetween('2026-01-15', '2026-02-15'), 1);
  assert.equal(C.monthsBetween('2026-01-31', '2026-02-28'), 1);
  assert.equal(C.monthsBetween('2026-05-01', '2026-01-01'), 0);
});

test('convert via base rates', () => {
  const fx = { base: 'USD', rates: { USD: 1, HKD: 7.8, SGD: 1.3 } };
  close(C.convert(78, 'HKD', 'USD', fx), 10);
  close(C.convert(10, 'USD', 'SGD', fx), 13);
  close(C.convert(78, 'HKD', 'SGD', fx), 13);
  assert.ok(Number.isNaN(C.convert(1, 'XYZ', 'USD', fx)));
  assert.equal(C.convert(5, 'XYZ', 'XYZ', fx), 5);
});

test('fixed deposit: simple interest accrues by day and caps at maturity', () => {
  const dep = { principal: 10000, rate: 4, startDate: '2026-01-01', termMonths: 12, compounding: 'simple' };
  const mid = C.depositValue(dep, '2026-07-02'); // 182 days
  close(mid.interest, 10000 * 0.04 * 182 / 365);
  close(mid.dailyInterest, 10000 * 0.04 / 365);
  assert.equal(mid.maturityDate, '2027-01-01');
  close(mid.maturityValue, 10400);
  const after = C.depositValue(dep, '2027-06-01');
  close(after.value, 10400);
  assert.equal(after.matured, true);
  assert.equal(after.dailyInterest, 0);
  const before = C.depositValue(dep, '2025-12-01');
  assert.equal(before.interest, 0);
});

test('fixed deposit: monthly compounding beats simple', () => {
  const dep = { principal: 10000, rate: 6, startDate: '2026-01-01', termMonths: 12, compounding: 'monthly' };
  const v = C.depositValue(dep, '2027-01-01');
  close(v.value, 10000 * Math.pow(1.005, 12), 0.05);
});

test('impliedRate round-trips the interest amount', () => {
  for (const compounding of ['simple', 'monthly', 'quarterly', 'annually']) {
    const rate = C.impliedRate(50000, 1500, '2026-03-01', 6, compounding);
    const v = C.depositValue({ principal: 50000, rate, startDate: '2026-03-01', termMonths: 6, compounding }, '2026-09-01');
    close(v.maturityInterest, 1500);
  }
});

test('amortizing loan balance matches the standard formula', () => {
  // 300k, 4% over 30y -> payment ~1432.25
  const loan = { mode: 'amortizing', principal: 300000, rate: 4, payment: 1432.25, startDate: '2026-01-01' };
  close(C.loanBalance(loan, '2026-01-20').balance, 300000);
  const after12 = C.loanBalance(loan, '2027-01-01');
  assert.equal(after12.paymentsMade, 12);
  close(after12.balance, 294716.6, 1);
  assert.equal(C.loanBalance(loan, '2026-01-01').monthsLeft, 360);
  assert.equal(C.loanBalance({ ...loan, payment: 900 }, '2027-01-01').monthsLeft, Infinity);
  assert.equal(C.loanBalance({ mode: 'manual', balance: 1200 }, '2027-01-01').balance, 1200);
  assert.equal(C.loanBalance({ ...loan, startDate: '1980-01-01' }, '2027-01-01').balance, 0);
});

test('other assets depreciate over time', () => {
  close(C.otherAssetValue({ value: 20000, annualChangePct: -10, valueDate: '2025-01-01' }, '2026-01-01'), 18000, 1);
  assert.equal(C.otherAssetValue({ value: 500 }, '2030-01-01'), 500);
});

test('property uses latest valuation and flags stale values', () => {
  const p = { purchasePrice: 400000, purchaseDate: '2020-01-01', updateFrequency: 'weekly', valuations: [{ date: '2026-01-01', value: 450000 }, { date: '2026-02-01', value: 460000 }] };
  const v = C.propertyValue(p, '2026-02-05');
  assert.equal(v.value, 460000);
  assert.equal(v.gain, 60000);
  assert.equal(v.stale, false);
  assert.equal(C.propertyValue(p, '2026-02-20').stale, true);
  assert.equal(C.propertyValue({ ...p, valuations: [] }, '2026-02-20').value, 400000);
});

test('holdings: live price, manual fallback, P&L', () => {
  const live = C.holdingValue({ quantity: 10, avgCost: 100, lastPrice: 120, prevClose: 118 });
  assert.equal(live.marketValue, 1200);
  assert.equal(live.pnl, 200);
  close(live.pnlPct, 0.2);
  assert.equal(live.dayChange, 20);
  const manual = C.holdingValue({ quantity: 10, avgCost: 100, manualPrice: 90 });
  assert.equal(manual.pnl, -100);
  assert.equal(manual.live, false);
});

test('cash flow normalisation and occurrences', () => {
  close(C.monthlyAmount({ amount: 120, frequency: 'yearly' }), 10);
  close(C.monthlyAmount({ amount: 100, frequency: 'weekly' }), 433.33);
  assert.equal(C.monthlyAmount({ amount: 100, frequency: 'once' }), 0);
  const cf = { amount: 10, frequency: 'monthly', nextDate: '2026-01-31' };
  assert.deepEqual(C.occurrences(cf, '2026-02-01', '2026-04-30'), ['2026-02-28', '2026-03-31', '2026-04-30']);
  assert.equal(C.nextOccurrence({ frequency: 'weekly', nextDate: '2026-01-01' }, '2026-01-10'), '2026-01-15');
  assert.equal(C.nextOccurrence({ frequency: 'once', nextDate: '2026-01-01' }, '2026-01-10'), null);
});

test('history upsert replaces same day and trims', () => {
  let h = C.upsertHistory([], { date: '2026-01-02', netWorth: 1 });
  h = C.upsertHistory(h, { date: '2026-01-01', netWorth: 0 });
  h = C.upsertHistory(h, { date: '2026-01-02', netWorth: 2 }, 2);
  assert.deepEqual(h.map((x) => [x.date, x.netWorth]), [['2026-01-01', 0], ['2026-01-02', 2]]);
  assert.equal(C.upsertHistory(h, { date: '2026-01-03', netWorth: 3 }, 2).length, 2);
});

test('summarize totals across currencies and categories', () => {
  const state = {
    settings: { baseCurrency: 'USD' },
    fx: { base: 'USD', rates: { USD: 1, HKD: 8 } },
    accounts: [{ balance: 800, currency: 'HKD' }, { balance: 900, currency: 'USD' }],
    stocks: [{ quantity: 10, avgCost: 10, lastPrice: 15, prevClose: 14, currency: 'USD' }],
    crypto: [],
    deposits: [{ principal: 1000, rate: 0, startDate: '2026-01-01', termMonths: 12, currency: 'USD', compounding: 'simple' }],
    properties: [],
    others: [{ value: 100, currency: 'XYZ' }],
    liabilities: [{ mode: 'manual', balance: 500, currency: 'USD', payment: 50 }],
    cashflows: [
      { kind: 'income', amount: 3000, frequency: 'monthly', currency: 'USD', nextDate: '2026-02-01' },
      { kind: 'expense', amount: 1000, frequency: 'monthly', currency: 'USD', nextDate: '2026-02-10' },
      { kind: 'subscription', amount: 120, frequency: 'yearly', currency: 'USD', nextDate: '2026-12-01', active: false },
    ],
    goals: [],
  };
  const s = C.summarize(state, '2026-01-20');
  assert.equal(s.totals.cash, 1000);
  assert.equal(s.totals.stocks, 150);
  assert.equal(s.totals.deposits, 1000);
  assert.equal(s.assets, 2150);
  assert.equal(s.liabilities, 500);
  assert.equal(s.netWorth, 1650);
  assert.equal(s.investPnl, 50);
  assert.equal(s.dayChange, 10);
  assert.equal(s.netMonthly, 2000);
  close(s.savingsRate, 2 / 3);
  close(s.runwayMonths, 1);
  assert.equal(s.flow.subscription, 0);
  assert.equal(s.events.length, 2);
  assert.ok(s.alerts.some((a) => a.text.includes('XYZ')));
});

test('deposit with an explicit end date', () => {
  const v = C.depositValue({ principal: 1000, rate: 3.65, startDate: '2026-01-01', endDate: '2026-04-11', compounding: 'simple' }, '2026-02-01');
  assert.equal(v.maturityDate, '2026-04-11');
  assert.equal(v.termDays, 100);
  assert.equal(v.termMonths, 3);
  close(v.maturityInterest, 10);
  close(C.impliedRate(1000, 10, '2026-01-01', 0, 'simple', '2026-04-11'), 3.65);
});

const fdState = (extra = {}) => ({
  settings: { baseCurrency: 'HKD' },
  fx: { base: 'HKD', rates: { HKD: 1, GBP: 0.1 } },
  accounts: [],
  deposits: [{ id: 'd1', platform: 'HSBC HK', currency: 'HKD', principal: 10000, rate: 4, startDate: '2026-01-01', termMonths: 12, compounding: 'simple', onMaturity: 'cash', ...extra }],
  deleted: {},
});

test('matured deposit moves capital + interest to an auto cash account', () => {
  const s = fdState();
  assert.equal(C.settleDeposits(s, '2026-12-31', 1).length, 0);
  const log = C.settleDeposits(s, '2027-01-01', 5);
  assert.equal(log.length, 1);
  assert.equal(s.deposits.length, 0);
  assert.equal(s.accounts.length, 1);
  assert.equal(s.accounts[0].id, 'auto-hsbc-hk');
  assert.equal(s.accounts[0].name, 'HSBC HK');
  assert.deepEqual(s.accounts[0].balances, [{ currency: 'HKD', amount: 10400 }]);
  assert.equal(s.deleted.d1, 5);
  assert.equal(s.activity[0].kind, 'deposit-cash');
  assert.equal(C.settleDeposits(s, '2027-02-01', 6).length, 0); // idempotent
});

test('matured deposit pays into the matching currency of a multi-currency account', () => {
  const s = fdState({ payoutAccountId: 'a1' });
  s.accounts.push({ id: 'a1', name: 'HSBC One', balances: [{ currency: 'USD', amount: 50 }, { currency: 'HKD', amount: 100 }] });
  C.settleDeposits(s, '2027-01-05', 1);
  assert.deepEqual(s.accounts[0].balances, [{ currency: 'USD', amount: 50 }, { currency: 'HKD', amount: 10500 }]);
  // An account without that currency gains a new balance line instead of converting.
  const t = fdState({ payoutAccountId: 'a1' });
  t.accounts.push({ id: 'a1', name: 'Monzo', currency: 'GBP', balance: 100 }); // legacy shape
  C.settleDeposits(t, '2027-01-05', 1);
  assert.deepEqual(t.accounts[0].balances, [{ currency: 'GBP', amount: 100 }, { currency: 'HKD', amount: 10400 }]);
  assert.equal(t.accounts[0].balance, undefined);
});

test('without a chosen account, a deposit pays into an account on the same platform', () => {
  const s = fdState();
  s.accounts.push({ id: 'x', name: 'Other bank', platform: 'Monzo', balances: [{ currency: 'HKD', amount: 0 }] });
  s.accounts.push({ id: 'h1', name: 'HSBC One', platform: 'HSBC HK', balances: [{ currency: 'USD', amount: 1 }] });
  s.accounts.push({ id: 'h2', name: 'HSBC Savings', platform: 'HSBC HK', balances: [{ currency: 'HKD', amount: 5 }] });
  C.settleDeposits(s, '2027-01-05', 1);
  assert.equal(s.accounts.length, 3);
  assert.deepEqual(s.accounts[2].balances, [{ currency: 'HKD', amount: 10405 }]); // prefers the one holding HKD
});

test('multi-currency accounts: migration, totals and cash by currency', () => {
  const state = C.migrateAccounts({
    settings: { baseCurrency: 'HKD' },
    fx: { base: 'HKD', rates: { HKD: 1, USD: 0.125, GBP: 0.1 } },
    accounts: [
      { id: 'a', name: 'HSBC One', platform: 'HSBC HK', balances: [{ currency: 'HKD', amount: 1000 }, { currency: 'USD', amount: 100 }] },
      { id: 'b', name: 'Monzo', platform: 'Monzo', currency: 'GBP', balance: 50 },
      { id: 'c', name: 'Wise', platform: 'Wise', balances: [{ currency: 'USD', amount: 45 }, { currency: 'HKD', amount: 0 }] },
    ],
  });
  assert.deepEqual(state.accounts[1].balances, [{ currency: 'GBP', amount: 50 }]);
  assert.equal(state.accounts[1].currency, undefined);
  const s = C.summarize(state, '2026-01-01');
  assert.equal(s.totals.cash, 1000 + 800 + 500 + 360);
  const byCur = C.cashByCurrency(state);
  assert.deepEqual(byCur.map((r) => [r.currency, r.amount, r.base]), [['USD', 145, 1160], ['HKD', 1000, 1000], ['GBP', 50, 500]]);
  assert.deepEqual(byCur[0].accounts.map((a) => [a.name, a.amount]), [['HSBC One', 100], ['Wise', 45]]);
  close(byCur[2].share, 500 / 2660);
  const hsbc = C.platformBreakdown(state, '2026-01-01').platforms.find((p) => p.name === 'HSBC HK');
  assert.equal(hsbc.cash, 1800);
  assert.deepEqual(hsbc.currencies, ['HKD', 'USD']);
  assert.equal(hsbc.regionGuessed, false); // two currencies -> no guess
});

test('renewing deposits roll over repeatedly with deterministic ids', () => {
  const s = fdState({ onMaturity: 'renew', termMonths: 6 });
  const log = C.settleDeposits(s, '2027-02-01', 1);
  assert.equal(log.length, 2); // matured Jul 2026 and Jan 2027
  assert.equal(s.deposits.length, 1);
  assert.equal(s.deposits[0].id, 'd1rr');
  assert.equal(s.deposits[0].startDate, '2027-01-01');
  assert.ok(s.deposits[0].principal > 10390);
});

test('legacy platform fields migrate to `platform`', () => {
  const s = C.migratePlatforms({ accounts: [{ institution: 'HSBC' }], stocks: [{ broker: 'Futu' }], crypto: [{ wallet: 'Ledger' }], deposits: [{ bank: 'ZA' }] });
  assert.deepEqual([s.accounts[0].platform, s.stocks[0].platform, s.crypto[0].platform, s.deposits[0].platform], ['HSBC', 'Futu', 'Ledger', 'ZA']);
  assert.equal(s.accounts[0].institution, undefined);
});

test('platform and region breakdown', () => {
  const state = {
    settings: { baseCurrency: 'HKD' },
    fx: { base: 'HKD', rates: { HKD: 1, GBP: 0.1 } },
    platformMeta: { Monzo: { region: 'United Kingdom' } },
    accounts: [{ platform: 'HSBC HK', balance: 1000, currency: 'HKD' }, { platform: 'Monzo', balance: 100, currency: 'GBP' }, { balance: 5, currency: 'HKD' }],
    stocks: [{ platform: 'HSBC HK', quantity: 1, avgCost: 500, currency: 'HKD' }],
    liabilities: [{ platform: 'Monzo', mode: 'manual', balance: 50, currency: 'GBP' }],
  };
  const { platforms, regions } = C.platformBreakdown(state, '2026-01-01');
  const hsbc = platforms.find((p) => p.name === 'HSBC HK');
  assert.equal(hsbc.net, 1500);
  assert.equal(hsbc.region, 'Hong Kong');
  assert.equal(hsbc.regionGuessed, true);
  const monzo = platforms.find((p) => p.name === 'Monzo');
  assert.equal(monzo.debt, 500);
  assert.equal(monzo.net, 500);
  assert.equal(monzo.regionGuessed, false);
  assert.deepEqual(regions.map((r) => [r.region, r.net]), [['Hong Kong', 1500], ['United Kingdom', 500], ['', 5]]);
});

test('recorded spending replaces estimated spending and skips card-paid bills', () => {
  const base = {
    settings: { baseCurrency: 'HKD' },
    fx: { base: 'HKD', rates: { HKD: 1, GBP: 0.1 } },
    accounts: [{ balance: 30000, currency: 'HKD' }],
    cashflows: [
      { kind: 'income', amount: 20000, frequency: 'monthly', currency: 'HKD', nextDate: '2026-01-01' },
      { kind: 'expense', name: 'Rent', amount: 8000, frequency: 'monthly', currency: 'HKD', nextDate: '2026-01-01' },
      { kind: 'subscription', name: 'Netflix', amount: 100, frequency: 'monthly', currency: 'HKD', nextDate: '2026-01-01', onCard: true },
    ],
  };
  const est = C.summarize({ ...base, spending: [] }, '2026-05-10');
  assert.equal(est.spendingSource, 'estimate');
  assert.equal(est.spending, 8100);
  const spending = [
    { month: '2026-04', amount: 5000, currency: 'HKD' }, { month: '2026-04', amount: 100, currency: 'GBP' },
    { month: '2026-03', amount: 4000, currency: 'HKD' },
    { month: '2026-02', amount: 3000, currency: 'HKD' },
    { month: '2026-01', amount: 99999, currency: 'HKD' }, // older than the 3-month window
  ];
  const act = C.summarize({ ...base, spending }, '2026-05-10');
  assert.equal(act.spendingSource, 'actual');
  assert.equal(act.spendMonths[0].total, 6000);
  close(act.cardSpendAvg, 13000 / 3);
  close(act.spending, 13000 / 3 + 8000); // rent isn't on the card; Netflix is
  close(act.netMonthly, 20000 - act.spending);
});

test('items without a platform never get a guessed region', () => {
  const { platforms } = C.platformBreakdown({ settings: { baseCurrency: 'HKD' }, fx: { base: 'HKD', rates: { HKD: 1 } }, accounts: [{ balance: 1, currency: 'HKD' }] }, '2026-01-01');
  assert.equal(platforms[0].region, '');
});

test('deposits are linked to a bank account and follow its platform', () => {
  const s = {
    accounts: [
      { id: 'one', name: 'HSBC One', platform: 'HSBC HK', balances: [{ currency: 'USD', amount: 1 }] },
      { id: 'sav', name: 'HSBC Savings', platform: 'HSBC HK', balances: [{ currency: 'HKD', amount: 1 }] },
    ],
    deposits: [
      { id: 'a', platform: 'HSBC HK', currency: 'HKD' },          // legacy: matched by platform + currency
      { id: 'b', platform: 'ZA Bank', currency: 'HKD' },          // no account yet -> one is created
      { id: 'c', accountId: 'one', platform: 'Old name', currency: 'HKD' }, // platform follows the account
    ],
  };
  C.linkDeposits(s);
  assert.deepEqual(s.deposits.map((d) => [d.accountId, d.platform]), [['sav', 'HSBC HK'], ['auto-za-bank', 'ZA Bank'], ['one', 'HSBC HK']]);
  assert.equal(s.accounts[2].name, 'ZA Bank');
  C.linkDeposits(s);
  assert.equal(s.accounts.length, 3); // idempotent
});

test('a matured deposit returns to the account it is held in', () => {
  const s = fdState({ accountId: 'h' });
  s.accounts.push({ id: 'x', name: 'Other HSBC', platform: 'HSBC HK', balances: [{ currency: 'HKD', amount: 0 }] });
  s.accounts.push({ id: 'h', name: 'HSBC One', platform: 'HSBC HK', balances: [] });
  const [entry] = C.settleDeposits(s, '2027-01-05', 1);
  assert.deepEqual(s.accounts[1].balances, [{ currency: 'HKD', amount: 10400 }]);
  assert.equal(entry.accountId, 'h');
  assert.equal(entry.heldIn, 'h');
});

test('saver interest is estimated daily on top of the confirmed balance', () => {
  const line = { currency: 'GBP', amount: 10000, rate: 3.65, asOf: '2026-01-01' };
  const v = C.balanceValue(line, '2026-01-11');
  close(v.accrued, 10);
  close(v.value, 10010);
  close(v.daily, 1);
  assert.equal(C.balanceValue({ amount: 5 }, '2026-01-11').value, 5); // no rate, no interest
  const state = {
    settings: { baseCurrency: 'GBP' }, fx: { base: 'GBP', rates: { GBP: 1 } },
    accounts: [{ id: 'a', balances: [line] }],
  };
  const s = C.summarize(state, '2026-01-11');
  close(s.totals.cash, 10010);
  close(s.saverDaily, 1);
  close(s.interestDaily, 1);
  close(s.passiveMonthly, 365 / 12);
});

test('app-made changes keep the interest estimated so far', () => {
  const acct = { id: 'a', balances: [{ currency: 'GBP', amount: 10000, rate: 3.65, asOf: '2026-01-01' }] };
  C.adjustLine(acct, 'GBP', -1000, '2026-01-11');
  assert.deepEqual(acct.balances[0], { currency: 'GBP', amount: 9000, rate: 3.65, asOf: '2026-01-11', carry: 10 });
  close(C.balanceValue(acct.balances[0], '2026-01-21').value, 9000 + 10 + 9);
  C.adjustLine(acct, 'USD', 50, '2026-01-11');
  assert.deepEqual(acct.balances[1], { currency: 'USD', amount: 50 });
});

test('pending payments: linked, non-card items from their tracking date; card bills when due', () => {
  const state = {
    accounts: [{ id: 'hsbc', name: 'HSBC One', updatedAt: '2026-01-01', balances: [{ currency: 'HKD', amount: 50000 }] }],
    cashflows: [
      { id: 'rent', name: 'Rent', kind: 'expense', amount: 18000, currency: 'HKD', frequency: 'monthly', nextDate: '2025-12-01', accountId: 'hsbc', trackFrom: '2026-01-15' },
      { id: 'pay', name: 'Salary', kind: 'income', amount: 60000, currency: 'HKD', frequency: 'monthly', nextDate: '2026-01-25', accountId: 'hsbc', trackFrom: '2026-01-15' },
      { id: 'nf', name: 'Netflix', kind: 'subscription', amount: 93, currency: 'HKD', frequency: 'monthly', nextDate: '2026-01-02', accountId: 'hsbc', onCard: true, trackFrom: '2026-01-01' },
      { id: 'free', name: 'Unlinked', kind: 'expense', amount: 1, currency: 'HKD', frequency: 'weekly', nextDate: '2026-01-01' },
    ],
    spending: [
      { id: 'amex', month: '2026-01', platform: 'Amex', amount: 9000, currency: 'HKD', payFromAccountId: 'hsbc', dueDate: '2026-02-20' },
      { id: 'old', month: '2025-12', platform: 'Visa', amount: 1, currency: 'HKD', payFromAccountId: 'hsbc', dueDate: '2026-01-20', paidOn: '2026-01-20' },
    ],
    activity: [],
  };
  const p = C.pendingPayments(state, '2026-02-20');
  assert.deepEqual(p.map((x) => x.sign), [1, -1, -1]);
  assert.deepEqual(p.map((x) => x.key), ['cf:pay:2026-01-25', 'cf:rent:2026-02-01', 'card:amex']);
  // Confirm salary, dismiss rent ("already included"), pay the card bill with a different amount.
  C.resolvePayment(state, p[0], true, 60000, 1);
  C.resolvePayment(state, p[1], false, 0, 1);
  C.resolvePayment(state, p[2], true, 8950, 1);
  assert.equal(state.accounts[0].balances[0].amount, 50000 + 60000 - 8950);
  assert.deepEqual(C.pendingPayments(state, '2026-02-20'), []);
  assert.equal(state.cashflows[0].lastHandled, '2026-02-01');
  assert.equal(state.spending[0].paidOn, '2026-02-20');
  assert.deepEqual(state.activity.map((a) => [a.kind, a.amount]), [['payment', -8950], ['payment', 60000]]);
  assert.deepEqual(C.pendingPayments(state, '2026-03-01').map((x) => x.key), ['cf:pay:2026-02-25', 'cf:rent:2026-03-01']); // next ones come back
});

test('transfers move money between own accounts and currencies', () => {
  const state = {
    accounts: [
      { id: 'a', name: 'HSBC One', balances: [{ currency: 'HKD', amount: 1000 }] },
      { id: 'b', name: 'Monzo', balances: [{ currency: 'GBP', amount: 10 }] },
    ],
    activity: [],
  };
  C.transfer(state, { id: 't1', fromId: 'a', fromCurrency: 'HKD', amount: 500, toId: 'b', toCurrency: 'GBP', received: 49.5, date: '2026-01-05' }, 1);
  assert.equal(state.accounts[0].balances[0].amount, 500);
  assert.equal(state.accounts[1].balances[0].amount, 59.5);
  C.transfer(state, { id: 't2', fromId: 'a', fromCurrency: 'HKD', amount: 100, toId: 'a', toCurrency: 'USD', received: 12.8, date: '2026-01-05' }, 1);
  assert.deepEqual(state.accounts[0].balances, [{ currency: 'HKD', amount: 400 }, { currency: 'USD', amount: 12.8 }]);
  assert.equal(state.activity[0].kind, 'transfer');
});

test('monthly check-in is due once per month', () => {
  const state = { accounts: [{ id: 'a' }], activity: [] };
  assert.equal(C.checkinDue(state, '2026-03-01'), true);
  C.recordCheckin(state, '2026-03-01', false, 1);
  assert.equal(C.checkinDue(state, '2026-03-31'), false);
  assert.equal(C.checkinDue(state, '2026-04-01'), true);
  assert.equal(C.checkinDue({ accounts: [], activity: [] }, '2026-04-01'), false);
});
