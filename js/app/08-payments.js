/* MoneyMonkey app — Payment confirmations, monthly check-in and transfers.
 * The js/app/*.js files are loaded in order as plain scripts and share one scope (see index.html). */
'use strict';

// ---------------------------------------------------------------- confirm payments

// Linked bills, income and card bills whose date has arrived. Nothing changes a balance
// until the user taps; "Already included" just marks it as handled.
function reviewPayments(opts = {}) {
  paymentSheet(() => Calc.pendingPayments(state, todayISO()), () => {
    if (opts.thenCheckin && Calc.checkinDue(state, todayISO())) openCheckin();
  });
}

// Converted amount for a payment taken from another currency, at today's rate.
const convertedPay = (amount, from, to) => {
  const v = Calc.convert(+amount || 0, from, to, state.fx);
  return isFinite(v) ? round2(v) : '';
};

// Card bills are named "<card> bill (YYYY-MM)": show the month as words.
const payName = (p) => esc(p.name).replace(/\((\d{4}-\d{2})\)/, (_, m) => `(${fmtMonth(m)})`);

// One box per payment; `getList` is re-read after each tap (another device may have handled one).
// `ui` keeps what the person changed in the box between redraws: another account for a payment
// (`acct`), whether to always use it (`always`), the typed amount (`amt`), open account pickers.
function paymentSheet(getList, onEmpty, ui = { acct: new Map(), always: new Map(), amt: new Map(), open: new Set() }) {
  const withUi = (p) => (ui.acct.has(p.key) ? { ...p, accountId: ui.acct.get(p.key) || null } : p);
  const current = () => getList().map(withUi);
  const redraw = () => paymentSheet(getList, onEmpty, ui);
  const list = current();
  if (!list.length) {
    if (dialog().open) dialog().close();
    if (onEmpty) onEmpty();
    return;
  }
  const items = list.map((p) => {
    const acct = state.accounts.find((a) => a.id === p.accountId);
    const confirmedAfter = acct && acct.updatedAt && acct.updatedAt.slice(0, 10) >= p.date;
    // The account doesn't hold the payment's currency: take it from one it does hold.
    const lines = acct ? Calc.accountBalances(acct) : [];
    const fromCur = acct ? Calc.paymentCurrency(acct, p.currency) : p.currency;
    const cross = fromCur !== p.currency ? `<div class="pay-cross">
        <div class="hint">“${esc(acct.name)}” has no ${esc(p.currency)} balance. Enter what the bank ${p.sign > 0 ? 'added' : 'took'} in the account’s currency (filled in at today’s rate).</div>
        <div class="pay-row">
          <select class="pay-from" aria-label="${p.sign > 0 ? 'Into' : 'From'} balance">${lines.map((l) => `<option value="${esc(l.currency)}" ${l.currency === fromCur ? 'selected' : ''}>${p.sign > 0 ? 'Into' : 'From'} ${esc(l.currency)} balance</option>`).join('')}</select>
          <input class="pay-conv" type="number" step="any" inputmode="decimal" value="${convertedPay(p.amount, p.currency, fromCur)}" aria-label="Amount in the account's currency">
        </div>
      </div>` : '';
    const amtInput = `<input class="pay-amt" type="number" step="any" inputmode="decimal" value="${ui.amt.get(p.key) ?? p.amount}" aria-label="Amount in ${esc(p.currency)}">${cross ? `<span class="cur-tag">${esc(p.currency)}</span>` : ''}`;
    const dir = p.sign > 0 ? 'Into' : 'From';
    // "Change": pick another account for this payment (and optionally from now on).
    const picker = ui.open.has(p.key) ? `<div class="pay-row pay-pick">
        <select class="pay-acct" aria-label="${dir} account"><option value="">No account — just mark it</option>${state.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === p.accountId ? 'selected' : ''}>${dir} ${esc(a.name)}${a.platform ? ` · ${esc(a.platform)}` : ''}</option>`).join('')}</select>
        <label class="check"><input type="checkbox" class="pay-always" ${ui.always.get(p.key) ? 'checked' : ''}> Always ${p.sign > 0 ? 'receive this into' : 'pay this from'} here</label>
      </div>` : '';
    const change = ui.open.has(p.key) ? '' : ` <button type="button" class="linklike" data-pay-change>Change</button>`;
    // A transfer also lands in another account; if that's in another currency, ask what arrived.
    const dest = acct && p.toAccountId ? state.accounts.find((a) => a.id === p.toAccountId) : null;
    const destCur = dest ? Calc.paymentCurrency(dest, p.currency) : null;
    const destLine = dest ? `<div class="sub">→ into <strong>${esc(dest.name)}</strong>${dest.platform ? ` · ${esc(dest.platform)}` : ''}${destCur !== p.currency ? ` · received in ${esc(destCur)}: <input class="pay-recv" data-cur="${esc(destCur)}" type="number" step="any" inputmode="decimal" value="${convertedPay(ui.amt.get(p.key) ?? p.amount, p.currency, destCur)}" aria-label="Amount received in ${esc(destCur)}">` : ''}</div>` : '';
    const buttons = p.type === 'saver'
      ? `${acct ? '<button class="btn primary small" data-pay="apply">Pay in</button>' : ''}<button class="btn small ${acct ? '' : 'primary'}" data-pay="skip">${acct ? 'Already moved' : 'Paid in'}</button><button class="btn small ghost" data-pay="none">Not paid</button>`
      : `${acct ? `<button class="btn primary small" data-pay="apply">${p.sign > 0 ? 'Add' : 'Deduct'}</button>` : ''}<button class="btn small ${acct ? '' : 'primary'}" data-pay="skip">${acct ? 'Already included' : p.type === 'card' ? 'Mark paid' : 'Dismiss'}</button>`;
    return `<div class="pay-item" data-key="${esc(p.key)}" data-cur="${esc(p.currency)}">
      <div class="pay-head"><span class="badge ${p.sign > 0 ? 'kind-income' : 'kind-expense'}">${p.sign > 0 ? 'In' : 'Out'}</span><strong class="grow">${payName(p)}</strong><span class="sub">${fmtDate(p.date)}</span></div>
      <div class="sub">${acct ? `${dir} <strong>${esc(acct.name)}</strong>${acct.platform ? ` · ${esc(acct.platform)}` : ''}${p.type === 'saver' ? ' into the saver' : ''}` : p.accountId ? 'From <span class="warn-text">an account that was deleted</span>' : p.type === 'saver' ? 'No paying account linked — this just records it in the saver' : 'No account linked — this just marks it paid'} · ${esc(p.currency)}${change}</div>
      ${destLine}
      ${picker}
      ${confirmedAfter ? `<div class="hint">You updated this balance on ${fmtDate(acct.updatedAt)}, so it may already include this.</div>` : ''}
      ${cross ? `<div class="pay-row">${amtInput}</div>${cross}<div class="pay-row">${buttons}</div>` : `<div class="pay-row">${amtInput}${buttons}</div>`}
    </div>`;
  }).join('');
  const keepAmounts = () => { for (const box of dialog().querySelectorAll('.pay-item')) ui.amt.set(box.dataset.key, $('.pay-amt', box).value); };
  openSheet(list.length === 1 ? 'Confirm payment' : `Confirm ${plural(list.length, 'payment')}`, `<p class="sub">Nothing changes until you tap. Change the amount or account first if it was different. “Already included” means the balance you entered already reflects it.</p><div class="pay-list">${items}</div>`, (e) => {
    if (e.target.closest('[data-pay-change]')) {
      keepAmounts();
      ui.open.add(e.target.closest('.pay-item').dataset.key);
      return redraw();
    }
    const b = e.target.closest('[data-pay]');
    if (!b) return;
    const box = b.closest('.pay-item');
    const p = current().find((x) => x.key === box.dataset.key);
    if (p) {
      const apply = b.dataset.pay === 'apply';
      const none = b.dataset.pay === 'none';
      const amt = +$('.pay-amt', box).value;
      if (!none && (apply || p.type === 'saver') && !(amt >= 0)) return toast('Enter the amount first.', 'error');
      const fromSel = $('.pay-from', box);
      const from = fromSel ? { currency: fromSel.value, amount: +$('.pay-conv', box).value } : null;
      if (apply && from && !(from.amount >= 0 && $('.pay-conv', box).value !== '')) return toast(`Enter the amount in ${from.currency} first.`, 'error');
      const acct = state.accounts.find((a) => a.id === p.accountId);
      if (apply && acct && p.sign < 0) {
        const cur = from ? from.currency : p.currency;
        const left = Calc.shortfall(acct, cur, from ? from.amount : amt, p.date);
        if (left > 0 && !confirm(`“${acct.name}” only has ${money((from ? from.amount : amt) - left, cur)} in ${cur} in the app — this would leave it at ${money(-left, cur)}. If its real balance is higher, update it first. Deduct anyway?`)) return;
      }
      const snap = JSON.stringify(state);
      const recv = $('.pay-recv', box);
      const pp = recv ? { ...p, toCurrency: recv.dataset.cur, received: +recv.value } : p;
      const res = Calc.resolvePayment(state, none ? { ...pp, paidIn: false } : pp, apply, amt, Date.now(), from);
      if (ui.always.get(p.key) && ui.acct.has(p.key)) setPayingAccount(p, p.accountId || '');
      ui.acct.delete(p.key); ui.amt.delete(p.key); ui.open.delete(p.key); ui.always.delete(p.key);
      commit();
      const used = res && res.paidAmount != null ? ` (${money(res.paidAmount, res.paidCurrency)})` : '';
      const nm = p.name.replace(/\((\d{4}-\d{2})\)/, (_, m) => `(${fmtMonth(m)})`);
      const msg = none ? `${nm}: not paid this month` : apply ? `${nm}: balance updated${used}` : p.type === 'saver' ? `${nm}: ${money(amt, p.currency)} recorded` : `${nm}: marked as already included`;
      redraw();
      undoToast(msg, () => { restoreSnapshot(snap); redraw(); });
      return;
    }
    redraw();
  });
  // Keep the converted amount in step with the amount and the chosen balance.
  const listEl = $('.pay-list', dialog());
  if (listEl) {
    listEl.oninput = listEl.onchange = (e) => {
      const box = e.target.closest('.pay-item');
      if (box && e.type === 'change' && e.target.classList.contains('pay-acct')) {
        keepAmounts();
        ui.acct.set(box.dataset.key, e.target.value);
        return redraw();
      }
      if (box && e.target.classList.contains('pay-always')) { ui.always.set(box.dataset.key, e.target.checked); return; }
      if (box && e.target.classList.contains('pay-amt') && $('.pay-recv', box)) { const r = $('.pay-recv', box); r.value = convertedPay(e.target.value, box.dataset.cur, r.dataset.cur); }
      if (!box || !$('.pay-from', box) || e.target.classList.contains('pay-conv')) return;
      $('.pay-conv', box).value = convertedPay($('.pay-amt', box).value, box.dataset.cur, $('.pay-from', box).value);
    };
  }
}

// "Always pay this from here": make the chosen account the usual one for that bill / card / saver.
function setPayingAccount(p, accountId) {
  const now = Date.now();
  if (p.type === 'cashflow') {
    const cf = state.cashflows.find((c) => c.id === p.id);
    if (cf) { cf.accountId = accountId; cf._mt = now; }
  } else if (p.type === 'saver') {
    const dep = state.deposits.find((d) => d.id === p.id);
    if (dep) { dep.payFromAccountId = accountId || undefined; dep._mt = now; }
  } else if (p.type === 'card') {
    const e = state.spending.find((x) => x.id === p.id);
    const card = e && cardById(e.cardId);
    if (card) { card.payFromAccountId = accountId; card._mt = now; }
    if (e) { delete e.payFromAccountId; e._mt = now; }
  }
}

// ---------------------------------------------------------------- monthly check-in

// `prefill` (after an Undo) puts back what was typed: extra rows added, then every field's value.
function openCheckin(prefill) {
  if (!state.accounts.length) return toast('Add a bank account first.');
  const t = todayISO();
  const lm = lastMonth();
  const spendRow = () => `<div class="ci-spend"><input class="ci-card" placeholder="New card name" aria-label="Card"><input class="ci-amt" type="number" step="any" inputmode="decimal" placeholder="Amount" aria-label="Amount"><input class="ci-cur" list="currency-list" maxlength="3" value="${esc(base())}" aria-label="Currency"></div>`;
  const cardLines = state.cards.map((c) => {
    const done = state.spending.find((e) => e.cardId === c.id && e.month === lm);
    return `<label class="ci-line ci-card-line"><span class="ci-card-name">${esc(c.name)}</span>${done
      ? `<span class="sub">recorded: ${money(done.amount, done.currency)}</span>`
      : `<input type="number" step="any" inputmode="decimal" data-card="${esc(c.id)}" placeholder="${esc(c.currency || base())} statement" aria-label="${esc(c.name)} statement for ${fmtMonth(lm)}">`}</label>`;
  }).join('');
  const blocks = state.accounts.map((a) => {
    const lines = Calc.accountBalances(a);
    return `<div class="ci-acct" data-id="${esc(a.id)}">
      <div class="ci-name"><strong>${esc(a.name)}</strong>${a.platform ? ` <span class="sub">· ${esc(a.platform)}</span>` : ''}</div>
      ${lines.map((b) => {
        const v = round2(Calc.balanceValue(b, t).value);
        return `<label class="ci-line"><span class="cur-tag">${esc(b.currency)}</span>${pmWrap(`<input type="number" step="any" inputmode="decimal" data-cur="${esc(b.currency)}" data-orig="${v}" value="${v}" aria-label="${esc(a.name)} ${esc(b.currency)} balance">`)}${+b.rate ? `<span class="sub">incl. est. interest</span>` : ''}</label>`;
      }).join('') || '<p class="sub">No balances yet — tap the account later to add some.</p>'}
    </div>`;
  }).join('');
  // Payments due since the last check-in: the balances entered here already include them.
  const pending = Calc.pendingPayments(state, t);
  const payLines = pending.map((p) => {
    const acct = state.accounts.find((a) => a.id === p.accountId);
    return `<label class="ci-pay"><input type="checkbox" data-pay-key="${esc(p.key)}" checked><span class="grow"><strong>${payName(p)}</strong><div class="sub">${fmtDate(p.date)} · ${p.sign > 0 ? '+' : '−'}${money(p.amount, p.currency)}${acct ? ` · ${p.sign > 0 ? 'into' : 'from'} ${esc(acct.name)}` : ''}</div></span></label>`;
  }).join('');
  const extraRow = () => `<div class="ci-extra"><select class="ci-x-kind" aria-label="Type"><option value="income">Extra income</option><option value="expense">One-off cost</option></select><input class="ci-x-name" placeholder="e.g. Bonus" aria-label="What"><input class="ci-x-amt" type="number" step="any" inputmode="decimal" placeholder="Amount" aria-label="Amount"><input class="ci-x-cur" list="currency-list" maxlength="3" value="${esc(base())}" aria-label="Currency"></div>`;
  const html = `<p class="sub">Update each balance from your bank apps; leave the ones that haven’t changed.</p>
    ${blocks}
    ${pending.length ? `<h3>${icon('check')} Due since your last check-in</h3>
    <p class="sub">Ticked = already in the balances above: it’s marked as done and nothing is taken off again. Untick anything that hasn’t gone through yet — you’ll be asked about it later.</p>
    <div class="ci-pays">${payLines}</div>` : ''}
    <h3>${icon('card')} Card spending for ${fmtMonth(lm)}</h3>
    <p class="sub">Optional — each card’s statement total. Leave blank to skip a card.</p>
    ${cardLines}
    <div class="ci-spend-rows">${state.cards.length ? '' : spendRow()}</div>
    <button type="button" class="btn small" data-ci="add-card">+ ${state.cards.length ? 'A card not listed' : 'Another card'}</button>
    <h3>${icon('sparkle')} Extra income or one-off costs in ${fmtMonth(lm)}</h3>
    <p class="sub">Optional — e.g. a bonus or a big one-off purchase. Only used in Cash Flow’s month by month; it doesn’t change any balance (the balances above already include it).</p>
    <div class="ci-extras">${extraRow()}</div>
    <button type="button" class="btn small" data-ci="add-extra">+ Another</button>
    <div class="row-actions ci-actions"><button class="btn primary" data-ci="save">Save check-in</button><button class="btn" data-ci="later">Remind me tomorrow</button><button class="btn ghost" data-ci="skip">Skip this month</button></div>
    <p class="form-error" role="alert"></p>`;
  const fill = () => {
    if (!prefill) return;
    const box = dialog();
    for (let i = 0; i < prefill.cards; i++) $('.ci-spend-rows', box).insertAdjacentHTML('beforeend', spendRow());
    for (let i = 0; i < prefill.extras; i++) $('.ci-extras', box).insertAdjacentHTML('beforeend', extraRow());
    [...box.querySelectorAll('.modal-body input, .modal-body select')].forEach((el, i) => {
      if (i >= prefill.values.length) return;
      if (el.type === 'checkbox') el.checked = prefill.values[i];
      else el.value = prefill.values[i];
    });
  };
  openSheet(`Monthly check-in — ${fmtDate(Calc.checkinDate(state, t))}`, html, (e) => {
    const b = e.target.closest('[data-ci]');
    if (!b) return;
    const box = dialog();
    const action = b.dataset.ci;
    if (action === 'add-card') { $('.ci-spend-rows', box).insertAdjacentHTML('beforeend', spendRow()); return; }
    if (action === 'add-extra') { $('.ci-extras', box).insertAdjacentHTML('beforeend', extraRow()); return; }
    if (action === 'later') { dialog().close(); return; }
    if (action === 'skip') {
      const snap = JSON.stringify(state);
      Calc.recordCheckin(state, t, true, Date.now());
      dialog().close();
      commit();
      undoToast('Check-in skipped this month', () => { restoreSnapshot(snap); openCheckin(); });
      return;
    }
    // save: validate card rows first
    const cards = [...box.querySelectorAll('.ci-spend')].map((r) => ({ platform: $('.ci-card', r).value.trim(), amount: $('.ci-amt', r).value, currency: $('.ci-cur', r).value.trim().toUpperCase() })).filter((c) => c.amount !== '');
    const known = [...box.querySelectorAll('input[data-card]')].filter((i) => i.value !== '').map((i) => ({ cardId: i.dataset.card, amount: i.value }));
    for (const c of known) if (!isFinite(+c.amount)) return ($('.form-error', box).textContent = 'Card amounts must be numbers.');
    const extras = [...box.querySelectorAll('.ci-extra')].map((r) => ({ kind: $('.ci-x-kind', r).value, name: $('.ci-x-name', r).value.trim(), amount: $('.ci-x-amt', r).value, currency: $('.ci-x-cur', r).value.trim().toUpperCase() })).filter((x) => x.amount !== '');
    for (const x of extras) {
      if (!(+x.amount > 0)) return ($('.form-error', box).textContent = 'Extra amounts must be numbers above 0.');
      if (!/^[A-Z]{3}$/.test(x.currency)) return ($('.form-error', box).textContent = 'Currency must be a 3-letter code like HKD or GBP.');
    }
    for (const c of cards) {
      if (!c.platform) return ($('.form-error', box).textContent = 'Give the new card a name.');
      if (!isFinite(+c.amount)) return ($('.form-error', box).textContent = 'Card amounts must be numbers.');
      if (!/^[A-Z]{3}$/.test(c.currency)) return ($('.form-error', box).textContent = 'Card currency must be a 3-letter code like HKD or GBP.');
    }
    const now = Date.now();
    const snap = JSON.stringify(state);
    const typed = {
      cards: box.querySelectorAll('.ci-spend').length - (state.cards.length ? 0 : 1),
      extras: box.querySelectorAll('.ci-extra').length - 1,
      values: [...box.querySelectorAll('.modal-body input, .modal-body select')].map((el) => (el.type === 'checkbox' ? el.checked : el.value)),
    };
    let changed = 0;
    for (const el of box.querySelectorAll('.ci-acct')) {
      const acct = state.accounts.find((a) => a.id === el.dataset.id);
      if (!acct) continue;
      let touched = false;
      for (const input of el.querySelectorAll('input[data-cur]')) {
        if (input.value === '' || Math.abs(+input.value - +input.dataset.orig) < 0.005) continue;
        const line = Calc.accountBalances(acct).find((x) => x.currency === input.dataset.cur);
        line.amount = round2(+input.value);
        delete line.carry;
        if (+line.rate) line.asOf = t;
        touched = true;
        changed++;
      }
      if (touched) {
        acct.balances = Calc.accountBalances(acct);
        acct.updatedAt = new Date().toISOString();
        acct._mt = now;
      }
    }
    for (const k of known) {
      const card = cardById(k.cardId);
      state.spending.push({ id: uid(), cardId: k.cardId, month: lm, platform: card.name, amount: +k.amount, currency: card.currency || base(), dueDate: Calc.cardDueDate(card, lm) || undefined, note: '', _mt: now });
    }
    for (const c of cards) {
      const card = { id: uid(), name: c.platform, platform: '', currency: c.currency, dueDay: null, payFromAccountId: '', _mt: now };
      state.cards.push(card);
      state.spending.push({ id: uid(), cardId: card.id, month: lm, platform: card.name, amount: +c.amount, currency: c.currency, note: '', _mt: now });
    }
    // Ticked payments are already in the balances: mark them done without changing anything.
    let handled = 0;
    for (const cb of box.querySelectorAll('input[data-pay-key]')) {
      if (!cb.checked) continue;
      const p = Calc.pendingPayments(state, t).find((x) => x.key === cb.dataset.payKey);
      if (p) { Calc.resolvePayment(state, p, false, p.amount, now); handled++; }
    }
    // Extras are one-off Cash Flow items dated in that month (no account, so no balance change).
    const lmEnd = Calc.toISO(Calc.addDays(Calc.addMonths(Calc.parseDate(`${lm}-01`), 1), -1));
    for (const x of extras) {
      state.cashflows.push({ id: uid(), name: x.name || (x.kind === 'income' ? 'Extra income' : 'One-off cost'), kind: x.kind, category: 'One-off', amount: +x.amount, currency: x.currency, frequency: 'once', nextDate: lmEnd, active: true, _mt: now });
    }
    Calc.recordCheckin(state, t, false, now);
    dialog().close();
    commit();
    const parts = [`${plural(changed, 'balance')} updated`, known.length + cards.length ? `${plural(known.length + cards.length, 'card statement')} recorded` : '', handled ? `${plural(handled, 'payment')} marked done` : '', extras.length ? `${plural(extras.length, 'extra')} added` : ''].filter(Boolean);
    undoToast(`Check-in saved — ${parts.join(', ')}`, () => { restoreSnapshot(snap); openCheckin(typed); });
  });
  fill();
}

// Pops up the confirm box / check-in at most once a day on this device.
function maybePrompt() {
  if (dialog().open || document.hidden) return;
  const t = todayISO();
  let last = null;
  try { last = localStorage.getItem(PROMPT_KEY); } catch (e) { /* storage unavailable */ }
  if (last === t) return;
  const pending = Calc.pendingPayments(state, t).length;
  const due = Calc.checkinDue(state, t);
  if (!pending && !due) return;
  try { localStorage.setItem(PROMPT_KEY, t); } catch (e) { /* storage unavailable */ }
  // The check-in includes the payments due so far, so it comes first when it's due.
  if (due) openCheckin();
  else reviewPayments();
}

// ---------------------------------------------------------------- transfers

function openTransfer(fromId) {
  const accts = state.accounts;
  if (!accts.length) return toast('Add a bank account first.');
  fromId = fromId || accts[0].id;
  const acctOpts = () => accts.map((a) => ({ value: a.id, label: `${a.name}${a.platform ? ` · ${a.platform}` : ''}` }));
  const curOpts = (id) => {
    const a = accts.find((x) => x.id === id);
    const cs = a ? Calc.accountBalances(a).map((b) => b.currency) : [];
    return (cs.length ? cs : [base()]).map((c) => ({ value: c, label: c }));
  };
  const received = (v) => (v.toCurrency === v.fromCurrency ? v.amount : v.received ?? round2(Calc.convert(v.amount, v.fromCurrency, v.toCurrency, state.fx)));
  openForm({
    title: 'Transfer or exchange',
    intro: 'Moves money between your own accounts, or exchanges currency within one account (e.g. HKD → GBP at your broker): pick the same account and a different currency, and enter what you actually received. Your net worth stays the same.',
    fields: [
      { key: 'fromId', label: 'From account', type: 'select', options: acctOpts, span: true },
      { key: 'fromCurrency', label: 'From currency', type: 'select', options: (v) => curOpts(v.fromId) },
      { key: 'amount', label: 'Amount sent', type: 'number', required: true },
      { key: 'toId', label: 'To account', type: 'select', options: acctOpts, span: true },
      { key: 'toCurrency', label: 'Received in currency', type: 'currency' },
      { key: 'received', label: 'Amount received', type: 'number', help: 'Leave blank to use today’s exchange rate.', showIf: (v) => v.toCurrency && v.fromCurrency && v.toCurrency !== v.fromCurrency },
      { key: 'date', label: 'Date', type: 'date', required: true, default: todayISO },
      { key: 'note', label: 'Note (optional)', span: true },
    ],
    values: { fromId, toId: (accts.find((a) => a.id !== fromId) || accts[0]).id, toCurrency: curOpts(fromId)[0].value },
    isNew: true,
    submitLabel: 'Transfer',
    preview: (v) => {
      if (!(v.amount > 0) || !/^[A-Z]{3}$/.test(v.toCurrency || '')) return '';
      const r = received(v);
      return isFinite(r) ? `${esc(accountName(v.fromId))} −${money(v.amount, v.fromCurrency)} → ${esc(accountName(v.toId))} +${money(r, v.toCurrency)}` : 'No exchange rate yet — enter the amount received.';
    },
    validate: (v) => {
      if (v.fromId === v.toId && v.fromCurrency === v.toCurrency) return 'Pick a different account or currency to transfer to.';
      if (!(v.amount > 0)) return 'Enter an amount above 0.';
      if (!isFinite(received(v))) return 'No exchange rate yet — enter the amount received.';
      return null;
    },
    onSave: (v) => {
      const from = accts.find((a) => a.id === v.fromId);
      const left = Calc.shortfall(from, v.fromCurrency, v.amount, v.date);
      if (left > 0 && !confirm(`“${from.name}” only has ${money(v.amount - left, v.fromCurrency)} in ${v.fromCurrency} in the app — this would leave it at ${money(-left, v.fromCurrency)}. If its real balance is higher, update it first. Transfer anyway?`)) return 'Not transferred — update the account’s balance first if it has more.';
      Calc.transfer(state, { id: `tr-${uid()}`, fromId: v.fromId, fromCurrency: v.fromCurrency, amount: v.amount, toId: v.toId, toCurrency: v.toCurrency, received: received(v), date: v.date, note: v.note }, Date.now());
      commit();
      toast('Transfer recorded');
    },
  });
}

function commit() {
  Calc.linkDeposits(state);
  Calc.linkCards(state);
  const settled = Calc.settleDeposits(state, todayISO(), Date.now());
  recordSnapshot();
  save();
  fillDatalists();
  render();
  for (const e of settled) toast(e.kind === 'deposit-cash' ? `Fixed deposit at ${e.platform} matured — moved to ${e.accountName}` : `Fixed deposit at ${e.platform} renewed`);
  queueSync();
}
