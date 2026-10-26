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
        const mode = dep.onMaturity || 'keep';
        if (mode !== 'cash' && mode !== 'renew') continue;
        const v = depositValue(dep, today);
        if (!v.matured) continue;
        const label = dep.platform || 'Bank';
        const entry = { id: `fd-${dep.id}`, date: v.maturityDate, kind: mode === 'cash' ? 'deposit-cash' : 'deposit-renew', platform: label, ref: dep.name || '', amount: round2(v.maturityValue), interest: round2(v.maturityInterest), currency: dep.currency, _mt: nowMs };
        if (mode === 'cash') {
          let acct = (state.accounts || []).find((a) => a.id === dep.payoutAccountId);
          if (!acct) {
            const id = `auto-${slug(label)}-${String(dep.currency || '').toLowerCase()}`;
            acct = state.accounts.find((a) => a.id === id);
            if (!acct) {
              acct = { id, name: `${label} cash`, platform: dep.platform || '', type: 'savings', currency: dep.currency, balance: 0 };
              state.accounts.push(acct);
            }
          }
          const amount = convert(v.maturityValue, dep.currency, acct.currency, state.fx);
          if (!isFinite(amount)) continue; // no exchange rate yet — try again later
          acct.balance = round2((+acct.balance || 0) + amount);
          acct.updatedAt = new Date(nowMs).toISOString();
          acct._mt = nowMs;
          entry.accountName = acct.name;
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
      state.activity = [...created, ...(state.activity || []).filter((e) => !ids.has(e.id))].slice(0, 200);
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

  function holdingValue(h) {
    const qty = +h.quantity || 0;
    const live = isFinite(h.lastPrice) && h.lastPrice > 0;
    const price = live ? +h.lastPrice : +h.manualPrice || +h.avgCost || 0;
    const marketValue = qty * price;
    const cost = qty * (+h.avgCost || 0);
    const prev = isFinite(h.prevClose) && h.prevClose > 0 ? +h.prevClose : null;
    return {
      price,
      live,
      marketValue,
      cost,
      pnl: marketValue - cost,
      pnlPct: cost ? (marketValue - cost) / cost : 0,
      dayChange: prev ? qty * (price - prev) : 0,
      dayChangePct: prev ? (price - prev) / prev : 0,
    };
  }

  // ---------- recurring cash flow ----------

  const PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, semiannually: 1 / 6, yearly: 1 / 12, once: 0 };

  function monthlyAmount(cf) {
    return (+cf.amount || 0) * (PER_MONTH[cf.frequency] ?? 1);
  }

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
    const anchor = parseDate(cf.nextDate);
    if (!anchor) return [];
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

    const totals = { cash: 0, stocks: 0, crypto: 0, deposits: 0, property: 0, other: 0 };
    let investCost = 0, investPnl = 0, dayChange = 0, depositDaily = 0, depositInterest = 0;
    const events = [];
    const alerts = [];
    const horizon = toISO(addDays(parseDate(today), 30));

    for (const a of state.accounts || []) totals.cash += toBase(a.balance, a.currency);

    for (const [list, key] of [[state.stocks, 'stocks'], [state.crypto, 'crypto']]) {
      for (const h of list || []) {
        const v = holdingValue(h);
        totals[key] += toBase(v.marketValue, h.currency);
        investCost += toBase(v.cost, h.currency);
        investPnl += toBase(v.pnl, h.currency);
        dayChange += toBase(v.dayChange, h.currency);
      }
    }

    for (const d of state.deposits || []) {
      const v = depositValue(d, today);
      totals.deposits += toBase(v.value, d.currency);
      depositDaily += toBase(v.dailyInterest, d.currency);
      depositInterest += toBase(v.interest, d.currency);
      if (v.maturityDate >= today && v.maturityDate <= horizon) {
        events.push({ date: v.maturityDate, label: `Fixed deposit matures: ${d.bank || d.name || 'FD'}`, amount: toBase(v.maturityValue, d.currency), kind: 'deposit' });
      } else if (v.matured) {
        alerts.push({ level: 'info', text: `Fixed deposit at ${d.bank || 'bank'} matured on ${v.maturityDate} — renew it or move it to cash.` });
      }
    }

    let rentMonthly = 0;
    for (const p of state.properties || []) {
      const v = propertyValue(p, today);
      totals.property += toBase(v.value, p.currency);
      rentMonthly += toBase(p.monthlyRent, p.currency);
      if (v.stale) alerts.push({ level: 'warn', text: `"${p.name}" value was last updated ${v.lastDate || 'never'} — it is due a ${p.updateFrequency || 'monthly'} update.` });
      else if (v.nextUpdate <= horizon) events.push({ date: v.nextUpdate, label: `Update value: ${p.name}`, amount: null, kind: 'property' });
    }

    for (const o of state.others || []) totals.other += toBase(otherAssetValue(o, today), o.currency);

    let liabilities = 0, debtPayments = 0;
    for (const l of state.liabilities || []) {
      const v = loanBalance(l, today);
      liabilities += toBase(v.balance, l.currency);
      if (v.balance > 0) debtPayments += toBase(l.payment, l.currency);
    }

    const flow = { income: 0, expense: 0, subscription: 0, saving: 0 };
    let notOnCard = 0;
    for (const cf of state.cashflows || []) {
      if (cf.active === false) continue;
      const monthly = toBase(monthlyAmount(cf), cf.currency);
      flow[cf.kind] = (flow[cf.kind] || 0) + monthly;
      if ((cf.kind === 'expense' || cf.kind === 'subscription') && !cf.onCard) notOnCard += monthly;
      for (const date of occurrences(cf, today, horizon)) {
        events.push({ date, label: cf.name, amount: toBase(cf.amount, cf.currency), kind: cf.kind });
      }
    }
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const assets = Object.values(totals).reduce((s, x) => s + x, 0);
    const netWorth = assets - liabilities;
    // Actual spending: average of the latest recorded months (e.g. credit card statements),
    // plus fixed bills that are NOT paid by card (card-paid ones are already in the statement).
    const spendMonths = spendingByMonth(state.spending, toBase);
    const recentSpend = spendMonths.slice(0, SPENDING_AVG_MONTHS);
    const cardSpendAvg = recentSpend.length ? recentSpend.reduce((a, m) => a + m.total, 0) / recentSpend.length : null;
    const estimatedSpending = flow.expense + flow.subscription;
    const actualSpending = cardSpendAvg == null ? null : cardSpendAvg + notOnCard;
    const spending = actualSpending ?? estimatedSpending;
    const netMonthly = flow.income - spending;
    const passiveMonthly = depositDaily * 365 / 12 + rentMonthly;
    const liquid = totals.cash;

    if (missingFx.size) alerts.push({ level: 'warn', text: `No exchange rate for ${[...missingFx].join(', ')} — those items are excluded from totals. Refresh rates in Settings.` });

    return {
      base,
      totals,
      assets,
      liabilities,
      netWorth,
      investCost,
      investPnl,
      investPnlPct: investCost ? investPnl / investCost : 0,
      dayChange,
      depositDaily,
      depositInterest,
      flow,
      spending,
      spendingSource: actualSpending == null ? 'estimate' : 'actual',
      estimatedSpending,
      actualSpending,
      cardSpendAvg,
      spendAvgMonths: recentSpend.length,
      notOnCard,
      spendMonths,
      netMonthly,
      savingsRate: flow.income ? (flow.income - spending) / flow.income : 0,
      passiveMonthly,
      rentMonthly,
      debtPayments,
      runwayMonths: spending ? liquid / spending : Infinity,
      debtToAsset: assets ? liabilities / assets : 0,
      events,
      alerts,
    };
  }

  // ---------- platforms & regions ----------

  // Native-currency value of one item (liabilities as a positive balance owed).
  function itemValue(section, item, today) {
    switch (section) {
      case 'accounts': return +item.balance || 0;
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
        const v = convert(itemValue(section, item, today), item.currency || base, base, state.fx);
        if (isFinite(v)) row[group] += v;
        row.count += 1;
        if (item.currency) row.currencies.add(item.currency);
      }
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
    depositGrowth, depositMaturity, depositValue, impliedRate, settleDeposits,
    loanBalance,
    otherAssetValue,
    latestValuation, propertyValue,
    holdingValue,
    monthlyAmount, occurrences, nextOccurrence,
    upsertHistory, monthsToGoal, spendingByMonth,
    summarize,
    itemValue, migratePlatforms, platformBreakdown,
  };
});
