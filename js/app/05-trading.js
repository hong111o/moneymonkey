/* MoneyMonkey app — Buying, selling, dividends and splits.
 * The js/app/*.js files are loaded in order as plain scripts and share one scope (see index.html). */
'use strict';

// ---------------------------------------------------------------- buy & sell

// Buying or selling moves money between a holding and a cash account (usually the broker's
// "Brokerage cash"), so net worth only changes by the fee. Average cost is updated on buys;
// sells record the realised profit. A buy short of cash can top the account up first.
function openTrade(section, holdingId, side) {
  const kind = section === 'crypto' ? 'coin' : 'share';
  const list = state[section];
  const holdingOf = (v) => list.find((h) => h.id === v.holdingId);
  const label = (h) => `${h.symbol || h.coinId}${h.platform ? ` · ${h.platform}` : ''} (${num(h.quantity, 8)})`;
  const curOf = (v) => (holdingOf(v) || {}).currency || (/^[A-Z]{3}$/.test(v.currency || '') ? v.currency : base());
  const platformOf = (v) => (holdingOf(v) ? holdingOf(v).platform : v.platform) || '';
  const acctOpts = (v) => {
    const plat = platformOf(v);
    const rank = (a) => (a.type === 'brokerage' && (a.platform || '') === plat ? 0 : (a.platform || '') === plat ? 1 : a.type === 'brokerage' ? 2 : 3);
    // A broker with no cash account yet: offer to create "<broker> cash" (made on save).
    const offerNew = plat && !brokerCashOn(plat);
    return [
      ...(offerNew ? [{ value: '__new', label: `+ New “${plat} cash” account` }] : []),
      { value: '', label: 'None — don’t change any cash balance' },
      ...state.accounts.slice().sort((a, b) => rank(a) - rank(b)).map((a) => ({ value: a.id, label: `${a.name}${a.platform ? ` · ${a.platform}` : ''}` })),
    ];
  };
  const brokerCashOn = (plat) => state.accounts.find((a) => a.type === 'brokerage' && (a.platform || '') === plat);
  const newCashAcct = (v) => ({ id: '__new', name: `${platformOf(v)} cash`, platform: platformOf(v), type: 'brokerage', balances: [] });
  const acctOf = (v) => (v.accountId === '__new' && platformOf(v) ? newCashAcct(v) : state.accounts.find((a) => a.id === v.accountId));
  const cashCurOpts = (v) => {
    const a = acctOf(v);
    if (!a) return [{ value: '', label: '—' }];
    const first = Calc.paymentCurrency(a, curOf(v));
    const lines = Calc.accountBalances(a).map((b) => b.currency);
    return [first, ...lines.filter((c) => c !== first)].map((c) => ({ value: c, label: `${c} balance` }));
  };
  const cashCur = (v) => (acctOf(v) ? v.cashCurrency || cashCurOpts(v)[0].value : '');
  const gross = (v) => (v.side === 'dividend' ? +v.amount || 0 : (v.side === 'buy' ? 1 : -1) * (+v.fee || 0) + (+v.quantity || 0) * (+v.price || 0));
  const trades = (v) => v.side === 'buy' || v.side === 'sell';
  const movesCash = (v) => v.side !== 'split' && !(v.side === 'dividend' && v.reinvest);
  const cashAmt = (v) => {
    const cc = cashCur(v);
    if (!cc) return null;
    if (cc === curOf(v)) return round2(gross(v));
    if (v.cashAmount != null) return v.cashAmount;
    const c = Calc.convert(gross(v), curOf(v), cc, state.fx);
    return isFinite(c) ? round2(c) : null;
  };
  const short = (v) => (v.side === 'buy' && acctOf(v) && cashAmt(v) != null ? Calc.shortfall(acctOf(v), cashCur(v), cashAmt(v), v.date || todayISO()) : 0);
  // The top-up is a transfer: from one of the other account's balances, with the amount sent
  // and the amount received (the broker's rate). Either can be left blank: the received amount
  // defaults to what's missing, and the other side to today's rate.
  const topUpAcct = (v) => state.accounts.find((a) => a.id === v.topUpFrom);
  const topUpCurOpts = (v) => {
    const from = topUpAcct(v);
    if (!from) return [{ value: '', label: '—' }];
    const lines = Calc.accountBalances(from).map((b) => ({ c: b.currency, base: toBase(Calc.balanceValue(b, todayISO()).value, b.currency) || 0 }));
    if (!lines.length) return [{ value: cashCur(v), label: `${cashCur(v)} balance` }];
    // Same currency first if it covers what's missing, else the biggest balance.
    const same = from && Calc.shortfall(from, cashCur(v), short(v), todayISO()) === 0 && lines.find((l) => l.c === cashCur(v));
    lines.sort((x, y) => y.base - x.base);
    const first = same ? same.c : lines[0].c;
    return [first, ...lines.map((l) => l.c).filter((c) => c !== first)].map((c) => ({ value: c, label: `${c} balance` }));
  };
  const topUpOf = (v) => {
    const from = topUpAcct(v);
    if (!from || v.side !== 'buy' || !acctOf(v)) return null;
    const cc = cashCur(v);
    const fromCurrency = v.topUpCurrency || topUpCurOpts(v)[0].value;
    const rate = (amt, a, b) => (a === b ? amt : round2(Calc.convert(amt, a, b, state.fx)));
    let received = v.topUpReceived, amount = v.topUpSent;
    if (received == null && amount == null) received = short(v);
    if (received == null) received = rate(amount, fromCurrency, cc);
    if (amount == null) amount = rate(received, cc, fromCurrency);
    if (!(received > 0) || !isFinite(amount)) return null;
    return { fromId: from.id, from, fromCurrency, amount, received, guessed: fromCurrency !== cc && (v.topUpSent == null || v.topUpReceived == null) };
  };
  const newFields = SECTIONS[section].fields
    .filter((f) => ['symbol', 'name', 'coinId', 'currency', 'platform', 'source'].includes(f.key))
    .map((f) => ({ ...f, showIf: (v) => v.holdingId === '__new' }));
  const h0 = list.find((h) => h.id === holdingId);
  const start = { side, holdingId: h0 ? h0.id : side === 'buy' ? '__new' : (list[0] || {}).id, date: todayISO() };
  if (!start.holdingId) return toast(`Nothing to ${side} yet — add a ${kind === 'coin' ? 'coin' : 'holding'} first.`);
  // Default to the broker's own cash account, if there is one.
  start.accountId = (brokerCashOn(platformOf(start)) || {}).id || (platformOf(start) ? '__new' : '');
  if (h0 && (h0.lastPrice || h0.manualPrice)) start.price = +(h0.lastPrice || h0.manualPrice);
  if (side === 'sell' && h0) start.quantity = +h0.quantity;
  openForm({
    title: `${{ buy: 'Buy', sell: 'Sell', dividend: 'Dividend', split: 'Split' }[side]}${h0 ? ` ${h0.symbol || h0.coinId}` : ''}`,
    intro: 'Moves money between the holding and a cash account, so your net worth only changes by the fee. Buying updates the average cost; selling keeps it and records your profit.',
    // A new stock: its currency from the ticker, with a warning if they don't match.
    onChange: section === 'stocks' ? stockCurrencyHelper : null,
    fields: [
      { key: 'side', label: 'Action', type: 'select', options: opt([['buy', 'Buy'], ['sell', 'Sell'], ...(section === 'stocks' ? [['dividend', 'Dividend received']] : []), ['split', 'Split / consolidation']]) },
      { key: 'holdingId', label: kind === 'coin' ? 'Coin' : 'Holding', type: 'select', span: true, options: (v) => [...list.map((h) => ({ value: h.id, label: label(h) })), ...(v.side === 'buy' ? [{ value: '__new', label: `+ New ${kind === 'coin' ? 'coin' : 'holding'}…` }] : [])] },
      ...newFields,
      { key: 'quantity', label: kind === 'coin' ? 'Quantity' : 'Shares', type: 'number', required: true, showIf: trades },
      { key: 'price', label: `Price per ${kind}`, type: 'number', required: true, help: 'In the holding’s currency.', showIf: trades },
      { key: 'fee', label: 'Fee (optional)', type: 'number', help: 'In the holding’s currency, e.g. commission or FX fee.', showIf: trades },
      { key: 'amount', label: 'Dividend received (total)', type: 'number', required: true, help: 'In the holding’s currency, after any withholding tax.', showIf: (v) => v.side === 'dividend' },
      { key: 'reinvest', label: 'Reinvested — bought more shares instead of cash', type: 'checkbox', span: true, showIf: (v) => v.side === 'dividend' },
      { key: 'reinvestQty', label: 'Shares bought with it', type: 'number', required: true, showIf: (v) => v.side === 'dividend' && v.reinvest },
      { key: 'ratio', label: `New ${kind}s for each old one`, type: 'number', required: true, help: '2 for a 2-for-1 split, 3 for 3-for-1, 0.1 for a 1-for-10 consolidation. Value stays the same.', showIf: (v) => v.side === 'split' },
      { key: 'date', label: 'Date', type: 'date', required: true, default: todayISO },
      { key: 'accountId', label: 'Cash account', type: 'select', span: true, options: acctOpts, help: 'Where the money comes from (buy) or goes to (sell, dividend) — usually the broker’s cash.', showIf: movesCash },
      { key: 'cashCurrency', label: 'From / into', type: 'select', options: cashCurOpts, showIf: (v) => movesCash(v) && !!acctOf(v) },
      { key: 'cashAmount', label: 'Amount in that currency', type: 'number', showIf: (v) => movesCash(v) && !!acctOf(v) && cashCur(v) !== curOf(v), help: 'What the broker actually charged or paid — leave blank to use today’s rate.' },
      { key: 'topUpFrom', label: 'Not enough cash? Top up first from', type: 'select', span: true, showIf: (v) => v.side === 'buy' && !!acctOf(v), options: (v) => [{ value: '', label: 'No top-up' }, ...state.accounts.filter((a) => a.id !== v.accountId).map((a) => ({ value: a.id, label: `${a.name}${a.platform ? ` · ${a.platform}` : ''}` }))] },
      { key: 'topUpCurrency', label: 'From its', type: 'select', options: topUpCurOpts, showIf: (v) => v.side === 'buy' && !!v.topUpFrom && !!acctOf(v) },
      { key: 'topUpSent', label: 'Amount sent', type: 'number', showIf: (v) => v.side === 'buy' && !!v.topUpFrom && !!acctOf(v), help: 'In that balance’s currency.' },
      { key: 'topUpReceived', label: 'Amount received at the broker', type: 'number', showIf: (v) => v.side === 'buy' && !!v.topUpFrom && !!acctOf(v), help: 'In the cash account’s currency, at the broker’s rate. Leave both blank to top up exactly what’s missing at today’s rate.' },
      { key: 'removeIfEmpty', label: 'Remove the holding if this sells all of it', type: 'checkbox', span: true, default: () => true, showIf: (v) => v.side === 'sell' },
    ],
    values: start,
    isNew: true,
    submitLabel: side === 'buy' ? 'Record buy' : 'Record sale',
    preview: (v) => {
      const h = holdingOf(v);
      const cur = curOf(v);
      const held = h ? +h.quantity || 0 : 0, avg = h ? +h.avgCost || 0 : 0;
      if (v.side === 'split') {
        const r = +v.ratio;
        if (!(r > 0) || !h) return '';
        return `${num(held, 8)} → <strong>${num(held * r, 8)}</strong> ${kind}s, average cost ${money(avg, cur)} → <strong>${money(avg / r, cur)}</strong>. The value doesn’t change.`;
      }
      if (v.side === 'dividend') {
        const amt = +v.amount || 0;
        if (!(amt > 0) || !h) return '';
        if (v.reinvest) return v.reinvestQty > 0 ? `${num(held, 8)} → <strong>${num(held + +v.reinvestQty, 8)}</strong> shares; average cost ${money(avg, cur)} → <strong>${money((held * avg + amt) / (held + +v.reinvestQty), cur)}</strong>.` : '';
        const a = acctOf(v);
        return `Dividend <strong>${money(amt, cur)}</strong>${a ? ` → into “${esc(a.name)}”: +${money(cashAmt(v), cashCur(v))}${cashCur(v) !== cur && v.cashAmount == null ? ' at today’s rate' : ''}` : ' — no cash account picked, only recorded'}.`;
      }
      const qty = +v.quantity || 0, price = +v.price || 0, fee = +v.fee || 0;
      if (!(qty > 0) || !(price >= 0)) return '';
      const out = [];
      if (v.side === 'buy') {
        const cost = qty * price + fee;
        const nq = held + qty;
        const cc0 = cashCur(v), amt0 = cashAmt(v);
        out.push(`Cost <strong>${money(cost, cur)}</strong>${fee ? ` incl. ${money(fee, cur)} fee` : ''}${cc0 && cc0 !== cur && amt0 != null ? ` (≈ ${money(amt0, cc0)})` : ''}.`);
        out.push(`After: ${num(nq, 8)} at an average of <strong>${money((held * avg + cost) / nq, cur)}</strong>${held ? ` (was ${money(avg, cur)})` : ''}.`);
      } else {
        if (h && qty > held + 1e-9) return `<span class="warn-text">You only hold ${num(held, 8)}.</span>`;
        const realised = qty * price - fee - qty * avg;
        out.push(`You receive <strong>${money(qty * price - fee, cur)}</strong>${fee ? ` after ${money(fee, cur)} fee` : ''}.`);
        out.push(`Profit on this sale: <strong class="${realised >= 0 ? 'pos' : 'neg'}">${signed(realised, cur)}</strong> (sold at ${money(price, cur)} vs average cost ${money(avg, cur)}).`);
        out.push(`After: ${num(held - qty, 8)} left${held - qty > 1e-9 ? `, average cost stays ${money(avg, cur)}` : ''}.`);
      }
      const a = acctOf(v);
      if (a) {
        const amt = cashAmt(v);
        const cc = cashCur(v);
        if (amt == null) out.push('No exchange rate yet — enter the amount in the account’s currency.');
        else {
          out.push(`${v.side === 'buy' ? 'From' : 'Into'} “${esc(a.name)}”: ${v.side === 'buy' ? '−' : '+'}${money(amt, cc)}${cc !== cur && v.cashAmount == null ? ' at today’s rate' : ''}.`);
          const sf = short(v);
          const tu = topUpOf(v);
          if (sf > 0) {
            if (tu) {
              out.push(`Top-up first: ${money(tu.amount, tu.fromCurrency)} from “${esc(tu.from.name)}” → +${money(tu.received, cc)}${tu.guessed ? ' (today’s rate — enter what the broker gave you if different)' : ''}${tu.received + 0.005 < sf ? ` — still <span class="neg">${money(sf - tu.received, cc)} short</span>` : ''}.`);
              const tuLeft = Calc.shortfall(tu.from, tu.fromCurrency, tu.amount, v.date || todayISO());
              if (tuLeft > 0.005) out.push(`<span class="warn-text">“${esc(tu.from.name)}” only has ${money(tu.amount - tuLeft, tu.fromCurrency)} in ${esc(tu.fromCurrency)} — ${money(tuLeft, tu.fromCurrency)} short.</span> Pick another balance or account, or update its balance.`);
            }
            else out.push(`<span class="warn-text">“${esc(a.name)}” only has ${money(Calc.balanceValue(Calc.accountBalances(a).find((b) => b.currency === cc) || { amount: 0 }, todayISO()).value, cc)} in ${esc(cc)} — ${money(sf, cc)} short.</span> Pick an account to top up from, or update its balance.`);
          }
        }
      } else out.push('No cash account picked: only the holding changes.');
      return out.join('<br>');
    },
    validate: (v) => {
      if (v.side === 'split') return +v.ratio > 0 && +v.ratio !== 1 ? null : 'Enter the split ratio, e.g. 2 for a 2-for-1 split.';
      if (v.side === 'dividend') return +v.amount > 0 ? (v.reinvest && !(+v.reinvestQty > 0) ? 'Enter how many shares were bought with it.' : null) : 'Enter the dividend amount.';
      if (!(v.quantity > 0)) return 'Enter a quantity above 0.';
      if (!(v.price >= 0)) return 'Enter the price.';
      const h = holdingOf(v);
      if (v.side === 'sell' && (!h || v.quantity > (+h.quantity || 0) + 1e-9)) return `You only hold ${num(h ? h.quantity : 0, 8)}.`;
      if (acctOf(v) && cashAmt(v) == null) return 'No exchange rate yet — enter the amount in the account’s currency.';
      if (v.holdingId === '__new' && section === 'stocks' && !v.symbol) return 'Enter the ticker symbol.';
      if (v.holdingId === '__new' && section === 'crypto' && !v.coinId) return 'Enter the CoinGecko id.';
      return null;
    },
    onSave: (v) => {
      const snap = JSON.stringify(state); // for Undo
      const tu = topUpOf(v);
      const left = Math.max(0, short(v) - (tu ? tu.received : 0));
      if (left > 0.005 && !confirm(`“${acctOf(v).name}” doesn’t have enough ${cashCur(v)} in the app — this leaves it ${money(-left, cashCur(v))}. If its real balance is higher, update it first. Record anyway?`)) return 'Not recorded — pick an account to top up from, or update the balance first.';
      const tuLeft = tu ? Calc.shortfall(tu.from, tu.fromCurrency, tu.amount, v.date) : 0;
      if (tuLeft > 0.005 && !confirm(`“${tu.from.name}” doesn’t have enough ${tu.fromCurrency} in the app for the top-up — it would be left at ${money(-tuLeft, tu.fromCurrency)}. Record anyway?`)) return 'Not recorded — pick another account to top up from.';
      if (v.accountId === '__new' && acctOf(v) && movesCash(v)) {
        const acct = { ...newCashAcct(v), id: uid(), updatedAt: new Date().toISOString(), _mt: Date.now() };
        state.accounts.push(acct);
        v.accountId = acct.id;
      }
      const isNew = v.holdingId === '__new';
      const id = isNew ? uid() : v.holdingId;
      const newHolding = isNew ? {
        ...(section === 'crypto' ? { coinId: v.coinId, symbol: v.symbol || v.coinId.toUpperCase() } : { symbol: v.symbol, name: v.name || '' }),
        platform: v.platform || '', currency: curOf(v), source: v.source || 'live', ...(v.source === 'manual' ? { manualPrice: +v.price } : {}),
      } : null;
      try {
        const e = Calc.applyTrade(state, {
          id: `trade-${uid()}`, side: v.side, section, holdingId: id, newHolding, quantity: +v.quantity, price: +v.price, fee: +v.fee || 0, date: v.date,
          amount: +v.amount || 0, reinvestQty: v.reinvest ? +v.reinvestQty : 0, ratio: +v.ratio,
          accountId: movesCash(v) && acctOf(v) ? v.accountId : null, cashCurrency: cashCur(v) || null, cashAmount: cashAmt(v),
          topUp: tu ? { fromId: tu.fromId, fromCurrency: tu.fromCurrency, amount: tu.amount, received: tu.received } : null,
          removeIfEmpty: !!v.removeIfEmpty,
        }, Date.now());
        commit();
        // Undo puts everything back: the holding (even if the sale removed it), cash and the trade.
        const gone = v.side === 'sell' && !state[section].some((h) => h.id === id);
        const msg = { buy: () => `Bought ${num(e.quantity, 8)} ${e.symbol}`, sell: () => `Sold ${num(e.quantity, 8)} ${e.symbol} · profit ${money(e.realised, e.currency)}${gone ? ' · holding removed' : ''}`, dividend: () => `Dividend ${money(e.amount, e.currency)} from ${e.symbol} recorded`, split: () => `${e.symbol} split ${num(e.ratio, 6)}-for-1 — now ${num(e.quantity, 8)}` }[e.side]();
        setTimeout(() => undoToast(msg, () => { restoreSnapshot(snap); toast(`${{ buy: 'Purchase', sell: 'Sale', dividend: 'Dividend', split: 'Split' }[e.side]} undone`); }));
        if (isNew && section === 'stocks') refreshPrices({ force: true });
      } catch (err) {
        return err.message;
      }
      return null;
    },
  });
}

// ---------------------------------------------------------------- change or delete a trade

// Tapping a trade in History (or a holding's / account's activity) opens it. Saving works the
// holding out again from that trade on — average cost, later sales' profit — and moves the cash
// again; Delete reverses it. Both can be undone straight after.
function openTradeEdit(id) {
  const e = (state.trades || []).find((t) => t.id === id);
  if (!e) return toast('That trade is no longer here.');
  const kind = e.section === 'crypto' ? 'coin' : 'share';
  const sideName = { buy: 'Buy', sell: 'Sale', dividend: 'Dividend', split: 'Split' }[e.side] || 'Trade';
  const otherCash = e.accountId && e.cashCurrency && e.cashCurrency !== e.currency;
  const acct = e.accountId && state.accounts.find((a) => a.id === e.accountId);
  const trade = e.side === 'buy' || e.side === 'sell';
  const fields = [
    ...(trade ? [
      { key: 'quantity', label: kind === 'coin' ? 'Quantity' : 'Shares', type: 'number', required: true },
      { key: 'price', label: `Price per ${kind} (${e.currency})`, type: 'number', required: true },
      { key: 'fee', label: `Fee (${e.currency})`, type: 'number' },
    ] : []),
    ...(e.side === 'dividend' ? [{ key: 'amount', label: `Dividend received (${e.currency})`, type: 'number', required: true }] : []),
    ...(e.side === 'dividend' && e.reinvestQty ? [{ key: 'reinvestQty', label: 'Shares bought with it', type: 'number', required: true }] : []),
    ...(e.side === 'split' ? [{ key: 'ratio', label: `New ${kind}s for each old one`, type: 'number', required: true }] : []),
    { key: 'date', label: 'Date', type: 'date', required: true },
    ...(otherCash && acct ? [{ key: 'cashAmount', label: `${e.side === 'buy' ? 'Taken from' : 'Paid into'} ${acct.name} (${e.cashCurrency})`, type: 'number', help: 'What the broker actually charged or paid. Leave as it is to scale it with the new total.' }] : []),
  ];
  const values = { quantity: e.quantity, price: e.price, fee: e.fee || 0, amount: e.amount, reinvestQty: e.reinvestQty, ratio: e.ratio, date: e.date, cashAmount: e.cashAmount };
  const patchOf = (v) => {
    const p = { date: v.date };
    for (const f of fields) if (f.key !== 'date' && f.key !== 'cashAmount') p[f.key] = v[f.key] == null || v[f.key] === '' ? (f.key === 'fee' ? 0 : v[f.key]) : +v[f.key];
    if (otherCash && v.cashAmount != null && +v.cashAmount !== +e.cashAmount) p.cashAmount = +v.cashAmount;
    return p;
  };
  // What it changes, worked out on a copy.
  const tryOn = (patch) => {
    const copy = JSON.parse(JSON.stringify({ trades: state.trades, [e.section]: state[e.section], accounts: state.accounts, deleted: {} }));
    Calc.editTrade(copy, id, patch, Date.now());
    return copy;
  };
  const effect = (copy) => {
    const h0 = state[e.section].find((h) => h.id === e.holdingId), h1 = copy[e.section].find((h) => h.id === e.holdingId);
    const out = [];
    const cur = e.currency;
    if (h1 && (!h0 || Math.abs(h0.quantity - h1.quantity) > 1e-9)) out.push(`${kind === 'coin' ? 'Quantity' : 'Shares'} ${num(h0 ? h0.quantity : 0, 8)} → <strong>${num(h1.quantity, 8)}</strong>`);
    if (h1 && h0 && Math.abs((h0.avgCost || 0) - (h1.avgCost || 0)) > 1e-9) out.push(`Average cost ${money(h0.avgCost, cur)} → <strong>${money(h1.avgCost, cur)}</strong>`);
    const sells = copy.trades.filter((t) => t.holdingId === e.holdingId && t.side === 'sell' && t.id !== id);
    for (const t of sells) {
      const was = state.trades.find((x) => x.id === t.id);
      if (was && Math.abs((was.realised || 0) - (t.realised || 0)) > 0.004) out.push(`Profit on the ${fmtDate(t.date)} sale ${signed(was.realised, cur)} → <strong>${signed(t.realised, cur)}</strong>`);
    }
    if (acct) {
      const a1 = copy.accounts.find((a) => a.id === acct.id);
      const line = (a) => (Calc.accountBalances(a).find((b) => b.currency === e.cashCurrency) || { amount: 0 }).amount;
      const m = (x) => (x < 0 ? `<span class="neg">${money(x, e.cashCurrency)}</span>` : money(x, e.cashCurrency));
      if (a1 && Math.abs(line(acct) - line(a1)) > 0.004) out.push(`${esc(acct.name)} ${m(line(acct))} → <strong>${m(line(a1))}</strong>`);
    }
    return out;
  };
  openForm({
    title: `${sideName} ${e.symbol} · ${fmtDate(e.date)}`,
    intro: `Change what you recorded. MoneyMonkey works the ${kind === 'coin' ? 'coin' : 'holding'} out again from this ${sideName.toLowerCase()} on — average cost and the profit on later sales${e.accountId ? ', and the cash it moved' : ''}.`,
    fields,
    values,
    submitLabel: 'Save changes',
    preview: (v) => {
      try {
        const out = effect(tryOn(patchOf(v)));
        return out.length ? out.join('<br>') : 'No change to the holding or cash.';
      } catch (err) { return `<span class="warn-text">${esc(err.message)}</span>`; }
    },
    onSave: (v) => {
      const snap = JSON.stringify(state);
      try { Calc.editTrade(state, id, patchOf(v), Date.now()); } catch (err) { return err.message; }
      commit();
      setTimeout(() => undoToast(`${sideName} of ${e.symbol} changed`, () => { restoreSnapshot(snap); toast('Change undone'); }));
      return null;
    },
    onDelete: () => {
      let out;
      try { out = effect(tryOn(null)); } catch (err) { toast(err.message); return false; }
      if (!confirm(`Delete this ${sideName.toLowerCase()} of ${e.symbol}?${out.length ? `\n\n${out.map((x) => x.replace(/<[^>]+>/g, '')).join('\n')}` : ''}`)) return false;
      const snap = JSON.stringify(state);
      Calc.editTrade(state, id, null, Date.now());
      commit();
      setTimeout(() => undoToast(`${sideName} of ${e.symbol} deleted`, () => { restoreSnapshot(snap); toast('Delete undone'); }));
      return true;
    },
  });
}
