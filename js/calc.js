/*
 * MoneyMonkey — pure calculation helpers.
 * No DOM access here, so this file runs in the browser (window.Calc)
 * and in Node for tests (require('./js/calc.js')).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 86400000;
  // Activity (payments, transfers, maturities…) kept per device and in sync: ~10 years of use.
  const ACTIVITY_MAX = 3000;

  // ---------- dates (YYYY-MM-DD strings, interpreted as local dates) ----------

  function parseDate(s) {
    if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
    if (!s || typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  // Adds calendar months, clamping to the last day of the target month (Jan 31 + 1m = Feb 28/29).
  function addMonths(d, n) {
    const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d.getDate(), lastDay));
    return target;
  }

  function daysBetween(a, b) {
    // Round to absorb DST shifts.
    return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
  }

  // Number of whole months from a to b (0 if b is before a).
  function monthsBetween(a, b) {
    const da = parseDate(a);
    const db = parseDate(b);
    let months = (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
    if (addMonths(da, months) > db) months -= 1;
    return Math.max(0, months);
  }

  // ---------- currency ----------

  // fx = { base: 'USD', rates: { USD: 1, HKD: 7.8, ... } } where rates are units per 1 base.
  function convert(amount, from, to, fx) {
    if (!isFinite(amount)) return NaN;
    if (!from || !to || from === to) return amount;
    const rates = (fx && fx.rates) || {};
    const rFrom = from === (fx && fx.base) ? 1 : rates[from];
    const rTo = to === (fx && fx.base) ? 1 : rates[to];
    if (!rFrom || !rTo) return NaN;
    return (amount / rFrom) * rTo;
  }

  // ---------- fixed deposits ----------

  const COMPOUNDING_PER_YEAR = { monthly: 12, quarterly: 4, semiannually: 2, annually: 1 };

  function depositGrowth(principal, ratePct, years, compounding) {
    const r = (ratePct || 0) / 100;
    const n = COMPOUNDING_PER_YEAR[compounding];
    if (!n) return principal * (1 + r * years); // simple / paid at maturity
    return principal * Math.pow(1 + r / n, n * years);
  }

  // A deposit's term is either a number of months or an explicit end date.
  function depositMaturity(dep, start) {
    const end = parseDate(dep.endDate);
    return end && end > start ? end : addMonths(start, +dep.termMonths || 0);
  }

  function depositValue(dep, today) {
    if (dep.kind === 'regular') return regularSaverValue(dep, today);
    const principal = +dep.principal || 0;
    const start = parseDate(dep.startDate) || parseDate(today);
    const maturity = depositMaturity(dep, start);
    const termDays = Math.max(0, daysBetween(start, maturity));
    const elapsed = Math.min(termDays, Math.max(0, daysBetween(start, today)));
    const value = depositGrowth(principal, dep.rate, elapsed / 365, dep.compounding);
    const maturityValue = depositGrowth(principal, dep.rate, termDays / 365, dep.compounding);
    const daysLeft = Math.max(0, daysBetween(today, maturity));
    const matured = termDays > 0 && daysLeft === 0;
    const started = daysBetween(start, today) >= 0;
    const dailyInterest =
      matured || !started ? 0 : (COMPOUNDING_PER_YEAR[dep.compounding] ? value : principal) * ((dep.rate || 0) / 100) / 365;
    return {
      principal,
      interest: value - principal,
      value,
      startDate: toISO(start),
      maturityDate: toISO(maturity),
      termMonths: monthsBetween(start, maturity),
      termDays,
      maturityValue,
      maturityInterest: maturityValue - principal,
      daysLeft,
      matured,
      progress: termDays ? elapsed / termDays : 1,
      dailyInterest,
      monthlyInterest: dailyInterest * 365 / 12,
    };
  }

  // ---------- regular savers ----------
  // A fixed rate for a set term (usually 12 months) with a payment in every month. Interest is
  // calculated daily on the balance and paid into the saver once a month, on `interestDay`
  // (default: the day it was opened), and at maturity. The rate is an AER, so the daily rate
  // is the gross rate that gives that AER when paid monthly.

  // Dates on day `day` of each month (clamped to month end) from `from` (inclusive) to `to` (exclusive).
  function monthlyDates(from, day, to) {
    const out = [];
    for (let k = 0; k < 1200; k++) {
      const m = new Date(from.getFullYear(), from.getMonth() + k, 1);
      const d = new Date(m.getFullYear(), m.getMonth(), Math.min(day, new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()));
      if (d >= to) break;
      if (d >= from) out.push(toISO(d));
    }
    return out;
  }

  function regularSaverSchedule(dep, today) {
    const start = parseDate(dep.startDate) || parseDate(today);
    const maturity = depositMaturity({ termMonths: +dep.termMonths || 12, endDate: dep.endDate }, start);
    return {
      start,
      maturity,
      payDates: monthlyDates(start, +dep.payDay || start.getDate(), maturity),
      creditDates: [...monthlyDates(addDays(start, 1), +dep.interestDay || start.getDate(), maturity), toISO(maturity)],
    };
  }

  // Amount paid in on a scheduled date: before `trackFrom` the plan is assumed kept; after it,
  // only confirmed payments count. With `project`, unconfirmed dates are assumed paid in full.
  function regularPaid(dep, date, project) {
    if (dep.paid && dep.paid[date] != null) return +dep.paid[date] || 0;
    if (dep.trackFrom && date < dep.trackFrom) return +dep.monthlyAmount || 0;
    if (project && !(dep.lastHandled && date <= dep.lastHandled)) return +dep.monthlyAmount || 0;
    return 0;
  }

  function regularSaverValue(dep, today) {
    const { start, maturity, payDates, creditDates } = regularSaverSchedule(dep, today);
    const aer = (+dep.rate || 0) / 100;
    const dayRate = 12 * (Math.pow(1 + aer, 1 / 12) - 1) / 365;
    const maturityISO = toISO(maturity);
    const run = (until, project) => {
      const events = [...payDates.map((d) => [d, 1]), ...creditDates.map((d) => [d, 0])].filter(([d]) => d <= until).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
      let balance = 0, accrued = 0, paidIn = 0, last = toISO(start);
      const history = [];
      for (const [date, isPay] of events) {
        accrued += balance * dayRate * Math.max(0, daysBetween(last, date));
        last = date;
        if (isPay) {
          const amt = regularPaid(dep, date, project);
          balance += amt; paidIn += amt;
          history.push({ date, kind: 'payment', amount: amt });
        } else if (accrued > 0) {
          const amt = round2(accrued);
          balance += amt; accrued = 0;
          history.push({ date, kind: 'interest', amount: amt });
        }
      }
      if (until > last) accrued += balance * dayRate * daysBetween(last, until);
      return { balance, accrued, paidIn, history };
    };
    const end = today < maturityISO ? today : maturityISO;
    const now = today < toISO(start) ? { balance: 0, accrued: 0, paidIn: 0, history: [] } : run(end, false);
    const atEnd = run(maturityISO, true);
    const termDays = Math.max(0, daysBetween(start, maturity));
    const daysLeft = Math.max(0, daysBetween(today, maturity));
    const matured = termDays > 0 && daysLeft === 0;
    const value = now.balance + now.accrued;
    const termMonths = monthsBetween(start, maturity);
    const maturityValue = matured ? value : atEnd.balance;
    return {
      principal: now.paidIn,
      paidIn: now.paidIn,
      plannedIn: atEnd.paidIn,
      interest: value - now.paidIn,
      interestThisPeriod: now.accrued,
      value,
      startDate: toISO(start),
      maturityDate: maturityISO,
      termMonths,
      termDays,
      maturityValue,
      maturityInterest: maturityValue - (matured ? now.paidIn : atEnd.paidIn),
      daysLeft,
      matured,
      progress: termDays ? Math.min(1, Math.max(0, daysBetween(start, end)) / termDays) : 1,
      dailyInterest: matured || today < toISO(start) ? 0 : now.balance * dayRate,
      // Averaged over the whole term, like yearly bills: the balance (and interest) grows each month.
      monthlyInterest: matured ? 0 : (atEnd.balance - atEnd.paidIn) / Math.max(1, termMonths),
      grossRate: dayRate * 365 * 100,
      history: now.history,
      nextPayment: payDates.find((d) => d >= today) || null,
    };
  }

  // Annual rate (%) that turns `principal` into `principal + interest` over the term —
  // lets the user enter "I'll receive $X interest" instead of a rate.
  function impliedRate(principal, interest, startDate, termMonths, compounding, endDate) {
    const start = parseDate(startDate) || parseDate(toISO(new Date()));
    const t = daysBetween(start, depositMaturity({ termMonths, endDate }, start)) / 365;
    if (!(principal > 0) || !(t > 0)) return 0;
    const n = COMPOUNDING_PER_YEAR[compounding];
    if (!n) return (interest / (principal * t)) * 100;
    return (Math.pow((principal + interest) / principal, 1 / (n * t)) - 1) * n * 100;
  }

  const round2 = (v) => Math.round(v * 100) / 100;
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bank';

  // Settles matured fixed deposits according to `onMaturity`:
  //   'cash'  -> capital + interest are added to a cash account (the chosen one, or "<platform> cash")
  //   'renew' -> a new deposit starts on the maturity date with the matured amount, same term & rate
  //   'keep'  -> nothing happens
  // Mutates `state` and returns the activity entries it created. Ids are derived from the
  // deposit, so two synced devices settling the same deposit converge instead of doubling.
  function settleDeposits(state, today, nowMs) {
    const created = [];
    for (let pass = 0, again = true; again && pass < 200; pass++) {
      again = false;
      for (const dep of [...(state.deposits || [])]) {
        let mode = dep.onMaturity || 'keep';
        if (dep.kind === 'regular' && mode === 'renew') mode = 'cash';
        if (mode !== 'cash' && mode !== 'renew') continue;
        const v = depositValue(dep, today);
        if (!v.matured) continue;
        const label = dep.platform || 'Bank';
        const entry = { id: `fd-${dep.id}`, heldIn: dep.accountId || null, date: v.maturityDate, kind: mode === 'cash' ? 'deposit-cash' : 'deposit-renew', saver: dep.kind === 'regular' || undefined, platform: label, ref: dep.name || '', amount: round2(v.maturityValue), interest: round2(v.maturityInterest), currency: dep.currency, _mt: nowMs };
        if (mode === 'cash') {
          state.accounts = state.accounts || [];
          // The chosen payout account, else the account the deposit is held in, else
          // an account on the same platform / a new one for it.
          const acct = state.accounts.find((a) => a.id === dep.payoutAccountId)
            || state.accounts.find((a) => a.id === dep.accountId)
            || accountForPlatform(state, dep.platform, dep.currency);
          // Credit the deposit's own currency: multi-currency accounts need no conversion.
          adjustLine(acct, dep.currency, v.maturityValue, v.maturityDate);
          acct._mt = nowMs;
          entry.accountName = acct.name;
          entry.accountId = acct.id;
        } else {
          const next = { ...dep, id: `${dep.id}r`, startDate: v.maturityDate, principal: round2(v.maturityValue), _mt: nowMs };
          if (dep.endDate) next.endDate = toISO(addDays(parseDate(v.maturityDate), v.termDays));
          state.deposits.push(next);
          again = true; // the renewal may itself have matured already
        }
        state.deposits = state.deposits.filter((d) => d.id !== dep.id);
        state.deleted = { ...(state.deleted || {}), [dep.id]: nowMs };
        created.push(entry);
      }
    }
    if (created.length) {
      const ids = new Set(created.map((e) => e.id));
      state.activity = [...created, ...(state.activity || []).filter((e) => !ids.has(e.id))].slice(0, ACTIVITY_MAX);
    }
    return created;
  }

  // ---------- loans / liabilities ----------

  function loanBalance(loan, today) {
    if (loan.mode !== 'amortizing') {
      return { balance: Math.max(0, +loan.balance || 0), paymentsMade: null, monthsLeft: null };
    }
    const P = +loan.principal || 0;
    const pmt = +loan.payment || 0;
    const i = (+loan.rate || 0) / 100 / 12;
    const k = loan.startDate ? monthsBetween(loan.startDate, today) : 0;
    let balance;
    if (i === 0) balance = P - pmt * k;
    else balance = P * Math.pow(1 + i, k) - (pmt * (Math.pow(1 + i, k) - 1)) / i;
    balance = Math.max(0, balance);
    let monthsLeft;
    if (balance === 0) monthsLeft = 0;
    else if (i === 0) monthsLeft = pmt > 0 ? Math.ceil(balance / pmt) : Infinity;
    else if (pmt <= balance * i) monthsLeft = Infinity; // payment doesn't cover interest
    else monthsLeft = Math.ceil(-Math.log(1 - (i * balance) / pmt) / Math.log(1 + i));
    return { balance, paymentsMade: k, monthsLeft, monthlyInterest: balance * i };
  }

  // ---------- other assets (car, gold, pension, ...) ----------

  function otherAssetValue(asset, today) {
    const v = +asset.value || 0;
    const g = (+asset.annualChangePct || 0) / 100;
    if (!g || !asset.valueDate) return v;
    const years = Math.max(0, daysBetween(asset.valueDate, today)) / 365;
    return Math.max(0, v * Math.pow(1 + g, years));
  }

  // ---------- property ----------

  const STALE_DAYS = { weekly: 7, monthly: 31, quarterly: 92, yearly: 366 };

  function latestValuation(prop) {
    const vals = (prop.valuations || []).filter((v) => v && v.date && isFinite(+v.value));
    if (!vals.length) return null;
    return vals.reduce((a, b) => (b.date >= a.date ? b : a));
  }

  function propertyValue(prop, today) {
    const latest = latestValuation(prop);
    const value = latest ? +latest.value : +prop.purchasePrice || 0;
    const lastDate = latest ? latest.date : prop.purchaseDate;
    const cost = +prop.purchasePrice || 0;
    const sinceUpdate = lastDate ? daysBetween(lastDate, today) : Infinity;
    const limit = STALE_DAYS[prop.updateFrequency] || STALE_DAYS.monthly;
    return {
      value,
      lastDate: lastDate || null,
      gain: cost ? value - cost : 0,
      gainPct: cost ? (value - cost) / cost : 0,
      stale: sinceUpdate > limit,
      nextUpdate: lastDate ? toISO(addDays(parseDate(lastDate), limit)) : toISO(parseDate(today)),
    };
  }

  // ---------- stocks / crypto holdings ----------

  // `realisedIn`: profit from earlier sales taken off the cost (diluted cost, as some brokers show).
  // The profit % is only meaningful on a positive cost; otherwise it's null ("—").
  function holdingValue(h, { realisedIn = 0 } = {}) {
    const qty = +h.quantity || 0;
    const live = isFinite(h.lastPrice) && h.lastPrice > 0;
    const price = live ? +h.lastPrice : +h.manualPrice || Math.max(0, +h.avgCost || 0);
    const marketValue = qty * price;
    const cost = qty * (+h.avgCost || 0) - realisedIn;
    const prev = isFinite(h.prevClose) && h.prevClose > 0 ? +h.prevClose : null;
    return {
      price,
      live,
      marketValue,
      cost,
      avgCost: qty ? cost / qty : +h.avgCost || 0,
      realisedIn,
      pnl: marketValue - cost,
      pnlPct: cost > 0 ? (marketValue - cost) / cost : null,
      dayChange: prev ? qty * (price - prev) : 0,
      dayChangePct: prev ? (price - prev) / prev : 0,
    };
  }

  // Cost method: 'average' (default — sales keep the average cost; their profit is realised) or
  // 'diluted' (like Futu/moomoo — profit from sales since the position was last empty lowers the cost).
  // Set in settings, or per holding (`costMethod`). Only how it's shown changes, never the data.
  function costMethod(state, h) {
    return h.costMethod || ((state && state.settings) || {}).costMethod || 'average';
  }
  function dilutedRealised(trades, holdingId) {
    let sum = 0;
    const sells = (trades || []).filter((e) => e.holdingId === holdingId && e.side === 'sell' && e.realised != null)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a._mt || 0) - (b._mt || 0)));
    for (const e of sells) sum = e.before && e.before.quantity - e.quantity <= 1e-9 ? 0 : sum + e.realised;
    return sum;
  }
  function holdingView(state, h) {
    return holdingValue(h, { realisedIn: costMethod(state, h) === 'diluted' ? dilutedRealised(state.trades, h.id) : 0 });
  }

  // Annual dividend of a holding in its own currency: per share × shares, or yield × value.
  function dividendPerYear(h) {
    const qty = +h.quantity || 0;
    if (h.divMode === 'perShare') return qty * (+h.dividendPerShare || 0);
    if (h.divMode === 'yield') return holdingValue(h).marketValue * (+h.dividendYield || 0) / 100;
    return 0;
  }

  // ---------- recurring cash flow ----------

  const PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, semiannually: 1 / 6, yearly: 1 / 12, once: 0 };

  // An item's amount on a date: its first amount, or the latest change (`changes`: [{ from, amount }])
  // that has started by then. Earlier months keep the amount they had.
  function amountOn(cf, iso) {
    let amount = +cf.amount || 0;
    const list = [...(cf.changes || [])].filter((c) => c && c.from && isFinite(+c.amount)).sort((a, b) => (a.from < b.from ? -1 : 1));
    for (const c of list) if (!iso || c.from <= iso) amount = +c.amount;
    return amount;
  }
  // Whether an item counts in a month ("YYYY-MM"): on, and between its optional start and end.
  // A start or end on any day counts that whole month.
  function inMonth(cf, ym) {
    if (cf.active === false) return false;
    if (cf.startDate && cf.startDate.slice(0, 7) > ym) return false;
    if (cf.endDate && cf.endDate.slice(0, 7) < ym) return false;
    return true;
  }
  // Average per month. With a month: 0 outside the item's dates, at the amount in force that month.
  function monthlyAmount(cf, ym) {
    if (ym === undefined) return (+cf.amount || 0) * (PER_MONTH[cf.frequency] ?? 1);
    if (!inMonth(cf, ym)) return 0;
    return amountOn(cf, `${ym}-31`) * (PER_MONTH[cf.frequency] ?? 1);
  }
  // Ended: its end date has passed.
  const hasEnded = (cf, today) => !!cf.endDate && cf.endDate < today;

  function stepDate(d, frequency, n) {
    switch (frequency) {
      case 'weekly': return addDays(d, 7 * n);
      case 'biweekly': return addDays(d, 14 * n);
      case 'monthly': return addMonths(d, n);
      case 'quarterly': return addMonths(d, 3 * n);
      case 'semiannually': return addMonths(d, 6 * n);
      case 'yearly': return addMonths(d, 12 * n);
      default: return null;
    }
  }

  // All occurrence dates (ISO) of a recurring item within [from, to] inclusive.
  function occurrences(cf, from, to) {
    // Nothing before the item's start or after its end.
    const startIso = cf.startDate && (!cf.nextDate || cf.startDate > cf.nextDate) ? cf.startDate : cf.nextDate;
    const anchor = parseDate(startIso);
    if (!anchor) return [];
    if (cf.startDate && from < cf.startDate) from = cf.startDate;
    if (cf.endDate && to > cf.endDate) to = cf.endDate;
    if (from > to) return [];
    const f = parseDate(from);
    const t = parseDate(to);
    const out = [];
    if (cf.frequency === 'once') {
      if (anchor >= f && anchor <= t) out.push(toISO(anchor));
      return out;
    }
    // Step from the anchor (not from the previous result) so month-end days don't drift.
    for (let n = 0, guard = 0; guard < 5000; n++, guard++) {
      const d = stepDate(anchor, cf.frequency, n);
      if (!d || d > t) break;
      if (d >= f) out.push(toISO(d));
    }
    return out;
  }

  function nextOccurrence(cf, today) {
    const occ = occurrences(cf, today, toISO(addMonths(parseDate(today), 13)));
    return occ[0] || null;
  }

  // ---------- target mix ----------

  // How the assets are spread against target percentages (`targets`: { cash: 20, stocks: 50, … },
  // in percent). `totals` are the asset groups in the base currency. Property only counts when
  // `includeProperty`. Returns each group's current share, its gap to the target (in money:
  // + to add, − over), whether it's within `tolerance` points, suggested moves from groups that
  // are over to groups that are under (biggest first), and how to split `newMoney` (e.g. the
  // monthly surplus) to get closer without selling.
  const MIX_KEYS = ['cash', 'stocks', 'crypto', 'deposits', 'property', 'other'];
  function targetMix(totals, { targets = {}, includeProperty = false, tolerance = 5 } = {}, newMoney = 0) {
    const keys = MIX_KEYS.filter((k) => includeProperty || k !== 'property');
    const amount = (k) => Math.max(0, +totals[k] || 0);
    const total = keys.reduce((t, k) => t + amount(k), 0);
    const rows = keys.map((k) => {
      const target = +targets[k] || 0;
      const pct = total ? (amount(k) / total) * 100 : 0;
      const gap = round2((target / 100) * total - amount(k));
      return { key: k, amount: amount(k), pct, target, diff: pct - target, gap, onTarget: Math.abs(pct - target) <= tolerance };
    });
    // Rebalance: pair the biggest excess with the biggest shortfall until both lists are used up.
    const over = rows.filter((r) => r.gap < -0.5).map((r) => ({ key: r.key, left: -r.gap })).sort((a, b) => b.left - a.left);
    const under = rows.filter((r) => r.gap > 0.5).map((r) => ({ key: r.key, left: r.gap })).sort((a, b) => b.left - a.left);
    const moves = [];
    for (const o of over) {
      for (const u of under) {
        if (o.left < 0.5) break;
        if (u.left < 0.5) continue;
        const amt = Math.min(o.left, u.left);
        moves.push({ from: o.key, to: u.key, amount: round2(amt) });
        o.left -= amt;
        u.left -= amt;
      }
    }
    // New money: fill the shortfalls (in proportion) first; anything beyond follows the targets.
    const split = [];
    const m = Math.max(0, +newMoney || 0);
    if (m > 0) {
      const short = rows.filter((r) => r.gap > 0);
      const need = short.reduce((t, r) => t + r.gap, 0);
      const byKey = {};
      if (need > 0) for (const r of short) byKey[r.key] = Math.min(r.gap, need > m ? (m * r.gap) / need : r.gap);
      const rest = m - Object.values(byKey).reduce((t, v) => t + v, 0);
      const tsum = rows.reduce((t, r) => t + r.target, 0);
      if (rest > 0.005 && tsum > 0) for (const r of rows) byKey[r.key] = (byKey[r.key] || 0) + (rest * r.target) / tsum;
      for (const r of rows) if (byKey[r.key] > 0.005) split.push({ key: r.key, amount: round2(byKey[r.key]), pct: (byKey[r.key] / m) * 100 });
      split.sort((a, b) => b.amount - a.amount);
    }
    return { total: round2(total), rows, moves, split, onTarget: rows.every((r) => r.onTarget) };
  }

  // ---------- history & goals ----------

  function upsertHistory(history, entry, maxLen) {
    const list = (history || []).filter((h) => h.date !== entry.date);
    list.push(entry);
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    return maxLen && list.length > maxLen ? list.slice(list.length - maxLen) : list;
  }

  function monthsToGoal(current, target, monthlySaving) {
    if (current >= target) return 0;
    if (!(monthlySaving > 0)) return Infinity;
    return Math.ceil((target - current) / monthlySaving);
  }

  // ---------- recorded monthly spending ----------

  const SPENDING_AVG_MONTHS = 3;

  // [{ month: 'YYYY-MM', total, entries }] newest first, totals in base currency via `toBaseFn`.
  function spendingByMonth(entries, toBaseFn) {
    const map = new Map();
    for (const e of entries || []) {
      if (!e || !/^\d{4}-\d{2}$/.test(e.month || '')) continue;
      const m = map.get(e.month) || { month: e.month, total: 0, entries: 0 };
      m.total += toBaseFn(+e.amount || 0, e.currency);
      m.entries += 1;
      map.set(e.month, m);
    }
    return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
  }

  // ---------- portfolio summary ----------

  function summarize(state, todayISO) {
    const today = todayISO;
    const base = state.settings.baseCurrency;
    const fx = state.fx;
    const missingFx = new Set();
    const toBase = (amt, cur) => {
      const v = convert(+amt || 0, cur || base, base, fx);
      if (!isFinite(v)) { missingFx.add(cur); return 0; }
      return v;
    };

    let fdInterestCash = 0, fdInterestRenew = 0;
    const totals = { cash: 0, stocks: 0, crypto: 0, deposits: 0, property: 0, other: 0 };
    let investCostPos = 0, investPnlPos = 0, noCostPnl = 0, realisedInHoldings = 0;
    let investCost = 0, investPnl = 0, dayChange = 0, depositDaily = 0, depositMonthly = 0, depositInterest = 0;
    const events = [];
    const alerts = [];
    const horizon = toISO(addDays(parseDate(today), 30));

    let saverDaily = 0, saverAccrued = 0;
    const saverMonthlyByAccount = {};
    for (const a of state.accounts || []) {
      for (const b of accountBalances(a)) {
        const bv = balanceValue(b, today);
        totals.cash += toBase(bv.value, b.currency);
        saverDaily += toBase(bv.daily, b.currency);
        if (bv.daily > 0) saverMonthlyByAccount[a.id] = (saverMonthlyByAccount[a.id] || 0) + toBase(bv.daily, b.currency) * 365 / 12;
        saverAccrued += toBase(bv.accrued, b.currency);
      }
    }

    for (const [list, key] of [[state.stocks, 'stocks'], [state.crypto, 'crypto']]) {
      for (const h of list || []) {
        const v = holdingView(state, h);
        totals[key] += toBase(v.marketValue, h.currency);
        investCost += toBase(v.cost, h.currency);
        investPnl += toBase(v.pnl, h.currency);
        // The % is worked out on holdings with a positive cost; others' profit is noted apart.
        if (v.cost > 0) { investCostPos += toBase(v.cost, h.currency); investPnlPos += toBase(v.pnl, h.currency); } else noCostPnl += toBase(v.pnl, h.currency);
        realisedInHoldings += toBase(v.realisedIn, h.currency);
        dayChange += toBase(v.dayChange, h.currency);
      }
    }

    for (const d of state.deposits || []) {
      const v = depositValue(d, today);
      totals.deposits += toBase(v.value, d.currency);
      depositDaily += toBase(v.dailyInterest, d.currency);
      // Interest as average monthly income (like yearly bills averaged per month). A renewing
      // deposit keeps its interest, so that part is also counted as saving.
      const fdMonthly = toBase(v.monthlyInterest, d.currency);
      depositMonthly += fdMonthly;
      if (d.kind === 'regular' && !v.matured && v.nextPayment && v.nextPayment <= horizon) {
        events.push({ date: v.nextPayment, label: `Pay into regular saver: ${d.platform || d.name || 'saver'}`, amount: toBase(d.monthlyAmount, d.currency), kind: 'saver', ref: d.id, orig: +d.monthlyAmount, currency: d.currency });
      }
      if (d.onMaturity === 'renew') fdInterestRenew += fdMonthly;
      else fdInterestCash += fdMonthly;
      depositInterest += toBase(v.interest, d.currency);
      if (v.maturityDate >= today && v.maturityDate <= horizon) {
        events.push({ date: v.maturityDate, label: `Fixed deposit matures: ${d.bank || d.name || 'FD'}`, amount: toBase(v.maturityValue, d.currency), kind: 'deposit', ref: d.id, accountId: d.accountId, orig: v.maturityValue, currency: d.currency });
      } else if (v.matured) {
        alerts.push({ level: 'info', text: `Fixed deposit at ${d.bank || 'bank'} matured on ${v.maturityDate} — renew it or move it to cash.` });
      }
    }

    for (const p of state.properties || []) {
      const v = propertyValue(p, today);
      totals.property += toBase(v.value, p.currency);
      if (v.stale) alerts.push({ level: 'warn', text: `"${p.name}" value was last updated ${v.lastDate || 'never'} — it is due a ${p.updateFrequency || 'monthly'} update.` });
      else if (v.nextUpdate <= horizon) events.push({ date: v.nextUpdate, label: `Update value: ${p.name}`, amount: null, kind: 'property', ref: p.id });
    }

    for (const o of state.others || []) totals.other += toBase(otherAssetValue(o, today), o.currency);

    let liabilities = 0, debtPayments = 0;
    for (const l of state.liabilities || []) {
      const v = loanBalance(l, today);
      liabilities += toBase(v.balance, l.currency);
      if (v.balance > 0) debtPayments += toBase(l.payment, l.currency);
    }
    // A card bill is owed from when it's recorded until the payment is confirmed.
    let cardOwed = 0;
    for (const e of unpaidCardBills(state)) {
      cardOwed += toBase(e.amount, e.currency);
      if (e.dueDate <= horizon) {
        const overdue = e.dueDate < today;
        events.push({ date: e.dueDate, label: `${e.platform || 'Card'} bill`, amount: toBase(e.amount, e.currency), kind: 'card', overdue, cardId: e.cardId, ref: e.id, orig: +e.amount, currency: e.currency });
      }
    }
    liabilities += cardOwed;
    // An old-style "Credit card" loan next to card statements is probably the same debt twice.
    if ((state.cards || []).length) {
      for (const l of state.liabilities || []) {
        if (l.type === 'credit' && loanBalance(l, today).balance > 0) alerts.push({ level: 'warn', text: `“${l.name}” is a credit-card loan, but card bills are also tracked under Credit cards — if it’s the same card, delete the loan so the debt isn’t counted twice.` });
      }
    }

    // Loan repayments are part of monthly spending. A bill that is the same payment (linked, or
    // auto-matched by currency + amount) is counted once, as the loan repayment.
    const loans = (state.liabilities || [])
      .filter((l) => l.type !== 'credit' && +l.payment > 0 && loanBalance(l, today).balance > 0);
    const loanMatches = [];
    for (const cf of state.cashflows || []) {
      if (!inMonth(cf, today.slice(0, 7)) || cf.kind !== 'expense' || cf.notLoan) continue;
      const taken = new Set(loanMatches.map((m) => m.loanId));
      const hit = cf.loanId
        ? loans.find((l) => l.id === cf.loanId)
        : loans.find((l) => !taken.has(l.id) && l.currency === cf.currency && cf.frequency === 'monthly' && Math.abs(amountOn(cf, today) - +l.payment) <= Math.max(1, 0.01 * +l.payment));
      if (hit) loanMatches.push({ cashflowId: cf.id, loanId: hit.id, linked: !!cf.loanId });
    }
    // Property rent (the property's "monthly rent") is the single source of rent income. An income
    // item for the same rent (linked, or same currency + amount) is counted once, as that rent.
    // Items that start later match too; ended or paused ones don't.
    const rented = (state.properties || []).filter((p) => +p.monthlyRent > 0);
    const rentMatches = [];
    for (const cf of state.cashflows || []) {
      if (cf.active === false || hasEnded(cf, today) || cf.kind !== 'income' || cf.notRent) continue;
      const taken = new Set(rentMatches.map((m) => m.propertyId));
      // Any of its amounts (before or after a rent rise) can match the property's rent.
      const amounts = [+cf.amount || 0, ...(cf.changes || []).map((c) => +c.amount || 0)];
      const hit = cf.propertyId
        ? rented.find((p) => p.id === cf.propertyId)
        : rented.find((p) => !taken.has(p.id) && p.currency === cf.currency && cf.frequency === 'monthly' && amounts.some((a) => Math.abs(a - +p.monthlyRent) <= Math.max(1, 0.01 * +p.monthlyRent)));
      if (hit) rentMatches.push({ cashflowId: cf.id, propertyId: hit.id, linked: !!cf.propertyId });
    }
    // A property's rent this month. Linked to an income item, it follows that item's start, end and
    // amount changes; on its own, it counts from now.
    let rentMonthly = 0;
    for (const p of rented) {
      const m = rentMatches.find((x) => x.propertyId === p.id);
      // Its own rent item counts even once ended or paused (then as nothing), so the property's
      // old rent figure doesn't come back after a tenancy ends.
      const cf = (m && (state.cashflows || []).find((c) => c.id === m.cashflowId)) || (state.cashflows || []).find((c) => c.kind === 'income' && c.propertyId === p.id);
      rentMonthly += cf ? toBase(monthlyAmount(cf, today.slice(0, 7)), cf.currency) : toBase(p.monthlyRent, p.currency);
    }

    // Dividends: per share per year, or a yield on the current value. Reinvested ones also count as saving.
    let dividendCash = 0, dividendReinvested = 0;
    for (const h of state.stocks || []) {
      const yearly = dividendPerYear(h);
      if (!(yearly > 0)) continue;
      const m = toBase(yearly / 12, h.currency);
      if (h.dividendReinvest) dividendReinvested += m;
      else dividendCash += m;
    }
    const dividends = { cash: dividendCash, reinvested: dividendReinvested, total: dividendCash + dividendReinvested };

    // Regular saver payments are planned saving. A "Saving" item for the same payment is counted once.
    const saverMatches = regularSaverMatches(state, today);
    let regularSaving = 0;
    for (const d of state.deposits || []) {
      if (d.kind === 'regular' && !depositValue(d, today).matured) regularSaving += toBase(d.monthlyAmount, d.currency);
    }
    const matchedIds = new Set([...loanMatches.map((m) => m.cashflowId), ...rentMatches.map((m) => m.cashflowId), ...saverMatches.map((m) => m.cashflowId)]);
    const loanRepayments = loans.reduce((t, l) => t + toBase(l.payment, l.currency), 0);

    const flow = { income: 0, expense: 0, subscription: 0, saving: 0 };
    let notOnCard = 0, cardPaidBills = 0;
    for (const cf of state.cashflows || []) {
      if (cf.active === false) continue;
      const monthly = toBase(monthlyAmount(cf, today.slice(0, 7)), cf.currency);
      const isBill = cf.kind === 'expense' || cf.kind === 'subscription';
      if (cf.kind === 'transfer') { for (const date of occurrences(cf, today, horizon)) events.push({ date, label: cf.name, amount: toBase(amountOn(cf, date), cf.currency), kind: 'transfer', ref: cf.id, orig: amountOn(cf, date), currency: cf.currency }); continue; }
      if (!matchedIds.has(cf.id)) {
        flow[cf.kind] = (flow[cf.kind] || 0) + monthly;
        if (isBill && !cf.onCard) notOnCard += monthly;
        if (isBill && cf.onCard) cardPaidBills += monthly;
      }
      for (const date of occurrences(cf, today, horizon)) {
        events.push({ date, label: cf.name, amount: toBase(amountOn(cf, date), cf.currency), kind: cf.kind, ref: cf.id, orig: amountOn(cf, date), currency: cf.currency });
      }
    }
    // Overdue card bills first, then by date.
    events.sort((a, b) => (!!a.overdue !== !!b.overdue ? (a.overdue ? -1 : 1) : a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const assets = Object.values(totals).reduce((s, x) => s + x, 0);
    const netWorth = assets - liabilities;
    // Actual spending: average of the latest recorded months (e.g. credit card statements),
    // plus fixed bills that are NOT paid by card (card-paid ones are already in the statement).
    const spendMonths = spendingByMonth(state.spending, toBase);
    const recentSpend = spendMonths.slice(0, SPENDING_AVG_MONTHS);
    const cardSpendAvg = recentSpend.length ? recentSpend.reduce((a, m) => a + m.total, 0) / recentSpend.length : null;
    const billsMonthly = flow.expense + flow.subscription;
    const estimatedSpending = billsMonthly + loanRepayments;
    const actualSpending = cardSpendAvg == null ? null : cardSpendAvg + notOnCard + loanRepayments;
    const spending = actualSpending ?? estimatedSpending;
    // Saver interest the user already entered as an income item (linked to that account and
    // named/categorised "interest") isn't added again.
    const enteredInterest = new Set((state.cashflows || [])
      .filter((c) => c.active !== false && c.kind === 'income' && c.accountId && /interest/i.test(`${c.name} ${c.category || ''}`))
      .map((c) => c.accountId));
    let saverInterest = 0;
    for (const [id, m] of Object.entries(saverMonthlyByAccount)) if (!enteredInterest.has(id)) saverInterest += m;
    const interest = {
      fdCash: fdInterestCash,
      fdRenew: fdInterestRenew,
      saver: saverInterest,
      total: fdInterestCash + fdInterestRenew + saverInterest,
      skippedAccounts: Object.keys(saverMonthlyByAccount).filter((id) => enteredInterest.has(id)),
    };
    const incomeTotal = flow.income + interest.total + rentMonthly + dividends.total;
    const netMonthly = incomeTotal - spending;

    // Where a typical month's income goes.
    const cardSpending = cardSpendAvg == null ? cardPaidBills : cardSpendAvg;
    const split = {
      bills: notOnCard,
      card: cardSpending,
      loans: loanRepayments,
      saving: flow.saving + regularSaving + fdInterestRenew + dividends.reinvested,
    };
    split.unallocated = incomeTotal - (split.bills + split.card + split.loans + split.saving);
    // Fixed = regular commitments however they're paid; flexible = the rest of card spending.
    const fixedCosts = notOnCard + cardPaidBills + loanRepayments;
    const flexibleCosts = cardSpendAvg == null ? null : Math.max(0, cardSpendAvg - cardPaidBills);

    // Month by month: recorded card statements plus the regular bills and loan repayments,
    // against regular income (only card spending is recorded per month, so that's what varies).
    const history = spendMonths.slice(0, 12).map((m) => {
      const spent = m.total + notOnCard + loanRepayments;
      return { month: m.month, income: incomeTotal, card: m.total, fixed: notOnCard + loanRepayments, spending: spent, net: incomeTotal - spent };
    }).reverse();
    const passiveMonthly = depositMonthly + saverDaily * 365 / 12 + rentMonthly + dividends.total;
    const liquid = totals.cash;

    if (missingFx.size) alerts.push({ level: 'warn', text: `No exchange rate for ${[...missingFx].join(', ')} — those items are excluded from totals. Refresh rates in Settings.` });

    return {
      base,
      totals,
      assets,
      liabilities,
      cardOwed,
      netWorth,
      investCost,
      investPnl,
      investPnlPct: investCostPos > 0 ? investPnlPos / investCostPos : null,
      investCostPos,
      noCostPnl,
      realisedInHoldings,
      dayChange,
      depositDaily,
      saverDaily,
      saverAccrued,
      interestDaily: depositDaily + saverDaily,
      depositInterest,
      flow,
      spending,
      billsMonthly,
      loanRepayments,
      loanMatches,
      cardPaidBills,
      split,
      fixedCosts,
      fixedPct: incomeTotal ? fixedCosts / incomeTotal : null,
      interest,
      dividends,
      rentMatches,
      saverMatches,
      regularSaving,
      incomeTotal,
      flexibleCosts,
      history,
      spendingSource: actualSpending == null ? 'estimate' : 'actual',
      estimatedSpending,
      actualSpending,
      cardSpendAvg,
      spendAvgMonths: recentSpend.length,
      notOnCard,
      spendMonths,
      netMonthly,
      savingsRate: incomeTotal ? (incomeTotal - spending) / incomeTotal : 0,
      passiveMonthly,
      rentMonthly,
      debtPayments,
      runwayMonths: spending ? liquid / spending : Infinity,
      debtToAsset: assets ? liabilities / assets : 0,
      events,
      alerts,
    };
  }

  // ---------- multi-currency accounts ----------

  // An account holds one balance per currency: [{ currency, amount }].
  // Older single-currency accounts ({ currency, balance }) read as a one-line list.
  function accountBalances(a) {
    if (Array.isArray(a.balances)) return a.balances;
    if (a.currency || a.balance != null) return [{ currency: a.currency, amount: +a.balance || 0 }];
    return [];
  }

  function migrateAccounts(state) {
    for (const a of state.accounts || []) {
      if (!Array.isArray(a.balances)) a.balances = accountBalances(a);
      delete a.currency;
      delete a.balance;
    }
    return state;
  }

  // Cash grouped by currency across all accounts, largest (in base currency) first:
  // [{ currency, amount, base, share, accounts: [{ id, name, platform, amount }] }]
  function cashByCurrency(state, today) {
    const baseCur = state.settings.baseCurrency;
    const map = new Map();
    for (const a of state.accounts || []) {
      for (const b of accountBalances(a)) {
        const amount = balanceValue(b, today).value;
        if (!b.currency || !amount) continue;
        const row = map.get(b.currency) || { currency: b.currency, amount: 0, base: 0, accounts: [] };
        row.amount += amount;
        row.accounts.push({ id: a.id, name: a.name, platform: a.platform || '', amount });
        map.set(b.currency, row);
      }
    }
    const rows = [...map.values()];
    for (const r of rows) {
      const v = convert(r.amount, r.currency, baseCur, state.fx);
      r.base = isFinite(v) ? v : NaN;
      r.accounts.sort((x, y) => y.amount - x.amount);
    }
    const total = rows.reduce((t, r) => t + (isFinite(r.base) ? r.base : 0), 0);
    for (const r of rows) r.share = total && isFinite(r.base) ? r.base / total : 0;
    return rows.sort((x, y) => (isFinite(y.base) ? y.base : -Infinity) - (isFinite(x.base) ? x.base : -Infinity));
  }

  // ---------- saver interest, confirmed payments, transfers, check-ins ----------

  // A balance line can carry an interest rate (saver accounts). Interest is estimated day by day
  // from `asOf` — when the amount was last confirmed — and shown on top of it until the next update.
  // `carry` keeps the estimate when the app itself changes the amount (deposit payout, transfer…).
  function balanceValue(line, today) {
    const amount = +line.amount || 0;
    const rate = (+line.rate || 0) / 100;
    const carry = +line.carry || 0;
    const days = rate && line.asOf && today ? Math.max(0, daysBetween(line.asOf, today)) : 0;
    const accrued = carry + (amount * rate * days) / 365;
    return { amount, accrued, value: amount + accrued, daily: (amount * rate) / 365 };
  }

  // Changes an account's balance in `currency` by `delta` on `date`, adding the line if needed.
  function adjustLine(acct, currency, delta, date) {
    acct.balances = accountBalances(acct);
    delete acct.currency;
    delete acct.balance;
    let row = acct.balances.find((b) => b.currency === currency);
    if (!row) acct.balances.push((row = { currency, amount: 0 }));
    if (+row.rate) {
      row.carry = round2(balanceValue(row, date).accrued);
      row.asOf = date;
    }
    row.amount = round2((+row.amount || 0) + delta);
    return row;
  }

  const OUTGOING = { expense: true, subscription: true, saving: true, transfer: true };

  // Payments waiting for the user to confirm: cash-flow items linked to an account whose dates
  // have arrived (card-paid bills are skipped — they're in the card statement), and card bills
  // with a "paid from" account that are due. Nothing changes a balance until it is confirmed.
  function pendingPayments(state, today) {
    const out = [];
    // A cash-flow item that is a regular saver's payment is confirmed by the saver instead.
    const savedBySaver = new Set(regularSaverMatches(state, today).map((m) => m.cashflowId));
    for (const dep of state.deposits || []) {
      if (dep.kind !== 'regular' || !(+dep.monthlyAmount > 0)) continue;
      const { payDates } = regularSaverSchedule(dep, today);
      const reask = new Set(dep.reask || []);
      for (const date of payDates) {
        if (date > today || (dep.trackFrom && date < dep.trackFrom && !reask.has(date)) || (dep.lastHandled && date <= dep.lastHandled && !reask.has(date))) continue;
        if (dep.paid && dep.paid[date] != null) continue;
        out.push({ key: `rs:${dep.id}:${date}`, type: 'saver', id: dep.id, date, name: `Regular saver: ${dep.platform || dep.name || 'saver'}`, amount: +dep.monthlyAmount, currency: dep.currency, accountId: dep.payFromAccountId || null, sign: -1 });
      }
    }
    for (const cf of state.cashflows || []) {
      if (cf.active === false || !cf.accountId || savedBySaver.has(cf.id)) continue;
      if (cf.onCard && (cf.kind === 'expense' || cf.kind === 'subscription')) continue;
      const after = cf.lastHandled ? toISO(addDays(parseDate(cf.lastHandled), 1)) : null;
      const from = [cf.trackFrom, after].filter(Boolean).sort().pop() || today;
      // Dates re-opened by undoing an answer come back too.
      const dates = [...new Set([...occurrences(cf, from, today), ...(cf.reask || []).filter((d) => d <= today)])].sort();
      for (const date of dates) {
        out.push({ key: `cf:${cf.id}:${date}`, type: 'cashflow', id: cf.id, date, name: cf.name, amount: amountOn(cf, date), currency: cf.currency, accountId: cf.accountId, toAccountId: cf.toAccountId || null, sign: OUTGOING[cf.kind] ? -1 : 1 });
      }
    }
    for (const e of unpaidCardBills(state)) {
      if (e.dueDate > today) continue;
      const card = (state.cards || []).find((c) => c.id === e.cardId);
      const accountId = e.payFromAccountId || (card && card.payFromAccountId) || null;
      out.push({ key: `card:${e.id}`, type: 'card', id: e.id, date: e.dueDate, name: `${e.platform || 'Card'} bill (${e.month})`, amount: +e.amount || 0, currency: e.currency, accountId, sign: -1 });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // The account's currency a payment in `currency` comes out of (or goes into): that currency if
  // the account holds it, else its largest balance — never a new (negative) line in a currency
  // the account doesn't have. Null when the account has no balances at all.
  function paymentCurrency(acct, currency) {
    const lines = accountBalances(acct || {});
    if (!lines.length || lines.some((b) => b.currency === currency)) return currency;
    return lines.slice().sort((a, b) => (+b.amount || 0) - (+a.amount || 0))[0].currency;
  }

  // Confirms (apply = true: change the balance by `amount`) or dismisses a pending payment.
  // `from` = { currency, amount } when the account is changed in another currency than the
  // payment's (e.g. a £ card bill paid from HK$): that amount, in that currency, is used.
  function resolvePayment(state, p, apply, amount, nowMs, from) {
    let acct = null;
    if (apply) {
      acct = (state.accounts || []).find((a) => a.id === p.accountId);
      if (!acct && p.type !== 'saver') return null;
    }
    const other = from && from.currency && from.currency !== p.currency && isFinite(+from.amount) ? from : null;
    if (apply && acct) {
      if (other) adjustLine(acct, other.currency, p.sign * +other.amount, p.date);
      else adjustLine(acct, p.currency, p.sign * amount, p.date);
      acct._mt = nowMs;
    }
    // A transfer (or saving into another account) also arrives in the destination account, in
    // `p.toCurrency` (`p.received`, e.g. at the bank's rate; same currency: the amount itself).
    const dest = apply && acct && p.toAccountId ? (state.accounts || []).find((a) => a.id === p.toAccountId) : null;
    const toCurrency = dest ? p.toCurrency || paymentCurrency(dest, p.currency) : null;
    const received = dest ? round2(toCurrency === p.currency || p.received == null ? amount : +p.received) : null;
    if (dest) { adjustLine(dest, toCurrency, received, p.date); dest._mt = nowMs; }
    const unask = (item) => { if (item.reask) { item.reask = item.reask.filter((d) => d !== p.date); if (!item.reask.length) delete item.reask; } };
    const prev = {};
    if (p.type === 'saver') {
      const dep = (state.deposits || []).find((d) => d.id === p.id);
      if (dep) {
        prev.lastHandled = dep.lastHandled || null;
        if (!dep.lastHandled || dep.lastHandled < p.date) dep.lastHandled = p.date;
        if (p.paidIn !== false) dep.paid = { ...(dep.paid || {}), [p.date]: round2(amount) };
        unask(dep);
        dep._mt = nowMs;
      }
    } else if (p.type === 'cashflow') {
      const cf = (state.cashflows || []).find((c) => c.id === p.id);
      if (cf) {
        prev.lastHandled = cf.lastHandled || null;
        if (!cf.lastHandled || cf.lastHandled < p.date) cf.lastHandled = p.date;
        unask(cf);
        cf._mt = nowMs;
      }
    } else {
      const e = (state.spending || []).find((x) => x.id === p.id);
      if (e) { e.paidOn = p.date; e._mt = nowMs; }
    }
    // Every answer is recorded (not only deductions), so it can be undone later.
    const applied = !!(apply && acct);
    const outcome = applied ? 'applied' : p.type === 'saver' && p.paidIn === false ? 'notpaid' : 'included';
    const named = acct || (state.accounts || []).find((a) => a.id === p.accountId);
    const entry = {
      id: `pay-${p.key}`, date: p.date, kind: 'payment', name: p.name, outcome, applied, amount: round2(p.sign * amount), currency: p.currency,
      accountId: named ? named.id : null, accountName: named ? named.name : null, prev, _mt: nowMs,
    };
    if (applied && other) { entry.paidCurrency = other.currency; entry.paidAmount = round2(+other.amount); }
    if (dest) Object.assign(entry, { toAccountId: dest.id, toAccountName: dest.name, toCurrency, received });
    state.activity = [entry, ...(state.activity || []).filter((x) => x.id !== entry.id)].slice(0, ACTIVITY_MAX);
    return entry;
  }

  // Undoes a recorded answer to a payment: reverses any balance change and puts the payment back
  // in the "to confirm" list, so it can be answered again. Returns the payment's key.
  function undoPayment(state, entryId, nowMs) {
    const entry = (state.activity || []).find((e) => e.id === entryId && e.kind === 'payment');
    if (!entry) return null;
    const key = entry.id.replace(/^pay-/, '');
    const [type, id, date] = key.split(':');
    const applied = entry.applied ?? !!entry.accountId; // older entries were only recorded when applied
    if (applied) {
      const acct = (state.accounts || []).find((a) => a.id === entry.accountId);
      if (acct) {
        if (entry.paidCurrency) adjustLine(acct, entry.paidCurrency, entry.amount < 0 ? +entry.paidAmount : -entry.paidAmount, entry.date);
        else adjustLine(acct, entry.currency, -entry.amount, entry.date);
        acct._mt = nowMs;
      }
      const dest = entry.toAccountId && (state.accounts || []).find((a) => a.id === entry.toAccountId);
      if (dest) { adjustLine(dest, entry.toCurrency, -entry.received, entry.date); dest._mt = nowMs; }
    }
    const reopen = (item) => {
      // The latest answer: step back. An earlier one: ask about that date again.
      if (item.lastHandled === date && entry.prev && 'lastHandled' in entry.prev) {
        if (entry.prev.lastHandled) item.lastHandled = entry.prev.lastHandled;
        else delete item.lastHandled;
        if (item.trackFrom && date < item.trackFrom) item.reask = [...new Set([...(item.reask || []), date])];
      } else item.reask = [...new Set([...(item.reask || []), date])].sort();
      item._mt = nowMs;
    };
    if (type === 'cf') {
      const cf = (state.cashflows || []).find((c) => c.id === id);
      if (cf) reopen(cf);
    } else if (type === 'rs') {
      const dep = (state.deposits || []).find((d) => d.id === id);
      if (dep) {
        if (dep.paid) { dep.paid = { ...dep.paid }; delete dep.paid[date]; }
        reopen(dep);
      }
    } else if (type === 'card') {
      const e = (state.spending || []).find((x) => x.id === id);
      if (e) { delete e.paidOn; e._mt = nowMs; }
    }
    state.activity = state.activity.filter((e) => e.id !== entry.id);
    state.deleted = { ...(state.deleted || {}), [entry.id]: nowMs };
    return key;
  }

  // "Saving" cash-flow items that are a regular saver's monthly payment (linked with `saverId`, or
  // same currency + amount, monthly), so the payment is counted and confirmed once.
  function regularSaverMatches(state, today) {
    const savers = (state.deposits || []).filter((d) => d.kind === 'regular' && +d.monthlyAmount > 0 && !depositValue(d, today).matured);
    const out = [];
    for (const cf of state.cashflows || []) {
      if (!inMonth(cf, today.slice(0, 7)) || cf.kind !== 'saving' || cf.notSaver) continue;
      const taken = new Set(out.map((m) => m.depositId));
      const hit = cf.saverId
        ? savers.find((d) => d.id === cf.saverId)
        : savers.find((d) => !taken.has(d.id) && d.currency === cf.currency && cf.frequency === 'monthly' && Math.abs(amountOn(cf, today) - +d.monthlyAmount) <= Math.max(1, 0.01 * +d.monthlyAmount));
      if (hit) out.push({ cashflowId: cf.id, depositId: hit.id, linked: !!cf.saverId });
    }
    return out;
  }

  // How much `amount` (in `currency`) is more than the account holds in that currency today
  // (0 when it's covered). Used to warn before a transfer, buy or payment overdraws it.
  function shortfall(acct, currency, amount, today) {
    const line = accountBalances(acct || {}).find((b) => b.currency === currency);
    const have = line ? balanceValue(line, today).value : 0;
    return Math.max(0, round2((+amount || 0) - have));
  }

  // ---------- buying & selling ----------
  // Average-cost method: a buy adds its cost (fee included) to the average; a sell keeps the
  // average and records the realised profit = proceeds − fee − quantity × average cost.
  // The cash side is in the account's own currency (`cashCurrency`/`cashAmount`), so a USD
  // stock bought with GBP uses what the broker actually charged.
  function applyTrade(state, t, nowMs) {
    const list = state[t.section] = state[t.section] || [];
    let h = list.find((x) => x.id === t.holdingId);
    if (!h && t.side === 'buy' && t.newHolding) {
      h = { ...t.newHolding, id: t.holdingId, quantity: 0, avgCost: 0 };
      list.push(h);
    }
    if (!h) throw new Error('Holding not found');
    const held = +h.quantity || 0;
    if (t.side === 'split') return applySplit(state, h, t, nowMs);
    if (t.side === 'dividend') return applyDividend(state, h, t, nowMs);
    const qty = +t.quantity || 0;
    const price = +t.price || 0;
    const fee = +t.fee || 0;
    if (!(qty > 0)) throw new Error('Enter a quantity above 0.');
    if (t.side === 'sell' && qty > held + 1e-9) throw new Error(`You only hold ${held}.`);
    const before = { quantity: held, avgCost: +h.avgCost || 0 };
    let realised = null;
    if (t.side === 'buy') {
      const cost = held * before.avgCost + qty * price + fee;
      h.quantity = +(held + qty).toFixed(10);
      h.avgCost = h.quantity ? cost / h.quantity : 0;
    } else {
      realised = round2(qty * price - fee - qty * before.avgCost);
      h.quantity = Math.max(0, +(held - qty).toFixed(10));
    }
    if (h.source === 'manual' && t.updatePrice !== false) h.manualPrice = price;
    h._mt = nowMs;
    // Top up the cash account first (a transfer), then move the cash for the trade.
    if (t.topUp && +t.topUp.amount > 0) {
      transfer(state, { id: `tr-${t.id}`, fromId: t.topUp.fromId, fromCurrency: t.topUp.fromCurrency, amount: +t.topUp.amount, toId: t.accountId, toCurrency: t.cashCurrency, received: +t.topUp.received, date: t.date, note: `Top-up to ${t.side === 'buy' ? 'buy' : 'trade'} ${h.symbol || h.coinId || ''}`.trim() }, nowMs);
    }
    const acct = t.accountId ? (state.accounts || []).find((a) => a.id === t.accountId) : null;
    const gross = t.side === 'buy' ? qty * price + fee : qty * price - fee;
    const cashCurrency = acct ? t.cashCurrency || h.currency : null;
    const cashAmount = acct ? round2(cashCurrency === h.currency || !isFinite(+t.cashAmount) || t.cashAmount == null ? gross : +t.cashAmount) : null;
    if (acct) {
      adjustLine(acct, cashCurrency, t.side === 'buy' ? -cashAmount : cashAmount, t.date);
      acct._mt = nowMs;
    }
    const entry = {
      id: t.id, date: t.date, side: t.side, section: t.section, holdingId: h.id, symbol: h.symbol || h.coinId || '', platform: h.platform || '',
      quantity: qty, price, fee, currency: h.currency, total: round2(gross), before, realised,
      // A millisecond after any top-up, so history lists the top-up before the trade.
      accountId: acct ? acct.id : null, accountName: acct ? acct.name : null, cashCurrency, cashAmount, _mt: nowMs + 1,
    };
    state.trades = [entry, ...(state.trades || [])];
    if (t.side === 'sell' && h.quantity === 0 && t.removeIfEmpty) {
      state[t.section] = list.filter((x) => x.id !== h.id);
      state.deleted = { ...(state.deleted || {}), [h.id]: nowMs };
    }
    return entry;
  }

  // A split multiplies the shares and divides the average cost (and price): value is unchanged.
  // `ratio` = new shares per old share — 2 for a 2-for-1 split, 0.1 for a 1-for-10 consolidation.
  function applySplit(state, h, t, nowMs) {
    const r = +t.ratio;
    if (!(r > 0) || r === 1) throw new Error('Enter the split ratio, e.g. 2 for a 2-for-1 split.');
    const before = { quantity: +h.quantity || 0, avgCost: +h.avgCost || 0 };
    h.quantity = +(before.quantity * r).toFixed(10);
    h.avgCost = before.avgCost / r;
    for (const k of ['manualPrice', 'lastPrice', 'prevClose']) if (+h[k]) h[k] = +h[k] / r;
    h._mt = nowMs;
    const entry = { id: t.id, date: t.date, side: 'split', section: t.section, holdingId: h.id, symbol: h.symbol || h.coinId || '', platform: h.platform || '', ratio: r, currency: h.currency, before, quantity: h.quantity, _mt: nowMs };
    state.trades = [entry, ...(state.trades || [])];
    return entry;
  }

  // A dividend received: paid into a cash account (in its currency, `cashAmount`), or reinvested
  // as `reinvestQty` new shares — then the amount becomes part of their cost.
  function applyDividend(state, h, t, nowMs) {
    const amount = +t.amount || 0;
    if (!(amount > 0)) throw new Error('Enter the dividend amount.');
    const before = { quantity: +h.quantity || 0, avgCost: +h.avgCost || 0 };
    const reinvestQty = +t.reinvestQty || 0;
    let acct = null, cashCurrency = null, cashAmount = null;
    if (reinvestQty > 0) {
      h.quantity = +(before.quantity + reinvestQty).toFixed(10);
      h.avgCost = (before.quantity * before.avgCost + amount) / h.quantity;
      h._mt = nowMs;
    } else if (t.accountId) {
      acct = (state.accounts || []).find((a) => a.id === t.accountId);
      if (acct) {
        cashCurrency = t.cashCurrency || h.currency;
        cashAmount = round2(cashCurrency === h.currency || t.cashAmount == null ? amount : +t.cashAmount);
        adjustLine(acct, cashCurrency, cashAmount, t.date);
        acct._mt = nowMs;
      }
    }
    const entry = {
      id: t.id, date: t.date, side: 'dividend', section: t.section, holdingId: h.id, symbol: h.symbol || h.coinId || '', platform: h.platform || '',
      amount: round2(amount), currency: h.currency, reinvestQty: reinvestQty || null, before, accountId: acct ? acct.id : null, accountName: acct ? acct.name : null, cashCurrency, cashAmount, _mt: nowMs,
    };
    state.trades = [entry, ...(state.trades || [])];
    return entry;
  }

  // Dividends actually received (optionally from a date), in base via `toBaseFn`.
  function dividendsReceived(trades, toBaseFn, fromDate, toDate) {
    const list = (trades || []).filter((e) => e.side === 'dividend' && (!fromDate || e.date >= fromDate) && (!toDate || e.date <= toDate));
    return { total: list.reduce((a, e) => a + toBaseFn(e.amount, e.currency), 0), list };
  }

  // Realised profit of sells (optionally one section, from a date), in base via `toBaseFn`.
  function realisedProfit(trades, toBaseFn, section, fromDate) {
    let total = 0;
    const sells = (trades || []).filter((e) => e.side === 'sell' && e.realised != null && (!section || e.section === section) && (!fromDate || e.date >= fromDate));
    for (const e of sells) total += toBaseFn(e.realised, e.currency);
    return { total, sells };
  }

  // Moves money between two of the user's own accounts (or currencies in one account).
  function transfer(state, t, nowMs) {
    const from = (state.accounts || []).find((a) => a.id === t.fromId);
    const to = (state.accounts || []).find((a) => a.id === t.toId);
    if (!from || !to) throw new Error('Account not found');
    adjustLine(from, t.fromCurrency, -t.amount, t.date);
    adjustLine(to, t.toCurrency, t.received, t.date);
    from._mt = nowMs;
    to._mt = nowMs;
    const entry = { id: t.id, date: t.date, kind: 'transfer', amount: round2(t.amount), currency: t.fromCurrency, received: round2(t.received), toCurrency: t.toCurrency, accountId: from.id, accountName: from.name, toAccountId: to.id, toAccountName: to.name, note: t.note || '', _mt: nowMs };
    state.activity = [entry, ...(state.activity || [])].slice(0, ACTIVITY_MAX);
    return entry;
  }

  // The monthly check-in falls on `settings.checkinDay` (1–31; the last day in shorter months).
  // Returns the date of the latest check-in on or before today — the one that's due if not done.
  function checkinDate(state, today) {
    const day = Math.min(31, Math.max(1, Math.round(+((state.settings || {}).checkinDay) || 1)));
    const d = parseDate(today);
    const inMonth = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
    let due = inMonth(d.getFullYear(), d.getMonth());
    if (d < due) due = inMonth(d.getFullYear(), d.getMonth() - 1);
    return toISO(due);
  }
  const checkinId = (state, today) => `checkin-${checkinDate(state, today).slice(0, 7)}`;
  function checkinDue(state, today) {
    // Any check-in on or after the due date counts (also after the check-in day is changed).
    const due = checkinDate(state, today);
    return (state.accounts || []).length > 0 && !(state.activity || []).some((e) => e.kind === 'checkin' && e.date >= due);
  }
  function recordCheckin(state, today, skipped, nowMs) {
    const entry = { id: checkinId(state, today), date: today, kind: 'checkin', skipped: !!skipped, _mt: nowMs };
    state.activity = [entry, ...(state.activity || []).filter((x) => x.id !== entry.id)].slice(0, ACTIVITY_MAX);
  }

  // An account on `platform` (preferring one that holds `currency`), creating
  // "<platform>" with a deterministic id if there is none, so synced devices agree.
  function accountForPlatform(state, platform, currency) {
    const same = (state.accounts || []).filter((a) => platform && a.platform === platform);
    const hit = same.find((a) => accountBalances(a).some((b) => b.currency === currency)) || same[0];
    if (hit) return hit;
    const id = `auto-${slug(platform || 'bank')}`;
    let acct = state.accounts.find((a) => a.id === id);
    if (!acct) {
      acct = { id, name: platform || 'Bank account', platform: platform || '', type: 'savings', balances: [] };
      state.accounts.push(acct);
    }
    return acct;
  }

  // Every fixed deposit is held in a bank account (`accountId`) and takes that account's
  // platform. Older deposits that only had a platform are attached to a matching account.
  // ---------- credit cards ----------

  // Bills that are recorded with a due date and not yet confirmed as paid.
  function unpaidCardBills(state) {
    return (state.spending || []).filter((e) => e.dueDate && !e.paidOn && +e.amount);
  }

  // Payment due date for a statement month: the card's due day in the following month.
  function cardDueDate(card, month) {
    const day = +(card && card.dueDay);
    if (!day || !/^\d{4}-\d{2}$/.test(month || '')) return null;
    const next = addMonths(parseDate(`${month}-01`), 1);
    const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    return toISO(new Date(next.getFullYear(), next.getMonth(), Math.min(day, last)));
  }

  // Every spending record belongs to a card (`cardId`) and shows its name. Older records that
  // only had a card name get a card created for that name (deterministic id, so devices agree).
  function linkCards(state) {
    state.cards = state.cards || [];
    for (const e of state.spending || []) {
      let card = state.cards.find((c) => c.id === e.cardId);
      if (!card) {
        const name = String(e.platform || 'Card').trim() || 'Card';
        const id = `card-${slug(name)}`;
        card = state.cards.find((c) => c.id === id);
        if (!card) {
          card = { id, name, platform: '', currency: e.currency, dueDay: e.dueDate ? +e.dueDate.slice(8, 10) : null, payFromAccountId: e.payFromAccountId || '' };
          state.cards.push(card);
        }
        e.cardId = card.id;
      }
      if (e.platform !== card.name) e.platform = card.name;
    }
    return state;
  }

  function linkDeposits(state) {
    state.accounts = state.accounts || [];
    for (const dep of state.deposits || []) {
      let acct = state.accounts.find((a) => a.id === dep.accountId);
      if (!acct) {
        acct = accountForPlatform(state, dep.platform, dep.currency);
        dep.accountId = acct.id;
      }
      if ((acct.platform || '') !== (dep.platform || '')) dep.platform = acct.platform || '';
    }
    return state;
  }

  // ---------- platforms & regions ----------

  // Value of one item split by currency (liabilities as a positive balance owed).
  function itemParts(section, item, today) {
    if (section === 'accounts') return accountBalances(item).map((b) => ({ currency: b.currency, value: balanceValue(b, today).value }));
    return [{ currency: item.currency, value: itemValue(section, item, today) }];
  }

  // Every item's value today in the base currency (loans: what's still owed), for item history.
  function itemValues(state, today) {
    const base = state.settings.baseCurrency;
    const out = {};
    for (const section of Object.keys(PLATFORM_GROUPS)) {
      for (const item of state[section] || []) {
        let v = 0;
        for (const part of itemParts(section, item, today)) {
          const c = convert(part.value, part.currency || base, base, state.fx);
          if (isFinite(c)) v += c;
        }
        out[item.id] = round2(v);
      }
    }
    return out;
  }

  // Native-currency value of one single-currency item.
  function itemValue(section, item, today) {
    switch (section) {
      case 'stocks':
      case 'crypto': return holdingValue(item).marketValue;
      case 'deposits': return depositValue(item, today).value;
      case 'properties': return propertyValue(item, today).value;
      case 'others': return otherAssetValue(item, today);
      case 'liabilities': return loanBalance(item, today).balance;
      default: return 0;
    }
  }

  const PLATFORM_GROUPS = { accounts: 'cash', stocks: 'invest', crypto: 'invest', deposits: 'deposits', properties: 'property', others: 'other', liabilities: 'debt' };

  // Older versions stored the platform under a section-specific key.
  const LEGACY_PLATFORM_KEYS = { accounts: 'institution', stocks: 'broker', crypto: 'wallet', deposits: 'bank' };

  function migratePlatforms(state) {
    for (const [section, old] of Object.entries(LEGACY_PLATFORM_KEYS)) {
      for (const item of state[section] || []) {
        if (item.platform == null && item[old] != null) item.platform = item[old];
        delete item[old];
      }
    }
    return state;
  }

  const CURRENCY_REGIONS = {
    HKD: 'Hong Kong', GBP: 'United Kingdom', USD: 'United States', EUR: 'Eurozone', SGD: 'Singapore', MYR: 'Malaysia',
    CNY: 'Mainland China', JPY: 'Japan', AUD: 'Australia', CAD: 'Canada', NZD: 'New Zealand', CHF: 'Switzerland', TWD: 'Taiwan',
  };

  // Totals per platform and per region (regions are assigned to platforms in state.platformMeta).
  function platformBreakdown(state, today) {
    const base = state.settings.baseCurrency;
    const meta = state.platformMeta || {};
    const rows = new Map();
    for (const [section, group] of Object.entries(PLATFORM_GROUPS)) {
      for (const item of state[section] || []) {
        const name = String(item.platform || '').trim();
        if (!rows.has(name)) rows.set(name, { name, region: (meta[name] && meta[name].region) || '', regionGuessed: false, cash: 0, invest: 0, deposits: 0, property: 0, other: 0, debt: 0, count: 0, currencies: new Set() });
        const row = rows.get(name);
        for (const part of itemParts(section, item, today)) {
          const v = convert(part.value, part.currency || base, base, state.fx);
          if (isFinite(v)) row[group] += v;
          if (part.currency) row.currencies.add(part.currency);
        }
        row.count += 1;
      }
    }
    for (const e of unpaidCardBills(state)) {
      const card = (state.cards || []).find((c) => c.id === e.cardId);
      const name = String((card && card.platform) || '').trim();
      if (!rows.has(name)) rows.set(name, { name, region: (meta[name] && meta[name].region) || '', regionGuessed: false, cash: 0, invest: 0, deposits: 0, property: 0, other: 0, debt: 0, count: 0, currencies: new Set() });
      const row = rows.get(name);
      const v = convert(+e.amount || 0, e.currency || base, base, state.fx);
      if (isFinite(v)) row.debt += v;
      if (e.currency) row.currencies.add(e.currency);
    }
    const platforms = [...rows.values()].map((r) => {
      const assets = r.cash + r.invest + r.deposits + r.property + r.other;
      const currencies = [...r.currencies].sort();
      let { region, regionGuessed } = r;
      // No region set yet: guess from the platform's only currency (HKD -> Hong Kong, GBP -> UK...).
      if (!region && r.name && currencies.length === 1 && CURRENCY_REGIONS[currencies[0]]) {
        region = CURRENCY_REGIONS[currencies[0]];
        regionGuessed = true;
      }
      return { ...r, region, regionGuessed, currencies, assets, net: assets - r.debt };
    });
    platforms.sort((a, b) => b.net - a.net);
    const regionMap = new Map();
    for (const p of platforms) {
      const key = p.region || '';
      const r = regionMap.get(key) || { region: key, assets: 0, debt: 0, net: 0, platforms: 0 };
      r.assets += p.assets;
      r.debt += p.debt;
      r.net += p.net;
      r.platforms += 1;
      regionMap.set(key, r);
    }
    const regions = [...regionMap.values()].sort((a, b) => b.net - a.net);
    return { platforms, regions };
  }

  return {
    parseDate, toISO, addDays, addMonths, daysBetween, monthsBetween,
    convert,
    depositGrowth, depositMaturity, depositValue, regularSaverValue, regularSaverMatches, monthlyDates, impliedRate, settleDeposits,
    loanBalance,
    otherAssetValue,
    latestValuation, propertyValue,
    holdingValue, holdingView, costMethod, dilutedRealised, dividendPerYear,
    monthlyAmount, amountOn, inMonth, hasEnded, occurrences, nextOccurrence, targetMix, MIX_KEYS,
    upsertHistory, monthsToGoal, spendingByMonth,
    summarize,
    itemValue, itemParts, itemValues, migratePlatforms, platformBreakdown,
    accountBalances, migrateAccounts, cashByCurrency, accountForPlatform, linkDeposits,
    unpaidCardBills, cardDueDate, linkCards,
    balanceValue, adjustLine, pendingPayments, resolvePayment, undoPayment, paymentCurrency, regularSaverSchedule, regularPaid, shortfall, applyTrade, realisedProfit, dividendsReceived, transfer, checkinDate, checkinDue, recordCheckin,
  };
});
