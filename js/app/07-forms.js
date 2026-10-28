/* MoneyMonkey app — Forms, sheets and the "what's inside this number" breakdowns.
 * The js/app/*.js files are loaded in order as plain scripts and share one scope (see index.html). */
'use strict';

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
        <div class="bal-head" aria-hidden="true"><span>Currency</span><span>Amount</span><span class="bal-rate-h">Interest % p.a.</span><span></span></div>
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
      if (f.signed) input = pmWrap(input);
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
            const rate = r.closest('.with-rate') ? $('.bal-rate', r).value : '';
            return { currency: $('.bal-cur', r).value.trim().toUpperCase(), amount: amt === '' ? null : +amt, rate: rate === '' ? null : +rate };
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
      if (el && f.type === 'balances') el.classList.toggle('with-rate', !!(f.showRate && f.showRate(v)));
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
  if (!d.open) d.showModal();
  if (window.matchMedia('(min-width: 761px)').matches) {
    const firstInput = form.querySelector('input:not([type=checkbox]), select');
    if (firstInput) firstInput.focus();
  }
  return form;
}

function balanceRow(b) {
  return `<div class="bal-row">
    <input class="bal-cur" list="currency-list" maxlength="3" autocapitalize="characters" aria-label="Currency" placeholder="HKD" value="${esc(b.currency || '')}">
    ${pmWrap(`<input class="bal-amt" type="number" step="any" inputmode="decimal" aria-label="Amount" placeholder="0.00" value="${esc(b.amount ?? '')}">`)}
    <input class="bal-rate" type="number" step="any" inputmode="decimal" aria-label="Interest rate, % per year" placeholder="% p.a." value="${esc(b.rate ?? '')}">
    <button type="button" class="icon-btn" data-remove-balance aria-label="Remove this currency">✕</button>
  </div>`;
}

function balancesError(list, required) {
  if (required && !list.length) return 'Add at least one currency balance.';
  const seen = new Set();
  for (const b of list) {
    if (!/^[A-Z]{3}$/.test(b.currency)) return `“${b.currency || '?'}” isn’t a currency code — use 3 letters like HKD, GBP or USD.`;
    if (b.amount == null || !isFinite(b.amount)) return `Enter an amount for ${b.currency} (0 is fine).`;
    if (b.rate != null && !(b.rate >= 0 && b.rate < 100)) return `The interest rate for ${b.currency} should be a percentage, e.g. 4.5.`;
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
  if (!d.open) d.showModal();
}

function editItem(sec, id, preset = {}) {
  const def = SECTIONS[sec];
  const prev = id ? state[sec].find((x) => x.id === id) : null;
  if (id && !prev) return;
  preset = { ...(filters[sec] ? { platform: filters[sec] } : {}), ...preset };
  if (sec === 'spending' && !prev) {
    const c = cardById(preset.cardId) || state.cards[0];
    if (c && !preset.cardId) preset.cardId = c.id;
    if (c && c.currency) preset.currency = c.currency;
    if (!state.cards.length) preset.cardId = '__new';
    delete preset.platform;
  }
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
    title: `${prev ? 'Edit' : 'Add'} ${sec === 'deposits' && (prev || preset).kind === 'regular' ? 'regular saver' : def.singular}`,
    fields: def.fields,
    values: prev ? (def.editValues ? def.editValues(prev) : { ...prev }) : preset,
    isNew: !prev,
    // A deposit's preview also needs what the form doesn't show (a regular saver's confirmed payments).
    preview: def.preview && sec === 'deposits' && prev ? (v) => def.preview({ ...prev, ...v }) : def.preview,
    validate: def.validate,
    onDelete: prev ? () => {
      const deps = sec === 'accounts' ? accountDeposits(prev) : [];
      const stmts = sec === 'cards' ? state.spending.filter((e) => e.cardId === prev.id) : [];
      const extra = deps.length ? ` and its ${plural(deps.length, 'fixed deposit')}` : stmts.length ? ` and its ${plural(stmts.length, 'statement')}` : '';
      if (!confirm(`Delete “${prev.name || prev.symbol || prev.coinId || prev.platform || (sec === 'spending' ? `${fmtMonth(prev.month)} statement` : '')}”${extra}?`)) return false;
      for (const d of deps) {
        state.deposits = state.deposits.filter((x) => x.id !== d.id);
        state.deleted[d.id] = Date.now();
      }
      for (const e of stmts) {
        state.spending = state.spending.filter((x) => x.id !== e.id);
        state.deleted[e.id] = Date.now();
      }
      if (sec === 'cards' && currentView === 'card') location.hash = '#cashflows';
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
  const items = [['accounts', 'wallet', 'Bank / cash account'], ['stocks', 'trending', 'Stock or ETF'], ['crypto', 'coins', 'Crypto'], ['deposits', 'percent', 'Fixed deposit'], ['properties', 'building', 'Property'], ['others', 'gem', 'Other asset'], ['liabilities', 'landmark', 'Loan or debt'], ['cashflows', 'flow', 'Income, bill or subscription'], ['once', 'sparkle', 'Extra income / one-off cost'], ['spending', 'receipt', 'Card statement'], ['cards', 'card', 'Credit card'], ['transfer', 'transfer', 'Transfer between my accounts'], ['goals', 'target', 'Goal']];
  openSheet('Add…', `<div class="choice-grid">${items.map(([k, ic, label]) => `<button class="choice" data-sheet-add="${k}"><span class="icon">${icon(ic)}</span>${label}</button>`).join('')}</div>`, (e) => {
    const b = e.target.closest('[data-sheet-add]');
    if (!b) return;
    const sec = b.dataset.sheetAdd;
    dialog().close();
    if (sec === 'transfer') return openTransfer();
    if (sec === 'once') {
      if (currentView !== 'cashflows') { history.replaceState(null, '', '#cashflows'); currentView = 'cashflows'; render(); }
      return editItem('cashflows', null, { frequency: 'once', category: 'One-off', kind: 'income' });
    }
    const view = sec === 'spending' || sec === 'cards' ? 'cashflows' : sec;
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
  openSheet('Menu', `<nav class="menu-list">${VIEWS.filter((v) => !v.hidden).map((v) => `<a href="#${v.id}" class="${v.id === (NAV_PARENT[currentView] || currentView) ? 'active' : ''}"><span class="icon">${icon(v.icon)}</span>${v.label}${navCount(v.id)}</a>`).join('')}</nav>`, (e) => {
    if (e.target.closest('a')) dialog().close();
  });
}

// ---------------------------------------------------------------- "what's inside this number"

function explain(what, param) {
  const s = summary;
  const t = todayISO();
  const row = (href, label, sub, amount) => `<a class="ex-row" href="${href}"><span class="grow"><strong>${label}</strong>${sub ? `<div class="sub">${sub}</div>` : ''}</span><span class="num">${amount}</span><span class="chev" aria-hidden="true">›</span></a>`;
  const total = (label, amount) => `<div class="ex-total"><span class="grow">${label}</span><span class="num">${amount}</span></div>`;
  const group = (title, rows) => (rows.length ? `<h3>${title}</h3><div class="ex-list">${rows.join('')}</div>` : '');
  const acctHref = (id) => `#account/${encodeURIComponent(id)}`;
  const sortDesc = (a, b) => b.v - a.v;
  // Cash-flow lines open that item's edit form.
  const active = state.cashflows.filter((c) => c.active !== false);
  const monthly = (c) => toBase(Calc.monthlyAmount(c), c.currency) || 0;
  const flowSub = (c) => [`${esc(labelOf(FREQ, c.frequency))} ${money(c.amount, c.currency)}`, c.category ? esc(c.category) : '', c.onCard ? 'paid by card' : (c.accountId && accountName(c.accountId) ? `↔ ${esc(accountName(c.accountId))}` : ''), c.frequency !== 'once' || c.nextDate >= t ? `next ${fmtDate(Calc.nextOccurrence(c, t))}` : ''].filter(Boolean).join(' · ');
  const flowRow = (c) => ({ v: monthly(c), html: `<a class="ex-row" href="#" data-action="edit" data-sec="cashflows" data-id="${esc(c.id)}"><span class="grow"><strong>${esc(c.name)}</strong><div class="sub">${flowSub(c)}</div></span><span class="num">${money(monthly(c), base(), 0)}</span><span class="chev" aria-hidden="true">›</span></a>` });
  const flowRows = (list) => list.map(flowRow).sort(sortDesc).map((r) => r.html);
  const isBill = (c) => c.kind === 'expense' || c.kind === 'subscription';
  const matched = new Set(s.loanMatches.map((m) => m.cashflowId));
  const bills = (pred = () => true) => active.filter((c) => isBill(c) && !matched.has(c.id) && pred(c));
  const loanRows = () => state.liabilities.filter((l) => l.type !== 'credit' && +l.payment > 0 && Calc.loanBalance(l, t).balance > 0).map((l) => {
    const m = s.loanMatches.find((x) => x.loanId === l.id);
    const cf = m && state.cashflows.find((c) => c.id === m.cashflowId);
    return { v: toBase(l.payment, l.currency) || 0, html: `<a class="ex-row" href="#" data-action="edit" data-sec="liabilities" data-id="${esc(l.id)}"><span class="grow"><strong>${esc(l.name)}</strong><div class="sub">${[esc(l.platform || ''), `${money(Calc.loanBalance(l, t).balance, l.currency, 0)} left`, cf ? `same as bill “${esc(cf.name)}”` : ''].filter(Boolean).join(' · ')}</div></span><span class="num">${money(toBase(l.payment, l.currency), base(), 0)}</span><span class="chev" aria-hidden="true">›</span></a>` };
  }).sort(sortDesc).map((r) => r.html);
  // Interest as average monthly income: each fixed deposit and saver line.
  const interestRows = () => {
    const out = [];
    for (const d of state.deposits) {
      const v = Calc.depositValue(d, t);
      if (!(v.monthlyInterest > 0)) continue;
      const m = toBase(v.monthlyInterest, d.currency);
      const how = d.onMaturity === 'renew' ? 'kept in the deposit when it renews' : `paid ${fmtDate(v.maturityDate)}`;
      const what = d.kind === 'regular' ? `Regular saver interest · ${num(d.rate, 2)}% AER · ${money(v.maturityInterest, d.currency, 0)} over the term, averaged` : `Fixed deposit interest · ${num(d.rate, 2)}% · ${how}`;
      out.push({ v: m, html: row(acctHref(d.accountId), `${esc(d.platform || 'Fixed deposit')}${d.name ? ` · ${esc(d.name)}` : ''}`, what, money(m, base(), 0)) });
    }
    for (const a of state.accounts) {
      if (s.interest.skippedAccounts.includes(a.id)) continue;
      for (const b of Calc.accountBalances(a)) {
        const bv = Calc.balanceValue(b, t);
        if (bv.daily > 0) out.push({ v: toBase(bv.daily, b.currency) * 365 / 12, html: row(acctHref(a.id), `${esc(a.name)} · ${esc(b.currency)}`, `Saver interest · ${num(b.rate, 2)}%`, money(toBase(bv.daily, b.currency) * 365 / 12, base(), 0)) });
      }
    }
    return out.sort(sortDesc).map((r) => r.html);
  };
  const rentRows = () => state.properties.filter((p) => +p.monthlyRent > 0).map((p) => {
    const m = s.rentMatches.find((x) => x.propertyId === p.id);
    const cf = m && state.cashflows.find((c) => c.id === m.cashflowId);
    return { v: toBase(p.monthlyRent, p.currency) || 0, html: `<a class="ex-row" href="#" data-action="edit" data-sec="properties" data-id="${esc(p.id)}"><span class="grow"><strong>${esc(p.name)}</strong><div class="sub">Rent · ${money(p.monthlyRent, p.currency)}/mo${cf ? ` · same as income item “${esc(cf.name)}”` : ''}</div></span><span class="num">${money(toBase(p.monthlyRent, p.currency), base(), 0)}</span><span class="chev" aria-hidden="true">›</span></a>` };
  }).sort(sortDesc).map((r) => r.html);
  const dividendRows = (onlyReinvested) => state.stocks.filter((h) => Calc.dividendPerYear(h) > 0 && (!onlyReinvested || h.dividendReinvest)).map((h) => {
    const m = toBase(Calc.dividendPerYear(h) / 12, h.currency) || 0;
    return { v: m, html: `<a class="ex-row" href="#" data-action="edit" data-sec="stocks" data-id="${esc(h.id)}"><span class="grow"><strong>${esc(h.symbol)}</strong><div class="sub">Dividends · ${money(Calc.dividendPerYear(h), h.currency)}/yr${h.dividendReinvest ? ' · reinvested' : ''}</div></span><span class="num">${money(m, base(), 0)}</span><span class="chev" aria-hidden="true">›</span></a>` };
  }).sort(sortDesc).map((r) => r.html);
  const skippedNote = () => (s.interest.skippedAccounts.length ? `<p class="sub">Interest from ${s.interest.skippedAccounts.map((id) => `“${esc(accountName(id))}”`).join(', ')} is already in your income items, so it isn’t added again.</p>` : '');
  const cardMonths = () => s.spendMonths.slice(0, s.spendAvgMonths).map((m) => row('#cashflows', `Card spending · ${fmtMonth(m.month)}`, plural(m.entries, 'card'), money(m.total, base(), 0)));
  let title = '', body = '';

  if (what === 'assets') {
    title = 'Total assets';
    const rows = Object.keys(s.totals).filter((k) => s.totals[k]).map((k) => ({ v: s.totals[k], html: row(`#${CATEGORY_VIEW[k]}`, CATEGORY_LABELS[k], s.assets ? `${((s.totals[k] / s.assets) * 100).toFixed(1)}% of assets` : '', money(s.totals[k], base(), 0)) }));
    body = group('By type', rows.sort(sortDesc).map((r) => r.html)) + total('Total', money(s.assets, base(), 0));
  } else if (what === 'liabilities') {
    title = 'Liabilities';
    const rows = state.liabilities.map((l) => {
      const b = Calc.loanBalance(l, t).balance;
      return { v: toBase(b, l.currency) || 0, html: row('#liabilities', esc(l.name), [esc(l.platform || ''), l.rate ? `${num(l.rate, 2)}%` : '', l.payment ? `${money(l.payment, l.currency)}/mo` : ''].filter(Boolean).join(' · '), `<span class="neg">${money(b, l.currency)}</span>`) };
    });
    const bills = Calc.unpaidCardBills(state).map((e) => ({ v: toBase(e.amount, e.currency) || 0, html: row(`#card/${encodeURIComponent(e.cardId)}`, `${esc(e.platform || 'Card')} · ${fmtMonth(e.month)}`, billStatus(e), `<span class="neg">${money(e.amount, e.currency)}</span>`) }));
    body = (rows.length || bills.length
      ? group('Loans & debts', rows.sort(sortDesc).map((r) => r.html)) + group('Unpaid card bills', bills.sort(sortDesc).map((r) => r.html))
      : '<p class="sub">No loans, debts or unpaid card bills.</p>') + total('Total owed', `<span class="owed">${money(s.liabilities, base(), 0)}</span>`);
  } else if (what === 'pnl') {
    title = param === 'stocks' ? 'Stocks profit / loss' : param === 'crypto' ? 'Crypto profit / loss' : 'Investment profit / loss';
    const holdings = [...state.stocks.map((h) => ['stocks', h, h.symbol]), ...state.crypto.map((h) => ['crypto', h, h.symbol || h.coinId])].filter(([k]) => !param || k === param);
    const rows = holdings.map(([k, h, label]) => {
      const v = hv(h);
      return { v: toBase(v.pnl, h.currency) || 0, html: row(`#" data-action="edit" data-sec="${k}" data-id="${esc(h.id)}`, esc(label), `${esc(h.platform || '')}${h.platform ? ' · ' : ''}${money(v.marketValue, h.currency)} now · ${money(v.cost, h.currency)} cost`, `${signed(v.pnl, h.currency)}<div class="sub">${pct(v.pnlPct)}</div>`) };
    });
    const pnlTotal = param ? rows.reduce((a, r) => a + r.v, 0) : s.investPnl;
    body = (rows.length ? group('Biggest gains first', rows.sort(sortDesc).map((r) => r.html)) : '<p class="sub">No stocks or crypto yet.</p>') + total('Total', signed(pnlTotal, base(), 0));
  } else if (what === 'today') {
    title = param === 'crypto' ? 'Crypto: last 24 hours' : 'Stocks: today';
    const rows = (state[param] || []).map((h) => {
      const v = hv(h);
      const b = toBase(v.dayChange, h.currency) || 0;
      const pctDay = v.marketValue - v.dayChange ? v.dayChange / (v.marketValue - v.dayChange) : 0;
      return { v: Math.abs(b), b, html: row(`#" data-action="edit" data-sec="${param}" data-id="${esc(h.id)}`, esc(h.symbol || h.coinId), `${esc(h.platform || '')}${h.platform ? ' · ' : ''}${h.lastPrice ? `price ${money(h.lastPrice, h.currency)}` : h.source === 'manual' ? 'manual price — no daily change' : 'no live price yet'}`, `${signed(v.dayChange, h.currency)}<div class="sub">${pct(pctDay)}</div>`) };
    });
    const moved = rows.filter((r) => r.b);
    body = (moved.length ? group('Biggest moves first', moved.sort(sortDesc).map((r) => r.html)) : '<p class="sub">No price moves yet. Daily changes come with live prices; holdings with a manual price don’t have one.</p>')
      + (rows.length > moved.length ? `<p class="sub">${plural(rows.length - moved.length, 'holding')} didn’t move or ${rows.length - moved.length === 1 ? 'has' : 'have'} no live price.</p>` : '')
      + total('Total', signed(rows.reduce((a, r) => a + r.b, 0), base(), 0));
  } else if (what === 'realised') {
    const year = t.slice(0, 4);
    title = `Realised profit ${year}`;
    const r = Calc.realisedProfit(state.trades, (v, c) => toBase(v, c) || 0, param, `${year}-01-01`);
    const rows = r.sells.map((e) => row(e.accountId ? acctHref(e.accountId) : `#${param}`, `${fmtDate(e.date)} · sold ${num(e.quantity, 8)} ${esc(e.symbol)}`, `at ${money(e.price, e.currency)} · average cost ${money(e.before.avgCost, e.currency)}${e.fee ? ` · fee ${money(e.fee, e.currency)}` : ''}${e.platform ? ` · ${esc(e.platform)}` : ''}`, signed(e.realised, e.currency)));
    const earlier = Calc.realisedProfit(state.trades, (v, c) => toBase(v, c) || 0, param).total - r.total;
    body = (rows.length ? group('Sales this year', rows) : '<p class="sub">No sales this year yet.</p>')
      + total('Total this year', signed(r.total, base(), 0))
      + (Math.abs(earlier) > 0.5 ? total('Earlier years', signed(earlier, base(), 0)) : '')
      + '<p class="sub">Profit (or loss) you’ve made by selling: sale price minus fees minus the average cost of the shares sold. The Profit / loss box shows what you still hold.</p>';
  } else if (what === 'dividends') {
    title = 'Dividends per year';
    const list = state.stocks.filter((h) => Calc.dividendPerYear(h) > 0).map((h) => {
      const y = Calc.dividendPerYear(h);
      const mv = hv(h).marketValue;
      return { v: toBase(y, h.currency) || 0, re: !!h.dividendReinvest, html: row(`#" data-action="edit" data-sec="stocks" data-id="${esc(h.id)}`, esc(h.symbol), `${h.divMode === 'yield' ? `${num(h.dividendYield, 2)}% yield` : `${money(h.dividendPerShare, h.currency)} per share × ${num(h.quantity, 4)}`}${mv && h.divMode !== 'yield' ? ` · ${((y / mv) * 100).toFixed(2)}% of value` : ''}`, `${money(y, h.currency)}<div class="sub">${money(toBase(y, h.currency) / 12, base(), 0)}/mo</div>`) };
    });
    const yearly = list.reduce((a, r) => a + r.v, 0);
    const year = t.slice(0, 4);
    const got = Calc.dividendsReceived(state.trades, (v, c) => toBase(v, c) || 0, `${year}-01-01`);
    const gotRows = got.list.map((e) => row(e.accountId ? acctHref(e.accountId) : '#stocks', `${fmtDate(e.date)} · ${esc(e.symbol)}`, e.reinvestQty ? `reinvested in ${num(e.reinvestQty, 8)} shares` : e.accountName ? `into ${esc(e.accountName)}` : 'recorded', money(e.amount, e.currency)));
    body = group(`Received in ${year}`, gotRows) + (gotRows.length ? total(`Received in ${year}`, money(got.total, base(), 0)) : '<p class="sub">Record a dividend you receive with “Dividend / split” on the holding — it goes into the broker’s cash.</p>')
      + '<h3>Expected per year</h3>'
      + group('Paid out', list.filter((r) => !r.re).sort(sortDesc).map((r) => r.html)) + group('Reinvested', list.filter((r) => r.re).sort(sortDesc).map((r) => r.html))
      + total('Per year', money(yearly, base(), 0)) + total('Per month (average)', money(yearly / 12, base(), 0))
      + '<p class="sub">Counted in Cash Flow income and passive income; reinvested dividends also count as saving.</p>';
  } else if (what === 'brokercash') {
    title = 'Uninvested cash';
    const rows = [];
    for (const a of brokerCashAccounts(param)) for (const b of Calc.accountBalances(a)) {
      const v = Calc.balanceValue(b, t).value;
      rows.push({ v: toBase(v, b.currency) || 0, html: row(acctHref(a.id), `${esc(a.name)} · ${esc(b.currency)}`, esc(a.platform || ''), `${money(v, b.currency)}${b.currency !== base() ? `<div class="sub">≈ ${money(toBase(v, b.currency), base(), 0)}</div>` : ''}`) });
    }
    body = group('By account', rows.sort(sortDesc).map((r) => r.html)) + total('Total', money(rows.reduce((a, r) => a + r.v, 0), base(), 0));
  } else if (what === 'fd-interest') {
    title = 'Interest so far';
    const rows = state.deposits.map((d) => {
      const v = Calc.depositValue(d, t);
      return { v: toBase(v.interest, d.currency) || 0, html: row(acctHref(d.accountId), `${esc(d.platform || 'Fixed deposit')}${d.name ? ` · ${esc(d.name)}` : ''}`, `${d.kind === 'regular' ? 'Regular saver' : 'Fixed deposit'} · ${num(d.rate, 2)}%${d.kind === 'regular' ? ' AER' : ''} · +${money(v.dailyInterest, d.currency)}/day · ${money(v.maturityInterest, d.currency, 0)} by ${fmtDate(v.maturityDate)}`, `<span class="pos">${money(v.interest, d.currency)}</span>`) };
    });
    body = group('Most interest first', rows.sort(sortDesc).map((r) => r.html)) + total('Total', `<span class="pos">${money(rows.reduce((a, r) => a + r.v, 0), base(), 0)}</span>`) + total('Per day now', money(s.depositDaily));
  } else if (what === 'maturities') {
    title = 'Maturity dates';
    const deps = state.deposits.map((d) => ({ d, v: Calc.depositValue(d, t) })).sort((a, b) => (a.v.maturityDate < b.v.maturityDate ? -1 : 1));
    const then = (d) => ({ cash: d.payoutAccountId ? `moves to ${esc(accountName(d.payoutAccountId) || 'cash')}` : 'moves back to the account', renew: 'renews', keep: 'you update it yourself' }[d.onMaturity || 'keep']);
    const rows = deps.map(({ d, v }) => row(acctHref(d.accountId), `${fmtDate(v.maturityDate)} · ${esc(d.platform || 'Fixed deposit')}${d.name ? ` · ${esc(d.name)}` : ''}`, `${v.matured ? 'matured' : `in ${plural(v.daysLeft, 'day')}`} · ${then(d)}`, `${d.kind === 'regular' && !v.matured ? '≈ ' : ''}${money(v.maturityValue, d.currency)}`));
    body = group('Soonest first', rows);
  } else if (what === 'card-owed') {
    const card = cardById(param);
    title = `${card ? card.name : 'Card'}: owed now`;
    const unpaid = state.spending.filter((e) => e.cardId === param && e.dueDate && !e.paidOn).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const items = unpaid.map((e) => `<div class="ex-row"><span class="grow"><strong>${fmtMonth(e.month)} statement</strong><div class="sub">${billStatus(e)}</div></span><span class="num">${money(e.amount, e.currency)}</span><button class="btn small primary" data-action="pay-card" data-id="${esc(e.id)}">Pay</button></div>`);
    body = (items.length ? group('Unpaid bills', items) : '<p class="sub">Nothing owed — all bills are paid.</p>')
      + total('Total', `<span class="owed">${money(unpaid.reduce((a, e) => a + (toBase(e.amount, e.currency) || 0), 0), base(), 0)}</span>`)
      + '<p class="sub">Each bill counts as debt from when it’s recorded until you confirm it’s paid.</p>';
  } else if (what === 'part') {
    const [scope, kind, name] = String(param || '').split('|').map(decodeURIComponent);
    const KINDS = { cash: ['Cash', ['accounts']], deposits: ['Fixed deposits', ['deposits']], invest: ['Investments', ['stocks', 'crypto']], property: ['Property & other', ['properties', 'others']], debt: ['Debts', ['liabilities']] };
    const [label, secs] = KINDS[kind] || KINDS.cash;
    const plats = Calc.platformBreakdown(state, t).platforms.filter((p) => (scope === 'region' ? (p.region || '') === name : p.name === name));
    const names = new Set(plats.map((p) => p.name));
    title = `${scope === 'region' ? name || 'No region' : name || 'No platform'}: ${label.toLowerCase()}`;
    const rows = [];
    for (const k of secs) {
      for (const item of state[k].filter((x) => names.has(String(x.platform || '').trim()))) {
        const v = Calc.itemParts(k, item, t).reduce((a, part) => a + (toBase(part.value, part.currency) || 0), 0);
        const href = k === 'accounts' ? acctHref(item.id) : `#" data-action="edit" data-sec="${k}" data-id="${esc(item.id)}`;
        const itemName = item.name || item.symbol || item.coinId || item.platform || '';
        const sub = [scope === 'region' ? esc(item.platform || '') : '', k === 'deposits' ? `matures ${fmtDate(Calc.depositValue(item, t).maturityDate)}` : '', k === 'accounts' ? esc(Calc.accountBalances(item).map((b) => b.currency).join(', ')) : '', k === 'stocks' || k === 'crypto' ? `${num(item.quantity, 6)} units` : ''].filter(Boolean).join(' · ');
        rows.push({ v, html: row(href, esc(itemName), sub, money(v, base(), 0)) });
      }
    }
    if (kind === 'debt') {
      for (const e of Calc.unpaidCardBills(state)) {
        const card = cardById(e.cardId);
        if (!card || !names.has(String(card.platform || '').trim())) continue;
        const v = toBase(e.amount, e.currency) || 0;
        rows.push({ v, html: row(`#card/${encodeURIComponent(card.id)}`, `${esc(card.name)} · ${fmtMonth(e.month)} bill`, billStatus(e), money(v, base(), 0)) });
      }
    }
    const sum = plats.reduce((a, p) => a + (kind === 'property' ? p.property + p.other : p[kind] || 0), 0);
    body = group('Biggest first', rows.sort(sortDesc).map((r) => r.html)) + total('Total', kind === 'debt' ? `<span class="owed">${money(sum, base(), 0)}</span>` : money(sum, base(), 0));
  } else if (what === 'income') {
    title = 'Income per month';
    const rentItems = new Set(s.rentMatches.map((m) => m.cashflowId));
    const rows = flowRows(active.filter((c) => c.kind === 'income' && !rentItems.has(c.id)));
    const irows = interestRows();
    body = (rows.length ? group(`Regular income · ${money(s.flow.income, base(), 0)}`, rows) : '<p class="sub">No regular income yet. Add your salary and other income with “+ Add”.</p>')
      + group(`Rent · ${money(s.rentMonthly, base(), 0)}`, rentRows())
      + group(`Dividends · ${money(s.dividends.total, base(), 0)}`, dividendRows(false))
      + group(`Interest · ${money(s.interest.total, base(), 0)}`, irows)
      + (irows.length ? '<p class="sub">Interest is averaged per month, the same way yearly bills are. Fixed deposit interest arrives at maturity; a renewing deposit keeps it, so that part also counts as saving.</p>' : '')
      + skippedNote()
      + total('Per month', money(s.incomeTotal, base(), 0)) + total('Per year', money(s.incomeTotal * 12, base(), 0));
  } else if (what === 'spending') {
    title = 'Spending per month';
    if (s.spendingSource === 'actual') {
      body = `<p class="sub">Uses what you actually spent: the average of your last ${plural(s.spendAvgMonths, 'recorded month')} of card spending, plus bills not paid by card and loan repayments.</p>`
        + group(`Card spending · average ${money(s.cardSpendAvg, base(), 0)}`, cardMonths())
        + group(`Bills not paid by card · ${money(s.notOnCard, base(), 0)}`, flowRows(bills((c) => !c.onCard)));
    } else {
      body = '<p class="sub">Estimated from your bills and subscriptions. Record your monthly card statements to use real numbers instead.</p>'
        + group('Bills & subscriptions', flowRows(bills()));
    }
    body += group(`Loan repayments · ${money(s.loanRepayments, base(), 0)}`, loanRows()) + total('Per month', money(s.spending, base(), 0));
  } else if (what === 'bills') {
    title = 'Bills from your bank accounts';
    body = group('Paid by transfer or direct debit', flowRows(bills((c) => !c.onCard)));
    if (!body) body = '<p class="sub">No bills paid from your bank yet. Add rent, utilities, insurance… with “+ Add”.</p>';
    body += total('Per month', money(s.notOnCard, base(), 0)) + '<p class="sub">Bills paid by credit card are inside your card spending; loan repayments are shown separately.</p>';
  } else if (what === 'card') {
    title = 'Card spending per month';
    if (s.spendingSource === 'actual') {
      body = `<p class="sub">The average of your last ${plural(s.spendAvgMonths, 'recorded month')}. It already includes subscriptions and bills charged to your cards.</p>` + group('Recorded months', cardMonths());
    } else {
      body = '<p class="sub">You haven’t recorded card statements yet, so this is just the bills marked “Paid by credit card”. Record each month’s statement to see what you really spend.</p>' + group('Bills paid by card', flowRows(bills((c) => c.onCard)));
    }
    body += total('Per month', money(s.split.card, base(), 0));
  } else if (what === 'loans') {
    title = 'Loan repayments per month';
    const rows = loanRows();
    body = (rows.length ? group('From Loans & Debts', rows) : '<p class="sub">No loans with a monthly repayment. Add them in Loans &amp; Debts.</p>')
      + total('Per month', money(s.loanRepayments, base(), 0))
      + '<p class="sub">Credit card balances aren’t included here: card statements already count as spending.</p>';
  } else if (what === 'fixed') {
    title = 'Fixed vs flexible costs';
    body = `<p class="sub">Fixed costs are regular commitments that are hard to cut quickly — however you pay them. Flexible spending is the rest of your card spending.</p>`
      + group(`Fixed · ${money(s.fixedCosts, base(), 0)}${s.fixedPct != null ? ` · ${pct(s.fixedPct, false)} of income` : ''}`, [...flowRows(bills()), ...loanRows()])
      + (s.flexibleCosts != null
        ? total('Flexible card spending', money(s.flexibleCosts, base(), 0)) + `<p class="sub">Your average card spending (${money(s.cardSpendAvg, base(), 0)}) minus the bills charged to cards (${money(s.cardPaidBills, base(), 0)}).</p>`
        : '<p class="sub">Record your card statements to see your flexible spending too.</p>')
      + total('Fixed costs', money(s.fixedCosts, base(), 0))
      + (s.fixedPct != null ? `<p class="sub">${s.fixedPct <= 0.5 ? 'Under half your income goes on fixed costs — that leaves good room to adjust.' : s.fixedPct <= 0.7 ? 'Fixed costs take a large share of your income; there’s less room if income drops.' : 'Fixed costs take most of your income — worth reviewing the biggest ones.'}</p>` : '');
  } else if (what === 'saving') {
    title = 'Planned saving per month';
    const saverItems = new Set(s.saverMatches.map((m) => m.cashflowId));
    const rows = flowRows(active.filter((c) => c.kind === 'saving' && !saverItems.has(c.id)));
    const regular = state.deposits.filter((d) => d.kind === 'regular' && !Calc.depositValue(d, t).matured).map((d) => {
      const cf = state.cashflows.find((c) => s.saverMatches.some((m) => m.depositId === d.id && m.cashflowId === c.id));
      return row(acctHref(d.accountId), `${esc(d.platform || 'Regular saver')}${d.name ? ` · ${esc(d.name)}` : ''}`, `Regular saver · ${num(d.rate, 2)}% AER until ${fmtDate(Calc.depositValue(d, t).maturityDate)}${cf ? ` · same as “${esc(cf.name)}”` : ''}`, money(toBase(d.monthlyAmount, d.currency), base(), 0));
    });
    const renew = state.deposits.filter((d) => d.onMaturity === 'renew').map((d) => {
      const v = Calc.depositValue(d, t);
      const m = toBase(v.dailyInterest, d.currency) * 365 / 12;
      return m > 0 ? row(acctHref(d.accountId), `${esc(d.platform || 'Fixed deposit')}${d.name ? ` · ${esc(d.name)}` : ''}`, 'Interest kept when the deposit renews', money(m, base(), 0)) : '';
    }).filter(Boolean);
    const drip = dividendRows(true);
    body = (rows.length || regular.length || renew.length || drip.length ? group('Saving & investing', rows) + group('Regular savers', regular) + group('Interest kept in renewing deposits', renew) + group('Dividends reinvested', drip) : '<p class="sub">Nothing planned yet. Add a regular transfer to savings or investments with the type “Saving / investing”.</p>')
      + total('Per month', money(s.split.saving, base(), 0))
      + (s.netMonthly > 0 && s.split.saving ? `<p class="sub">That’s ${pct(s.split.saving / s.netMonthly, false)} of what’s left over each month.</p>` : '');
  } else if (what === 'category') {
    const cat = param || '';
    title = cat;
    const items = bills((c) => (c.category || (c.kind === 'subscription' ? 'Subscriptions' : 'Uncategorised')) === cat);
    body = group('Bills in this category', flowRows(items)) + total('Per month', money(items.reduce((t2, c) => t2 + monthly(c), 0), base(), 0));
  } else if (what === 'cashflow') {
    title = 'Monthly cash flow';
    const income = active.filter((c) => c.kind === 'income' && !s.rentMatches.some((m) => m.cashflowId === c.id)).map(flowRow).sort(sortDesc).map((r) => r.html);
    let spend;
    if (s.spendingSource === 'actual') {
      spend = [row('#cashflows', 'Card spending', `average of the last ${plural(s.spendAvgMonths, 'month')} you recorded`, money(s.cardSpendAvg, base(), 0)), ...flowRows(bills((c) => !c.onCard))];
    } else spend = flowRows(bills());
    spend = [...spend, ...loanRows()];
    body = group(`Income · ${money(s.incomeTotal, base(), 0)}`, [...income, ...rentRows(), ...dividendRows(false), ...interestRows()])
      + group(`Spending · ${money(s.spending, base(), 0)}${s.spendingSource === 'actual' ? ' (actual)' : ' (estimated from bills)'}`, spend)
      + total('Left over each month', signed(s.netMonthly, base(), 0))
      + (s.incomeTotal ? total('Savings rate', pct(s.savingsRate, false)) : '')
      + (s.split.saving ? total('Planned saving', money(s.split.saving, base(), 0)) + total(s.split.unallocated < 0 ? 'Over budget' : 'Free to spend or save', `<span class="${s.split.unallocated < 0 ? 'neg' : 'pos'}">${money(Math.abs(s.split.unallocated), base(), 0)}</span>`) : '');
  } else if (what === 'passive' || what === 'interest') {
    const daily = what === 'interest';
    title = daily ? 'Interest earned per day' : 'Passive income per month';
    const k = daily ? 1 : 365 / 12;
    const unit = daily ? '/day' : '/mo';
    const fds = state.deposits.map((d) => {
      const v = Calc.depositValue(d, t);
      const amt = daily ? v.dailyInterest : v.monthlyInterest;
      const what = d.kind === 'regular' ? `Regular saver · ${num(d.rate, 2)}% AER · ${money(v.paidIn, d.currency, 0)} paid in so far${daily ? '' : ', averaged over the term'}` : `Fixed deposit · ${num(d.rate, 2)}% · ${money(d.principal, d.currency, 0)} until ${fmtDate(v.maturityDate)}`;
      return { v: toBase(amt, d.currency) || 0, html: row(acctHref(d.accountId), `${esc(d.platform || 'Fixed deposit')}${d.name ? ` · ${esc(d.name)}` : ''}`, what, `${money(amt, d.currency)}${unit}`) };
    }).filter((r) => r.v > 0);
    const savers = [];
    for (const a of state.accounts) for (const b of Calc.accountBalances(a)) {
      const bv = Calc.balanceValue(b, t);
      if (bv.daily > 0) savers.push({ v: toBase(bv.daily, b.currency) || 0, html: row(acctHref(a.id), `${esc(a.name)} · ${esc(b.currency)}`, `Saver · ${num(b.rate, 2)}% on ${money(bv.amount, b.currency, 0)}`, `${money(bv.daily * k, b.currency)}${unit}`) });
    }
    const rents = daily ? [] : state.properties.filter((p) => +p.monthlyRent).map((p) => ({ v: toBase(p.monthlyRent, p.currency) || 0, html: row('#properties', esc(p.name), 'Rent', `${money(p.monthlyRent, p.currency)}/mo`) }));
    const divs = daily ? [] : dividendRows(false);
    body = group('Fixed deposits & regular savers', fds.sort(sortDesc).map((r) => r.html)) + group('Savers', savers.sort(sortDesc).map((r) => r.html)) + group('Dividends', divs) + group('Rent', rents.sort(sortDesc).map((r) => r.html));
    if (!body) body = '<p class="sub">No interest, dividends or rent yet. Add a fixed deposit, set a rate on a saver account, add dividends to a stock, or add rent to a property.</p>';
    else if (!daily) body = '<p class="sub">How fast your money earns, not cash in hand: fixed deposit interest is paid at maturity, saver interest when the bank credits it, dividends when the company pays. In Cash Flow it counts as average monthly income, the same way yearly bills are averaged.</p>' + body;
    body += total('Total', daily ? `${money(s.interestDaily)}/day` : `${money(s.passiveMonthly, base(), 0)}/mo`);
  } else if (what === 'runway') {
    title = 'Emergency runway';
    const rows = state.accounts.map((a) => ({ v: accountTotal(a) || 0, html: row(acctHref(a.id), esc(a.name), esc(a.platform || ''), money(accountTotal(a), base(), 0)) })).filter((r) => r.v);
    body = `<p class="sub">How many months your cash would cover your spending if your income stopped. Fixed deposits and investments aren’t counted.</p>`
      + group(`Cash · ${money(s.totals.cash, base(), 0)}`, rows.sort(sortDesc).map((r) => r.html))
      + total('Monthly spending', money(s.spending, base(), 0))
      + total('Runway', isFinite(s.runwayMonths) ? `${s.runwayMonths.toFixed(1)} months` : '—')
      + (isFinite(s.runwayMonths) ? `<p class="sub">A common target is 3–6 months.</p>` : '<p class="sub">Add your spending in Cash flow to see this.</p>');
  } else if (what === 'subscriptions') {
    title = 'Subscriptions';
    const subs = state.cashflows.filter((c) => c.kind === 'subscription');
    const rows = subs.map((c) => ({ v: c.active === false ? -1 : toBase(Calc.monthlyAmount(c), c.currency) || 0, html: row(`#" data-action="edit" data-sec="cashflows" data-id="${esc(c.id)}`, `${esc(c.name)}${c.active === false ? ' <span class="badge">Paused</span>' : ''}`, [`${esc(labelOf(FREQ, c.frequency))} ${money(c.amount, c.currency)}`, c.onCard ? 'paid by card' : (c.accountId ? `↔ ${esc(accountName(c.accountId))}` : ''), c.active === false ? '' : `next ${fmtDate(Calc.nextOccurrence(c, t))}`].filter(Boolean).join(' · '), `${money(toBase(Calc.monthlyAmount(c), c.currency), base(), 0)}/mo`) }));
    body = (rows.length ? group('Most expensive first', rows.sort(sortDesc).map((r) => r.html)) : '<p class="sub">No subscriptions yet. Add them in Cash flow with the type “Subscription”.</p>')
      + total('Per month', money(s.flow.subscription, base(), 0)) + total('Per year', money(s.flow.subscription * 12, base(), 0));
  } else return;

  openSheet(title, body, (e) => { if (e.target.closest('a')) dialog().close(); });
}
