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
  assert.equal(s.netMonthly, 1950); // 3000 income − 1000 bills − 50 loan repayment
  close(s.savingsRate, 1950 / 3000);
  close(s.runwayMonths, 1000 / 1050);
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
  assert.deepEqual(state.activity.map((a) => [a.outcome, a.amount]), [['applied', -8950], ['included', -0], ['applied', 60000]]);
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

test('card due date is the due day in the month after the statement month', () => {
  assert.equal(C.cardDueDate({ dueDay: 25 }, '2026-09'), '2026-10-25');
  assert.equal(C.cardDueDate({ dueDay: 31 }, '2026-01'), '2026-02-28');
  assert.equal(C.cardDueDate({ dueDay: 5 }, '2026-12'), '2027-01-05');
  assert.equal(C.cardDueDate({}, '2026-09'), null);
});

test('older spending records get a card for their name', () => {
  const s = { cards: [], spending: [
    { id: '1', month: '2026-08', platform: 'Amex', amount: 1, currency: 'HKD', dueDate: '2026-09-20', payFromAccountId: 'hsbc' },
    { id: '2', month: '2026-09', platform: 'Amex', amount: 2, currency: 'HKD' },
    { id: '3', month: '2026-09', platform: 'HSBC Red', amount: 3, currency: 'HKD' },
  ] };
  C.linkCards(s);
  assert.deepEqual(s.cards.map((c) => [c.id, c.name, c.dueDay, c.payFromAccountId]), [['card-amex', 'Amex', 20, 'hsbc'], ['card-hsbc-red', 'HSBC Red', null, '']]);
  assert.deepEqual(s.spending.map((e) => e.cardId), ['card-amex', 'card-amex', 'card-hsbc-red']);
  s.cards[0].name = 'Amex Platinum';
  C.linkCards(s);
  assert.equal(s.spending[1].platform, 'Amex Platinum'); // records follow a renamed card
  assert.equal(s.cards.length, 2);
});

test('unpaid card bills are debt and show in the next 30 days until paid', () => {
  const state = {
    settings: { baseCurrency: 'HKD' }, fx: { base: 'HKD', rates: { HKD: 1 } },
    accounts: [{ id: 'hsbc', name: 'HSBC One', balances: [{ currency: 'HKD', amount: 50000 }] }],
    cards: [{ id: 'red', name: 'HSBC Red', platform: 'HSBC HK', dueDay: 25, payFromAccountId: 'hsbc' }, { id: 'amex', name: 'Amex', dueDay: 10 }],
    spending: [
      { id: 'a', cardId: 'red', platform: 'HSBC Red', month: '2026-09', amount: 12000, currency: 'HKD', dueDate: '2026-10-25' },
      { id: 'b', cardId: 'amex', platform: 'Amex', month: '2026-10', amount: 3000, currency: 'HKD', dueDate: '2026-11-10' },
      { id: 'c', cardId: 'amex', platform: 'Amex', month: '2026-08', amount: 999, currency: 'HKD', dueDate: '2026-09-10', paidOn: '2026-09-10' },
      { id: 'd', cardId: 'amex', platform: 'Amex', month: '2026-07', amount: 500, currency: 'HKD' }, // no due date: not tracked
    ],
    activity: [],
  };
  const s = C.summarize(state, '2026-10-27');
  assert.equal(s.cardOwed, 15000);
  assert.equal(s.liabilities, 15000);
  assert.equal(s.netWorth, 50000 - 15000);
  assert.deepEqual(s.events.filter((e) => e.kind === 'card').map((e) => [e.label, e.overdue]), [['HSBC Red bill', true], ['Amex bill', false]]);
  assert.equal(s.events[0].kind, 'card'); // overdue goes first
  const hsbc = C.platformBreakdown(state, '2026-10-27').platforms.find((p) => p.name === 'HSBC HK');
  assert.equal(hsbc.debt, 12000);
  // Due bills ask for confirmation: from the card's usual account, or just "mark paid" without one.
  const p = C.pendingPayments(state, '2026-11-10');
  assert.deepEqual(p.map((x) => [x.key, x.accountId]), [['card:a', 'hsbc'], ['card:b', null]]);
  C.resolvePayment(state, p[0], true, 12000, 1);
  C.resolvePayment(state, p[1], false, 0, 1);
  const after = C.summarize(state, '2026-11-10');
  assert.equal(after.cardOwed, 0);
  assert.equal(state.accounts[0].balances[0].amount, 38000);
  assert.equal(after.netWorth, 38000); // paying a bill doesn't change net worth: cash and debt both drop
});

test('next 30 days: overdue card bills first, then everything by date', () => {
  const state = {
    settings: { baseCurrency: 'HKD' }, fx: { base: 'HKD', rates: { HKD: 1 } },
    cards: [{ id: 'red', name: 'HSBC Red' }, { id: 'mz', name: 'Monzo' }],
    spending: [
      { id: 'a', cardId: 'red', platform: 'HSBC Red', month: '2026-09', amount: 1, currency: 'HKD', dueDate: '2026-10-28' },
      { id: 'b', cardId: 'mz', platform: 'Monzo', month: '2026-09', amount: 1, currency: 'HKD', dueDate: '2026-10-15' },
    ],
    cashflows: [
      { id: 'r', name: 'Rent', kind: 'expense', amount: 1, currency: 'HKD', frequency: 'monthly', nextDate: '2026-11-05' },
      { id: 'g', name: 'Groceries', kind: 'expense', amount: 1, currency: 'HKD', frequency: 'once', nextDate: '2026-10-29' },
    ],
  };
  const ev = C.summarize(state, '2026-10-27').events.map((e) => `${e.date} ${e.label}`);
  assert.deepEqual(ev, ['2026-10-15 Monzo bill', '2026-10-28 HSBC Red bill', '2026-10-29 Groceries', '2026-11-05 Rent']);
});

test('loan repayments count in spending once, even when also entered as a bill', () => {
  const base = {
    settings: { baseCurrency: 'GBP' }, fx: { base: 'GBP', rates: { GBP: 1 } },
    accounts: [{ id: 'a', balances: [{ currency: 'GBP', amount: 10000 }] }],
    liabilities: [
      { id: 'mort', name: 'Mortgage', type: 'mortgage', mode: 'manual', balance: 100000, payment: 990, currency: 'GBP' },
      { id: 'car', name: 'Car loan', type: 'car', mode: 'manual', balance: 5000, payment: 200, currency: 'GBP' },
      { id: 'cc', name: 'Card', type: 'credit', mode: 'manual', balance: 300, payment: 300, currency: 'GBP' }, // card debt: not a repayment plan
      { id: 'done', name: 'Paid off', type: 'personal', mode: 'manual', balance: 0, payment: 100, currency: 'GBP' },
    ],
    cashflows: [
      { id: 'inc', name: 'Salary', kind: 'income', amount: 4000, currency: 'GBP', frequency: 'monthly', nextDate: '2026-11-01' },
      { id: 'mbill', name: 'Mortgage payment', kind: 'expense', amount: 990, currency: 'GBP', frequency: 'monthly', nextDate: '2026-11-01' }, // auto-matched
      { id: 'rent', name: 'Storage', kind: 'expense', amount: 200, currency: 'GBP', frequency: 'monthly', nextDate: '2026-11-01', notLoan: true }, // same as car loan, but marked "not a loan"
      { id: 'nf', name: 'Netflix', kind: 'subscription', amount: 10, currency: 'GBP', frequency: 'monthly', nextDate: '2026-11-01', onCard: true },
      { id: 'sav', name: 'ISA', kind: 'saving', amount: 500, currency: 'GBP', frequency: 'monthly', nextDate: '2026-11-01' },
    ],
  };
  const s = C.summarize(base, '2026-10-27');
  assert.deepEqual(s.loanMatches, [{ cashflowId: 'mbill', loanId: 'mort', linked: false }]);
  assert.equal(s.loanRepayments, 1190); // mortgage + car; card debt and paid-off loan excluded
  assert.equal(s.billsMonthly, 210); // storage + Netflix; the matched mortgage bill isn't counted again
  assert.equal(s.spending, 210 + 1190);
  assert.deepEqual(s.split, { bills: 200, card: 10, loans: 1190, saving: 500, unallocated: 4000 - 200 - 10 - 1190 - 500 });
  assert.equal(s.fixedCosts, 1400);
  close(s.fixedPct, 1400 / 4000);
  assert.equal(s.flexibleCosts, null); // unknown until card statements are recorded

  // With card statements: card spending is actual, flexible = card spending minus card-paid bills.
  const withCards = { ...base, spending: [
    { month: '2026-09', amount: 1010, currency: 'GBP' },
    { month: '2026-08', amount: 810, currency: 'GBP' },
  ] };
  const t = C.summarize(withCards, '2026-10-27');
  assert.equal(t.split.card, 910);
  assert.equal(t.flexibleCosts, 900);
  assert.equal(t.spending, 910 + 200 + 1190);
  assert.deepEqual(t.history.map((h) => [h.month, h.card, h.spending, h.net]), [['2026-08', 810, 2200, 1800], ['2026-09', 1010, 2400, 1600]]);

  // An explicit link works even when the amounts differ.
  const linked = { ...base, cashflows: base.cashflows.map((c) => (c.id === 'mbill' ? { ...c, amount: 1000, loanId: 'mort' } : c)) };
  assert.deepEqual(C.summarize(linked, '2026-10-27').loanMatches, [{ cashflowId: 'mbill', loanId: 'mort', linked: true }]);
});

test('interest counts as average monthly income; renewing deposits also count as saving', () => {
  const base = {
    settings: { baseCurrency: 'HKD' }, fx: { base: 'HKD', rates: { HKD: 1 } },
    accounts: [
      { id: 'sav', name: 'Saver', balances: [{ currency: 'HKD', amount: 120000, rate: 3, asOf: '2026-10-01' }] }, // 300/mo
      { id: 'cur', name: 'Current', balances: [{ currency: 'HKD', amount: 50000 }] },
    ],
    deposits: [
      { id: 'cash', accountId: 'cur', principal: 120000, rate: 5, startDate: '2026-06-01', termMonths: 12, compounding: 'simple', currency: 'HKD', onMaturity: 'cash' }, // 500/mo
      { id: 'roll', accountId: 'cur', principal: 60000, rate: 4, startDate: '2026-06-01', termMonths: 12, compounding: 'simple', currency: 'HKD', onMaturity: 'renew' }, // 200/mo
      { id: 'old', accountId: 'cur', principal: 99999, rate: 9, startDate: '2025-01-01', termMonths: 6, compounding: 'simple', currency: 'HKD', onMaturity: 'keep' }, // matured: no interest
    ],
    cashflows: [
      { id: 'pay', name: 'Salary', kind: 'income', amount: 10000, currency: 'HKD', frequency: 'monthly', nextDate: '2026-11-01' },
      { id: 'rent', name: 'Rent', kind: 'expense', amount: 6000, currency: 'HKD', frequency: 'monthly', nextDate: '2026-11-01' },
      { id: 'ins', name: 'Insurance', kind: 'expense', amount: 1200, currency: 'HKD', frequency: 'yearly', nextDate: '2027-03-01' }, // 100/mo
    ],
  };
  const s = C.summarize(base, '2026-10-27');
  close(s.interest.fdCash, 500, 0.5);
  close(s.interest.fdRenew, 200, 0.5);
  close(s.interest.saver, 300, 0.5);
  close(s.incomeTotal, 11000, 1.5);
  assert.equal(s.flow.income, 10000); // regular income items stay separate
  close(s.spending, 6100);
  close(s.netMonthly, 11000 - 6100, 1.5);
  close(s.savingsRate, (11000 - 6100) / 11000, 0.001);
  close(s.split.saving, 200, 0.5); // the renewing deposit's interest stays saved
  close(s.split.unallocated, 11000 - 6100 - 200, 1.5);

  // A saver's interest already entered as an income item (linked + named "interest") isn't added twice.
  const entered = { ...base, cashflows: [...base.cashflows, { id: 'si', name: 'Saver interest', kind: 'income', amount: 300, currency: 'HKD', frequency: 'monthly', nextDate: '2026-11-01', accountId: 'sav' }] };
  const t = C.summarize(entered, '2026-10-27');
  assert.equal(t.interest.saver, 0);
  assert.deepEqual(t.interest.skippedAccounts, ['sav']);
  close(t.incomeTotal, 11000, 1.5);
});

test('property rent is the single source of rent income; a matching income item counts once', () => {
  const base = {
    settings: { baseCurrency: 'GBP' }, fx: { base: 'GBP', rates: { GBP: 1 } },
    properties: [
      { id: 'flat', name: 'Flat', currency: 'GBP', purchasePrice: 1, monthlyRent: 1150, valuations: [{ date: '2026-10-01', value: 1 }] },
      { id: 'garage', name: 'Garage', currency: 'GBP', purchasePrice: 1, monthlyRent: 100, valuations: [{ date: '2026-10-01', value: 1 }] },
    ],
    cashflows: [
      { id: 'pay', name: 'Salary', kind: 'income', amount: 3000, currency: 'GBP', frequency: 'monthly', nextDate: '2026-11-01' },
      { id: 'rf', name: 'Rent from flat', kind: 'income', amount: 1150, currency: 'GBP', frequency: 'monthly', nextDate: '2026-11-01' }, // same as the flat's rent
    ],
  };
  const s = C.summarize(base, '2026-10-27');
  assert.deepEqual(s.rentMatches, [{ cashflowId: 'rf', propertyId: 'flat', linked: false }]);
  assert.equal(s.flow.income, 3000);
  assert.equal(s.rentMonthly, 1250);
  assert.equal(s.incomeTotal, 4250); // salary + both rents, the flat's rent once
  assert.equal(s.passiveMonthly, 1250);
  // "Not the same": the item counts as separate income.
  const unmatched = { ...base, cashflows: base.cashflows.map((c) => (c.id === 'rf' ? { ...c, notRent: true } : c)) };
  assert.equal(C.summarize(unmatched, '2026-10-27').incomeTotal, 5400);
});

test('dividends: per share or yield; reinvested ones also count as saving', () => {
  assert.equal(C.dividendPerYear({ quantity: 200, divMode: 'perShare', dividendPerShare: 3.4 }), 680);
  assert.equal(C.dividendPerYear({ quantity: 10, lastPrice: 100, divMode: 'yield', dividendYield: 4 }), 40);
  assert.equal(C.dividendPerYear({ quantity: 10, lastPrice: 100 }), 0);
  const state = {
    settings: { baseCurrency: 'HKD' }, fx: { base: 'HKD', rates: { HKD: 1, USD: 0.125 } },
    stocks: [
      { id: 'tc', quantity: 200, avgCost: 300, manualPrice: 450, currency: 'HKD', source: 'manual', divMode: 'perShare', dividendPerShare: 3.6 }, // 720/yr = 60/mo
      { id: 'voo', quantity: 10, avgCost: 400, lastPrice: 600, currency: 'USD', divMode: 'yield', dividendYield: 1.5, dividendReinvest: true }, // US$90/yr = HK$720/yr = 60/mo
    ],
    cashflows: [{ id: 'pay', name: 'Salary', kind: 'income', amount: 10000, currency: 'HKD', frequency: 'monthly', nextDate: '2026-11-01' }],
  };
  const s = C.summarize(state, '2026-10-27');
  close(s.dividends.cash, 60);
  close(s.dividends.reinvested, 60);
  close(s.incomeTotal, 10120);
  close(s.passiveMonthly, 120);
  close(s.split.saving, 60);
});

test('regular saver: £300 a month at 6.5% AER, interest daily and paid monthly', () => {
  const dep = { id: 'rs', kind: 'regular', currency: 'GBP', monthlyAmount: 300, rate: 6.5, startDate: '2026-01-15', termMonths: 12, trackFrom: '2026-01-15' };
  // Planned: 12 × £300 = £3,600 → about £3,725 (AER already includes the monthly compounding).
  const plan = C.regularSaverValue(dep, '2026-01-15');
  assert.equal(plan.plannedIn, 3600);
  assert.ok(plan.maturityInterest > 120 && plan.maturityInterest < 128, `interest ${plan.maturityInterest}`);
  close(plan.grossRate, 6.314, 0.001);
  assert.equal(plan.maturityDate, '2027-01-15');
  // Only confirmed payments count: two paid, the March one not yet confirmed.
  const v = C.regularSaverValue({ ...dep, paid: { '2026-01-15': 300, '2026-02-15': 300 }, lastHandled: '2026-02-15' }, '2026-03-20');
  assert.equal(v.paidIn, 600);
  // Interest is credited on the 15th: Jan 15 → Feb 15 on £300, Feb 15 → Mar 15 on £600 + Feb credit.
  const credits = v.history.filter((h) => h.kind === 'interest');
  assert.deepEqual(credits.map((h) => h.date), ['2026-02-15', '2026-03-15']);
  close(credits[0].amount, 300 * 0.06314 * 31 / 365, 0.01);
  assert.ok(v.interestThisPeriod > 0 && v.value > 600 + credits[0].amount + credits[1].amount);
  // A chosen interest day moves the credits.
  const firsts = C.regularSaverValue({ ...dep, interestDay: 1, trackFrom: '2026-12-31' }, '2026-04-02').history.filter((h) => h.kind === 'interest').map((h) => h.date);
  assert.deepEqual(firsts, ['2026-02-01', '2026-03-01', '2026-04-01']);
  // Before trackFrom, past payments are assumed made on schedule.
  assert.equal(C.regularSaverValue({ ...dep, trackFrom: '2026-04-01' }, '2026-04-01').paidIn, 900);
});

test('regular saver payments are confirmed, counted as saving once, and paid out at maturity', () => {
  const state = {
    settings: { baseCurrency: 'GBP' }, fx: { base: 'GBP', rates: { GBP: 1 } },
    accounts: [{ id: 'cur', name: 'Current', balances: [{ currency: 'GBP', amount: 5000 }] }],
    deposits: [{ id: 'rs', kind: 'regular', accountId: 'cur', currency: 'GBP', monthlyAmount: 300, rate: 6.5, startDate: '2026-09-10', termMonths: 12, trackFrom: '2026-09-10', payFromAccountId: 'cur', onMaturity: 'cash' }],
    cashflows: [
      { id: 'pay', name: 'Salary', kind: 'income', amount: 3000, currency: 'GBP', frequency: 'monthly', nextDate: '2026-11-01' },
      { id: 'sv', name: 'To regular saver', kind: 'saving', amount: 300, currency: 'GBP', frequency: 'monthly', nextDate: '2026-11-10', accountId: 'cur' },
    ],
    activity: [],
  };
  const pend = C.pendingPayments(state, '2026-10-27');
  assert.deepEqual(pend.map((p) => p.key), ['rs:rs:2026-09-10', 'rs:rs:2026-10-10']); // the matching saving item doesn't ask too
  C.resolvePayment(state, pend[0], true, 300, 1);
  C.resolvePayment(state, { ...pend[1], paidIn: false }, false, 300, 1); // not paid this month
  assert.equal(state.accounts[0].balances[0].amount, 4700);
  assert.deepEqual(state.deposits[0].paid, { '2026-09-10': 300 });
  assert.equal(C.pendingPayments(state, '2026-10-27').length, 0);
  const s = C.summarize(state, '2026-10-27');
  assert.deepEqual(s.saverMatches.map((m) => m.cashflowId), ['sv']);
  close(s.split.saving, 300); // once, not 600
  const v = C.depositValue(state.deposits[0], '2026-10-27');
  close(s.interest.fdCash, v.monthlyInterest);
  assert.equal(v.plannedIn, 3300); // October was skipped
  close(v.monthlyInterest, v.maturityInterest / 12);
  // At maturity, what's actually in the saver moves to the account.
  const done = C.settleDeposits(state, '2027-09-11', 2);
  assert.equal(done.length, 1);
  close(state.accounts[0].balances[0].amount, 4700 + done[0].amount);
  assert.ok(done[0].amount > 300 && done[0].amount < 320);
});

test('a payment in a currency the account does not hold comes out of a balance it does hold', () => {
  const acct = { id: 'hk', name: 'HSBC One', balances: [{ currency: 'USD', amount: 100 }, { currency: 'HKD', amount: 20000 }] };
  assert.equal(C.paymentCurrency(acct, 'GBP'), 'HKD'); // the largest balance
  assert.equal(C.paymentCurrency(acct, 'USD'), 'USD');
  assert.equal(C.paymentCurrency({ balances: [] }, 'GBP'), 'GBP');
  const state = { accounts: [acct], spending: [{ id: 'b', amount: 500, currency: 'GBP', dueDate: '2026-10-15' }], activity: [] };
  const p = { key: 'card:b', type: 'card', id: 'b', date: '2026-10-15', name: 'Card bill', amount: 500, currency: 'GBP', accountId: 'hk', sign: -1 };
  const entry = C.resolvePayment(state, p, true, 500, 1, { currency: 'HKD', amount: 5050 });
  assert.deepEqual(acct.balances.map((b) => [b.currency, b.amount]), [['USD', 100], ['HKD', 14950]]); // no GBP −500 line
  assert.equal(entry.paidAmount, 5050);
  assert.equal(entry.paidCurrency, 'HKD');
  assert.equal(state.spending[0].paidOn, '2026-10-15');
});

test('buy & sell: average cost, realised profit and the cash account', () => {
  const state = {
    accounts: [{ id: 't212', name: 'Trading 212 cash', balances: [{ currency: 'USD', amount: 600 }] }, { id: 'hsbc', name: 'HSBC', balances: [{ currency: 'USD', amount: 5000 }] }],
    stocks: [{ id: 'aapl', symbol: 'AAPL', currency: 'USD', quantity: 10, avgCost: 100, source: 'live' }],
    activity: [],
  };
  // Sell 5 at $700: the average cost stays $100 and $3,000 profit is realised.
  const sell = C.applyTrade(state, { id: 's1', side: 'sell', section: 'stocks', holdingId: 'aapl', quantity: 5, price: 700, fee: 0, date: '2026-10-01', accountId: 't212', cashCurrency: 'USD' }, 1);
  assert.equal(sell.realised, 3000);
  assert.equal(state.stocks[0].quantity, 5);
  assert.equal(state.stocks[0].avgCost, 100);
  assert.equal(state.accounts[0].balances[0].amount, 4100);
  // Buy 10 more at $150 (+$1 fee): average becomes (5×100 + 10×150 + 1) / 15.
  C.applyTrade(state, { id: 'b1', side: 'buy', section: 'stocks', holdingId: 'aapl', quantity: 10, price: 150, fee: 1, date: '2026-10-02', accountId: 't212', cashCurrency: 'USD' }, 2);
  close(state.stocks[0].avgCost, 2001 / 15, 1e-9);
  assert.equal(state.accounts[0].balances[0].amount, 2599);
  // Not enough cash: a top-up from another account is recorded as a transfer first.
  assert.equal(C.shortfall(state.accounts[0], 'USD', 3000, '2026-10-03'), 401);
  C.applyTrade(state, { id: 'b2', side: 'buy', section: 'stocks', holdingId: 'aapl', quantity: 20, price: 150, fee: 0, date: '2026-10-03', accountId: 't212', cashCurrency: 'USD', topUp: { fromId: 'hsbc', fromCurrency: 'USD', amount: 401, received: 401 } }, 3);
  assert.equal(state.accounts[0].balances[0].amount, 0);
  assert.equal(state.accounts[1].balances[0].amount, 4599);
  assert.equal(state.activity[0].kind, 'transfer');
  // A buy in another currency uses what the broker charged in the account's currency.
  const gbp = { id: 'g', name: 'GBP cash', balances: [{ currency: 'GBP', amount: 1000 }] };
  state.accounts.push(gbp);
  C.applyTrade(state, { id: 'b3', side: 'buy', section: 'stocks', holdingId: 'aapl', quantity: 1, price: 150, date: '2026-10-04', accountId: 'g', cashCurrency: 'GBP', cashAmount: 118.5 }, 4);
  assert.equal(gbp.balances[0].amount, 881.5);
  // Selling everything can remove the holding; selling more than you hold is refused.
  assert.throws(() => C.applyTrade(state, { id: 'x', side: 'sell', section: 'stocks', holdingId: 'aapl', quantity: 100, price: 1, date: '2026-10-05' }, 5));
  C.applyTrade(state, { id: 's2', side: 'sell', section: 'stocks', holdingId: 'aapl', quantity: 36, price: 200, date: '2026-10-05', removeIfEmpty: true }, 6);
  assert.equal(state.stocks.length, 0);
  assert.ok(state.deleted.aapl);
  const r = C.realisedProfit(state.trades, (v) => v, 'stocks', '2026-01-01');
  assert.equal(r.sells.length, 2);
  // A new holding can be bought straight away.
  C.applyTrade(state, { id: 'b4', side: 'buy', section: 'crypto', holdingId: 'btc', newHolding: { coinId: 'bitcoin', symbol: 'BTC', currency: 'USD', source: 'live' }, quantity: 0.01, price: 60000, date: '2026-10-06' }, 7);
  assert.deepEqual([state.crypto[0].quantity, state.crypto[0].avgCost], [0.01, 60000]);
});

test('check-in day: any day 1–31, falling back to the last day in shorter months', () => {
  const st = (day) => ({ settings: { checkinDay: day }, accounts: [{ id: 'a' }], activity: [] });
  assert.equal(C.checkinDate(st(31), '2026-02-27'), '2026-01-31'); // Feb's isn't until the 28th
  assert.equal(C.checkinDate(st(31), '2026-02-28'), '2026-02-28');
  assert.equal(C.checkinDate(st(31), '2028-02-29'), '2028-02-29'); // leap year
  assert.equal(C.checkinDate(st(30), '2026-04-30'), '2026-04-30');
  assert.equal(C.checkinDate(st(25), '2026-01-10'), '2025-12-25'); // across the year end
  assert.equal(C.checkinDate({ settings: {} }, '2026-10-28'), '2026-10-01'); // default: the 1st
  const s = st(25);
  assert.equal(C.checkinDue(s, '2026-10-24'), true); // September's (25 Sep) not done yet
  C.recordCheckin(s, '2026-10-24', false, 1);
  assert.equal(C.checkinDue(s, '2026-10-24'), false);
  assert.equal(C.checkinDue(s, '2026-10-25'), true); // October's is now due
});

test('changing the check-in day right after a check-in does not ask again', () => {
  const s = { settings: { checkinDay: 1 }, accounts: [{ id: 'a' }], activity: [] };
  C.recordCheckin(s, '2026-10-28', false, 1);
  s.settings.checkinDay = 31; // the period is now 30 Sep, before the check-in
  assert.equal(C.checkinDue(s, '2026-10-28'), false);
  assert.equal(C.checkinDue(s, '2026-10-31'), true);
});

test('undoing an answer reverses it and asks again', () => {
  const state = {
    accounts: [{ id: 'h', name: 'HSBC', balances: [{ currency: 'HKD', amount: 50000 }] }, { id: 'm', name: 'Monzo', balances: [{ currency: 'GBP', amount: 1000 }] }],
    cashflows: [{ id: 'r', name: 'Rent', kind: 'expense', amount: 18000, currency: 'HKD', frequency: 'monthly', nextDate: '2026-09-21', trackFrom: '2026-09-21', accountId: 'h' }],
    deposits: [{ id: 'rs', kind: 'regular', currency: 'GBP', monthlyAmount: 300, rate: 6, startDate: '2026-09-10', termMonths: 12, trackFrom: '2026-09-10', payFromAccountId: 'm' }],
    spending: [{ id: 'b', amount: 500, currency: 'GBP', dueDate: '2026-10-15', payFromAccountId: 'h' }],
    activity: [],
  };
  const today = '2026-10-22';
  const keys = () => C.pendingPayments(state, today).map((p) => p.key);
  const p = Object.fromEntries(C.pendingPayments(state, today).map((x) => [x.key, x]));
  C.resolvePayment(state, p['cf:r:2026-09-21'], true, 18000, 1);
  C.resolvePayment(state, p['cf:r:2026-10-21'], false, 18000, 2); // "already included" by mistake
  C.resolvePayment(state, p['rs:rs:2026-09-10'], true, 300, 3);
  C.resolvePayment(state, { ...p['rs:rs:2026-10-10'], paidIn: false }, false, 300, 4); // "not paid" by mistake
  C.resolvePayment(state, p['card:b'], true, 500, 5, { currency: 'HKD', amount: 5000 });
  assert.deepEqual(keys(), []);
  assert.equal(state.accounts[0].balances[0].amount, 50000 - 18000 - 5000);
  // Undo the latest rent answer: asked again, balance untouched (nothing was deducted).
  assert.equal(C.undoPayment(state, 'pay-cf:r:2026-10-21', 6), 'cf:r:2026-10-21');
  assert.deepEqual(keys(), ['cf:r:2026-10-21']);
  // Undo the earlier September rent: deduction reversed, September asked again too.
  C.undoPayment(state, 'pay-cf:r:2026-09-21', 7);
  assert.deepEqual(keys(), ['cf:r:2026-09-21', 'cf:r:2026-10-21']);
  assert.equal(state.accounts[0].balances[0].amount, 50000 - 5000);
  // Saver: undo "not paid" → asked again; undo "pay in" → £300 back in Monzo and asked again.
  C.undoPayment(state, 'pay-rs:rs:2026-10-10', 8);
  C.undoPayment(state, 'pay-rs:rs:2026-09-10', 9);
  assert.equal(state.accounts[1].balances[0].amount, 1000);
  assert.deepEqual(keys().filter((k) => k.startsWith('rs')), ['rs:rs:2026-09-10', 'rs:rs:2026-10-10']);
  assert.equal(C.regularSaverValue(state.deposits[0], today).paidIn, 0);
  // Card bill paid from HKD: HK$5,000 back, bill owed again.
  C.undoPayment(state, 'pay-card:b', 10);
  assert.equal(state.accounts[0].balances[0].amount, 50000);
  assert.ok(!state.spending[0].paidOn);
  assert.equal(state.activity.length, 0);
  assert.ok(state.deleted['pay-card:b']);
  // Answering again works as normal.
  C.resolvePayment(state, C.pendingPayments(state, today).find((x) => x.key === 'cf:r:2026-09-21'), true, 18000, 11);
  assert.ok(!keys().includes('cf:r:2026-09-21'));
});

test('a credit-card loan next to card statements is flagged as possibly counted twice', () => {
  const base = { settings: { baseCurrency: 'HKD' }, fx: { base: 'HKD', rates: { HKD: 1 } }, liabilities: [{ id: 'c', name: 'Credit card', type: 'credit', mode: 'manual', balance: 6200, currency: 'HKD' }] };
  assert.equal(C.summarize(base, '2026-10-28').alerts.filter((a) => /counted twice/.test(a.text)).length, 0);
  assert.equal(C.summarize({ ...base, cards: [{ id: 'k', name: 'HSBC Red' }] }, '2026-10-28').alerts.filter((a) => /counted twice/.test(a.text)).length, 1);
});

test('stock split and dividends received', () => {
  const state = { accounts: [{ id: 'c', name: 'Futu cash', balances: [{ currency: 'HKD', amount: 1000 }] }], stocks: [{ id: 't', symbol: '0700.HK', currency: 'HKD', quantity: 100, avgCost: 300, source: 'manual', manualPrice: 450 }] };
  // 2-for-1: 200 shares at an average of 150, price 225 — value unchanged.
  C.applyTrade(state, { id: 'x1', side: 'split', section: 'stocks', holdingId: 't', ratio: 2, date: '2026-06-01' }, 1);
  assert.deepEqual([state.stocks[0].quantity, state.stocks[0].avgCost, state.stocks[0].manualPrice], [200, 150, 225]);
  assert.throws(() => C.applyTrade(state, { id: 'x2', side: 'split', section: 'stocks', holdingId: 't', ratio: 1, date: '2026-06-01' }, 2));
  // Cash dividend into the broker account.
  C.applyTrade(state, { id: 'd1', side: 'dividend', section: 'stocks', holdingId: 't', amount: 680, date: '2026-06-10', accountId: 'c', cashCurrency: 'HKD' }, 3);
  assert.equal(state.accounts[0].balances[0].amount, 1680);
  // Reinvested dividend: 2 more shares costing the HK$450 dividend.
  C.applyTrade(state, { id: 'd2', side: 'dividend', section: 'stocks', holdingId: 't', amount: 450, reinvestQty: 2, date: '2026-09-10' }, 4);
  assert.equal(state.stocks[0].quantity, 202);
  close(state.stocks[0].avgCost, (200 * 150 + 450) / 202, 1e-9);
  const r = C.dividendsReceived(state.trades, (v) => v, '2026-01-01');
  assert.equal(r.total, 1130);
  assert.equal(C.realisedProfit(state.trades, (v) => v).sells.length, 0);
});

test('diluted cost (like Futu): profit from sales lowers the cost; the profit % needs a positive cost', () => {
  const state = { settings: { baseCurrency: 'USD' }, fx: { base: 'USD', rates: { USD: 1 } }, accounts: [], stocks: [{ id: 'a', symbol: 'A', currency: 'USD', quantity: 10, avgCost: 10, source: 'manual', manualPrice: 22 }] };
  C.applyTrade(state, { id: 's', side: 'sell', section: 'stocks', holdingId: 'a', quantity: 5, price: 22, date: '2026-10-01' }, 1);
  const avg = C.holdingView(state, state.stocks[0]);
  assert.deepEqual([avg.avgCost, avg.pnl], [10, 60]); // + $60 realised, shown apart
  state.settings.costMethod = 'diluted';
  const dil = C.holdingView(state, state.stocks[0]);
  assert.deepEqual([dil.avgCost, dil.cost, dil.pnl, dil.pnlPct], [-2, -10, 120, null]); // same $120 in total
  assert.equal(C.summarize(state, '2026-10-28').investPnlPct, null);
  // Per-holding choice wins over the setting.
  state.stocks[0].costMethod = 'average';
  assert.equal(C.holdingView(state, state.stocks[0]).avgCost, 10);
  // A position sold to zero starts afresh.
  delete state.stocks[0].costMethod;
  C.applyTrade(state, { id: 's2', side: 'sell', section: 'stocks', holdingId: 'a', quantity: 5, price: 22, date: '2026-10-02' }, 2);
  C.applyTrade(state, { id: 'b', side: 'buy', section: 'stocks', holdingId: 'a', quantity: 2, price: 30, date: '2026-10-03' }, 3);
  assert.equal(C.holdingView(state, state.stocks[0]).avgCost, 30);
  // A zero-cost holding: profit counted, % left out of the total.
  const z = { settings: { baseCurrency: 'USD' }, fx: { base: 'USD', rates: { USD: 1 } }, stocks: [{ id: 'n', quantity: 20, avgCost: 0, lastPrice: 217.5, currency: 'USD' }, { id: 'm', quantity: 1, avgCost: 100, lastPrice: 110, currency: 'USD' }] };
  const s = C.summarize(z, '2026-10-28');
  assert.equal(s.investPnl, 4350 + 10);
  close(s.investPnlPct, 0.1);
  assert.equal(s.noCostPnl, 4350);
});
