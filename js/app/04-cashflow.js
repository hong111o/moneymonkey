/* MoneyMonkey app — Cash Flow page and credit cards.
 * The js/app/*.js files are loaded in order as plain scripts and share one scope (see index.html). */
'use strict';

// ---------------------------------------------------------------- cash flow

// Cash Flow's summary boxes (also used to show boxes pinned to Home).
function cashflowTiles() {
  const s = summary;
  return `<section class="tiles">
      ${tile('Income / mo', `<span class="pos">${money(s.incomeTotal)}</span>`, s.incomeTotal - s.flow.income > 0.5 ? `incl. ${money(s.incomeTotal - s.flow.income, base(), 0)} interest, rent & dividends` : '', '', explainAttr('income'))}
      ${tile('Spending / mo', money(s.spending), `${s.spendingSource === 'actual' ? `actual · avg of last ${plural(s.spendAvgMonths, 'month')}` : 'estimated from your bills'}${s.loanRepayments ? ' · incl. loans' : ''}`, '', explainAttr('spending'))}
      ${tile('Left over / mo', signed(s.netMonthly), s.incomeTotal ? `Savings rate ${pct(s.savingsRate, false)}` : '', '', explainAttr('cashflow'))}
      ${tile('Fixed costs / mo', money(s.fixedCosts), s.fixedPct != null ? `${pct(s.fixedPct, false)} of income` : 'bills, subscriptions & loans', '', explainAttr('fixed'))}
      ${tile('Subscriptions / mo', money(s.flow.subscription), `${money(s.flow.subscription * 12, base(), 0)} per year`, '', explainAttr('subscriptions'))}
      ${tile('Planned saving / mo', money(s.split.saving), '', '', explainAttr('saving'))}
    </section>`;
}

function renderCashflows() {
  const s = summary;
  const byCat = {};
  const matchedLoanBills = new Set(s.loanMatches.map((m) => m.cashflowId));
  for (const c of state.cashflows) {
    if (c.active === false || c.kind === 'income' || c.kind === 'saving' || matchedLoanBills.has(c.id)) continue;
    const k = c.category || (c.kind === 'subscription' ? 'Subscriptions' : 'Uncategorised');
    byCat[k] = (byCat[k] || 0) + (toBase(Calc.monthlyAmount(c, thisMonth()), c.currency) || 0);
  }
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? cats[0][1] : 0;
  const catBars = cats.map(([k, v]) => `<div class="hbar link clickable" data-action="explain" data-what="category" data-cat="${esc(k)}" tabindex="0" role="button"><span class="hbar-label">${esc(k)}</span><span class="hbar-track"><span style="width:${max ? (v / max) * 100 : 0}%"></span></span><span class="num">${money(v, base(), 0)}</span></div>`).join('');
  const tiles = cashflowTiles();
  // Three tabs keep the page short: the plan and history, cards & statements, and the item list.
  const tabs = [['overview', 'Overview'], ['months', 'Months'], ['cards', 'Cards & spending'], ['items', `Items (${state.cashflows.length})`]];
  const tabBar = `<div class="seg tabs" role="tablist" aria-label="Cash flow">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${cfTab === k}" data-action="cf-tab" data-tab="${k}" class="${cfTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (cfTab === 'months') return renderSection('cashflows', { tiles: tabBar, before: renderMonthsTab(), list: '' });
  if (cfTab === 'cards') return renderSection('cashflows', { tiles: tabBar, before: renderCardsCard(), list: '' });
  if (cfTab === 'items') return renderSection('cashflows', { tiles: tabBar, before: '', list: renderFlowGroups() });
  // Each part is a box you can move or hide (Edit layout).
  const part = (id, name, html) => (html ? `<div data-box="${id}" data-name="${name}">${html}</div>` : '');
  const before = `<div class="boxes" data-layout="sections">${part('coming', 'Coming up', renderComingUp())}${part('subs', 'Subscriptions', renderSubsCard())}${part('split', 'Where your income goes', renderIncomeSplit())}${part('history', 'Month by month', renderHistory())}${part('categories', 'Fixed bills by category', cats.length ? `<div class="card"><h2>Fixed bills by category</h2><div class="hbars" style="${barValueWidth(cats.map(([, v]) => money(v, base(), 0)))}">${catBars}</div></div>` : '')}</div>`;
  return renderSection('cashflows', { tiles: tabBar + tiles, before, list: '' });
}

// Cash-flow items in collapsible groups by type; one-offs and paused items start folded.
function renderFlowGroups() {
  if (!state.cashflows.length) return `<div class="card empty">No income, bills or subscriptions yet. <button class="btn primary" data-action="add" data-sec="cashflows">+ Add item</button></div>`;
  const groups = [
    ['Income', (c) => c.kind === 'income'], ['Bills', (c) => c.kind === 'expense'], ['Subscriptions', (c) => c.kind === 'subscription'],
    ['Saving & investing', (c) => c.kind === 'saving'], ['Transfers between my accounts', (c) => c.kind === 'transfer'],
  ];
  const t = todayISO();
  // Ended items are kept in their own folded group, ready to restart.
  const ended = state.cashflows.filter((c) => c.frequency !== 'once' && Calc.hasEnded(c, t));
  const active = state.cashflows.filter((c) => c.active !== false && c.frequency !== 'once' && !Calc.hasEnded(c, t));
  const perMonth = (list) => list.reduce((sum, c) => sum + (toBase(Calc.monthlyAmount(c, thisMonth()), c.currency) || 0), 0);
  // One line per item: name and details on the left, amount and how often on the right.
  const line = (c) => {
    const isEnded = ended.includes(c);
    const tags = [c.onCard ? `${icon('card')} card` : '', c.accountId && accountName(c.accountId) ? `↔ ${esc(accountName(c.accountId))}${c.toAccountId && accountName(c.toAccountId) ? ` → ${esc(accountName(c.toAccountId))}` : ''}` : '', esc(c.category || ''),
      c.frequency === 'once' ? fmtDate(c.nextDate) : isEnded ? `ended ${fmtDate(c.endDate)}` : c.active !== false ? `next ${fmtDate(Calc.nextOccurrence(c, t))}` : ''].filter(Boolean).join(' · ');
    const conv = c.currency !== base() && c.frequency !== 'once' && !isEnded ? `<div class="sub">≈ ${money(toBase(Calc.monthlyAmount(c, cfStatus(c) === 'later' ? c.startDate.slice(0, 7) : thisMonth()), c.currency), base(), 0)}/mo</div>` : '';
    return `<li class="clickable" data-action="edit" data-sec="cashflows" data-id="${esc(c.id)}" tabindex="0"><span class="grow"><strong>${esc(c.name)}</strong>${cfBadges(c)}<div class="sub">${tags}</div></span>${isEnded ? `<button class="btn small" data-action="restart-cf" data-id="${esc(c.id)}">Restart</button>` : ''}<span class="num">${money(Calc.amountOn(c, isEnded ? c.endDate : t), c.currency)}<div class="sub">${esc(labelOf(FREQ, c.frequency))}</div>${conv}</span><span class="chev" aria-hidden="true">›</span></li>`;
  };
  const block = (title, list, open, showTotal = true) => (list.length ? `<details class="flow-group card"${open ? ' open' : ''}><summary><strong>${title}</strong><span class="sub"> · ${list.length}${showTotal ? ` · ${money(perMonth(list), base(), 0)}/mo` : ''}</span></summary><ul class="flow-lines">${list.map(line).join('')}</ul></details>` : '');
  return groups.map(([title, pred]) => block(title, active.filter(pred), true)).join('')
    + block('One-off', state.cashflows.filter((c) => c.active !== false && c.frequency === 'once').sort((a, b) => (a.nextDate < b.nextDate ? 1 : -1)), false, false)
    + block('Paused', state.cashflows.filter((c) => c.active === false && !ended.includes(c)), false, false)
    + block('Ended', ended.sort((a, b) => (a.endDate < b.endDate ? 1 : -1)), false, false);
}

const SPLIT_PARTS = [
  ['bills', 'Bank bills', 'var(--series-1)', 'bills'],
  ['card', 'Card spending', 'var(--series-2)', 'card'],
  ['loans', 'Loans', 'var(--neg)', 'loans'],
  ['saving', 'Planned saving', 'var(--series-3)', 'saving'],
];

// One bar showing where a typical month's income goes, ending with what's genuinely free.
function renderIncomeSplit() {
  const s = summary;
  if (!s.incomeTotal && !s.spending) return '';
  const sp = s.split;
  const over = sp.unallocated < 0;
  const scale = Math.max(s.incomeTotal, s.incomeTotal - sp.unallocated);
  const parts = SPLIT_PARTS.filter(([k]) => sp[k] > 0.5);
  const bar = parts.map(([k, label, color]) => `<span style="flex-grow:${sp[k]};background:${color}" data-tip="${esc(label)}: ${esc(money(sp[k], base(), 0))}"></span>`).join('')
    + (!over && sp.unallocated > 0.5 ? `<span class="free" style="flex-grow:${sp.unallocated}" data-tip="Free: ${esc(money(sp.unallocated, base(), 0))}"></span>` : '');
  const pctOf = (v) => (s.incomeTotal ? `${((v / s.incomeTotal) * 100).toFixed(1)}%` : '');
  const rows = parts.map(([k, label, color, what]) => `<div class="split-row clickable" data-action="explain" data-what="${what}" tabindex="0" role="button">
      <span class="swatch" style="background:${color}"></span><span class="grow">${label}</span><span class="sub">${pctOf(sp[k])}</span><span class="num">${money(sp[k], base(), 0)}</span><span class="chev" aria-hidden="true">›</span></div>`).join('');
  const freeRow = `<div class="split-row free-row clickable" data-action="explain" data-what="cashflow" tabindex="0" role="button">
      <span class="swatch free"></span><span class="grow"><strong>${over ? 'Over budget' : 'Free'}</strong> <span class="sub">${over ? '' : 'to spend or save'}</span></span><span class="sub">${over ? '' : pctOf(sp.unallocated)}</span><span class="num"><strong class="${over ? 'neg' : 'pos'}">${money(Math.abs(sp.unallocated), base(), 0)}</strong></span><span class="chev" aria-hidden="true">›</span></div>`;
  // Matches the app guessed (same amount & currency). Once answered they're no longer shown;
  // the link can still be changed in the item's form.
  const matchNote = (text, kind, cfId, targetId) => `<li><span class="grow">${text}</span><span class="note-actions"><button class="btn small primary" data-action="match-confirm" data-kind="${kind}" data-id="${esc(cfId)}" data-target="${esc(targetId)}">Yes, same</button><button class="btn small ghost" data-action="${kind}-unmatch" data-id="${esc(cfId)}">Not the same</button></span></li>`;
  const rentNotes = s.rentMatches.map((m) => {
    const cf = state.cashflows.find((c) => c.id === m.cashflowId);
    const prop = state.properties.find((p) => p.id === m.propertyId);
    if (!cf || !prop) return '';
    return m.linked ? '' : matchNote(`“${esc(cf.name)}” looks like the rent from “${esc(prop.name)}” — counted once, from the property.`, 'rent', cf.id, prop.id);
  }).join('');
  const saverNotes = s.saverMatches.map((m) => {
    const cf = state.cashflows.find((c) => c.id === m.cashflowId);
    const dep = state.deposits.find((d) => d.id === m.depositId);
    if (!cf || !dep) return '';
    return m.linked ? '' : matchNote(`“${esc(cf.name)}” looks like the payment into the regular saver at ${esc(dep.platform || 'your bank')} — counted once, and confirmed from the saver.`, 'saver', cf.id, dep.id);
  }).join('');
  const matches = rentNotes + saverNotes + s.loanMatches.map((m) => {
    const cf = state.cashflows.find((c) => c.id === m.cashflowId);
    const loan = state.liabilities.find((l) => l.id === m.loanId);
    if (!cf || !loan) return '';
    return m.linked ? '' : matchNote(`“${esc(cf.name)}” looks like the repayment for loan “${esc(loan.name)}” — counted once, under loan repayments.`, 'loan', cf.id, loan.id);
  }).join('');
  return `<div class="card">
    <div class="card-head"><h2>Where your income goes</h2><span class="sub">a typical month</span></div>
    <div class="stack split-bar" aria-hidden="true" style="width:${scale ? (Math.max(s.incomeTotal, 0) / scale) * 100 : 100}%">${bar}</div>
    ${over ? `<p class="sub neg">Your regular spending is ${money(-sp.unallocated, base(), 0)} more than your income each month.</p>` : ''}
    <div class="split-rows">${rows}${freeRow}</div>
    ${!over && s.interest.fdCash > 0.5 ? `<p class="sub">Income includes ${money(s.interest.total, base(), 0)}/mo of interest. ${money(s.interest.fdCash, base(), 0)} of it is fixed deposit interest you receive at maturity, not every month.</p>` : ''}
    ${matches ? `<ul class="loan-notes">${matches}</ul>` : ''}
  </div>`;
}

// Month by month: recorded card spending + regular bills and loans, against regular income.
// Shows the last month, quarter or 6 months, or one row per year (all recorded months).
// Every month with a card statement or a one-off (extra income / one-off cost), newest first,
// with that month's regular income and fixed costs as saved then (the last day recorded; months
// from before these were saved use today's — `todayPlan`). One-offs count in their own month only.
function monthFigures({ withCurrent = false } = {}) {
  const s = summary;
  const thisMonth = todayISO().slice(0, 7);
  const extras = new Map();
  for (const c of state.cashflows) {
    if (c.frequency !== 'once' || c.active === false || !c.nextDate || c.nextDate.slice(0, 7) > thisMonth) continue;
    const v = toBase(c.amount, c.currency) || 0;
    const e = extras.get(c.nextDate.slice(0, 7)) || { in: 0, out: 0, names: [] };
    if (c.kind === 'income') e.in += v;
    else if (c.kind === 'expense' || c.kind === 'subscription') e.out += v;
    else continue;
    e.names.push(c.name);
    extras.set(c.nextDate.slice(0, 7), e);
  }
  const today = { income: s.incomeTotal, fixed: s.split.bills + s.loanRepayments, cardFixed: s.cardPaidBills };
  const saved = new Map();
  for (const h of state.history) if (h.income != null && (h.currency || base()) === base()) saved.set(h.date.slice(0, 7), h);
  const cardByMonth = new Map(s.spendMonths.map((m) => [m.month, m.total]));
  // Months with a card statement or a one-off, and every earlier month the app saved figures for.
  const savedMonths = [...saved.keys()].filter((m) => m < thisMonth || (withCurrent && m === thisMonth));
  if (withCurrent) savedMonths.push(thisMonth);
  return [...new Set([...cardByMonth.keys(), ...extras.keys(), ...savedMonths])].sort().reverse().map((month) => {
    const pl = saved.get(month) || (month === thisMonth ? today : null);
    const plan = pl || today;
    const x = extras.get(month) || { in: 0, out: 0, names: [] };
    // A month with only a one-off and no statement: assume just the fixed bills charged to cards.
    const total = cardByMonth.get(month);
    const card = total ?? plan.cardFixed;
    const income = plan.income + x.in;
    const spending = card + plan.fixed + x.out;
    return { month, label: fmtMonth(month), noStatement: total == null, todayPlan: !pl, regular: plan.income, fixed: plan.fixed, card, xin: x.in, xout: x.out, names: x.names, income, spending, net: income - spending };
  });
}

function renderHistory() {
  const months = monthFigures();
  if (!months.length) {
    return `<div class="card"><h2>Month by month</h2><p class="sub">Record your monthly card statements (Credit cards &amp; monthly spending, below) to see how each month compares with your income.</p></div>`;
  }
  const byYear = monthRange === 'year';
  const used = byYear ? months : months.slice(0, +monthRange);
  const usedToday = used.filter((m) => m.todayPlan).length;
  let h;
  if (byYear) {
    const years = new Map();
    for (const m of months) {
      const y = m.month.slice(0, 4);
      const r = years.get(y) || { label: y, n: 0, card: 0, xin: 0, xout: 0, regular: 0, fixed: 0 };
      r.n += 1; r.card += m.card; r.xin += m.xin; r.xout += m.xout; r.regular += m.regular; r.fixed += m.fixed;
      years.set(y, r);
    }
    h = [...years.values()].sort((x, y) => (x.label < y.label ? -1 : 1)).map((r) => {
      const spending = r.card + r.fixed + r.xout;
      const income = r.regular + r.xin;
      return { label: `${r.label}`, sub: plural(r.n, 'month'), regular: r.regular, xin: r.xin, xout: r.xout, income, card: r.card, spending, net: income - spending };
    });
  } else h = used.slice().reverse();
  const extraSub = (m) => [m.xin ? `<span class="pos">+${money(m.xin, base(), 0)} extra</span>` : '', m.xout ? `−${money(m.xout, base(), 0)} one-off` : '', m.noStatement ? 'no card statement' : ''].filter(Boolean).join(' · ');
  const max = Math.max(1, ...h.map((m) => Math.max(m.income, m.spending)));
  const rows = h.map((m) => `<div class="hist-row${byYear ? '' : ' clickable'}" ${byYear ? '' : `data-action="month-detail" data-month="${m.month}" tabindex="0" role="button"`}>
      <span class="hist-month">${m.label}${m.sub || extraSub(m) ? `<div class="sub">${[m.sub, extraSub(m)].filter(Boolean).join(' · ')}</div>` : ''}</span>
      <span class="hist-bars">
        <span class="hist-bar in" style="width:${(m.income / max) * 100}%" data-tip="Income: ${esc(money(m.income, base(), 0))}${m.xin ? ` (regular ${esc(money(m.regular, base(), 0))} + extra ${esc(money(m.xin, base(), 0))}${m.names ? ` — ${esc(m.names.join(', '))}` : ''})` : ''}"></span>
        <span class="hist-bar out" style="width:${(m.spending / max) * 100}%" data-tip="Spent: ${esc(money(m.spending, base(), 0))} (cards ${esc(money(m.card, base(), 0))}${m.xout ? `, one-off ${esc(money(m.xout, base(), 0))}` : ''})"></span>
      </span>
      <span class="num ${m.net >= 0 ? 'pos' : 'neg'}">${m.net >= 0 ? '+' : '−'}${money(Math.abs(m.net), base(), 0)}</span>
    </div>`).join('');
  const ranges = [['1', 'Last month'], ['3', 'Quarter'], ['6', '6M'], ['year', 'By year']];
  const seg = `<div class="seg" role="group" aria-label="Months shown">${ranges.map(([r, l]) => `<button data-action="month-range" data-range="${r}" class="${monthRange === r ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const nMonths = byYear ? months.length : h.length;
  const avgNet = byYear ? h.reduce((t, m) => t + m.net, 0) / nMonths : h.reduce((t, m) => t + m.net, 0) / h.length;
  const best = !byYear && h.length > 1 ? h.reduce((a, b) => (b.net > a.net ? b : a)) : null;
  const worst = !byYear && h.length > 1 ? h.reduce((a, b) => (b.net < a.net ? b : a)) : null;
  const more = !byYear && months.length > h.length ? ` ${plural(months.length - h.length, 'earlier month')} — see “By year”.` : '';
  return `<div class="card" style="${barValueWidth(h.map((m) => `+${money(Math.abs(m.net), base(), 0)}`))}">
    <div class="card-head"><h2>Month by month</h2>${seg}</div>
    <p class="sub legend-inline"><span class="swatch" style="background:var(--series-1)"></span>Income <span class="swatch" style="background:var(--series-2)"></span>Spent</p>
    ${rows}
    <p class="sub">Left over ${money(avgNet, base(), 0)} a month on average${byYear ? ` across ${plural(nMonths, 'recorded month')}` : ''} (before planned saving)${best ? ` · best ${best.label}, highest spending ${worst.label}` : ''}.${more} Card spending is what you recorded; income is the regular monthly income (income items, interest, rent and dividends) and the bills and loan repayments as they were that month, plus any extras. Add extras in the monthly check-in or as a one-off item.${usedToday ? ` ${plural(usedToday, 'month')} here ${usedToday === 1 ? 'is' : 'are'} from before the app saved your regular amounts, so ${usedToday === 1 ? 'it uses' : 'they use'} today’s.` : ''}</p>
  </div>`;
}

// Credit cards and the monthly spending recorded from their statements, in one place.
function renderCardsCard() {
  const s = summary;
  const months = s.spendMonths.slice(0, spendAll ? 24 : 3);
  const max = Math.max(1, ...months.map((m) => m.total));
  const moreMonths = Math.min(24, s.spendMonths.length) - months.length;
  const cardRows = state.cards.map((c) => {
    const entries = state.spending.filter((e) => e.cardId === c.id).sort((a, b) => (a.month < b.month ? 1 : -1));
    const last = entries[0];
    const owed = entries.filter((e) => e.dueDate && !e.paidOn).reduce((t, e) => t + (toBase(e.amount, e.currency) || 0), 0);
    const meta = [esc(c.platform || ''), c.dueDay ? `due day ${c.dueDay}` : 'no due day set', c.payFromAccountId ? `paid from ${esc(accountName(c.payFromAccountId))}` : ''].filter(Boolean).join(' · ');
    return `<li class="clickable" data-action="open-card" data-id="${esc(c.id)}" tabindex="0">
      <span class="grow"><strong>${esc(c.name)}</strong><div class="sub">${meta}</div>
        ${last ? `<div class="sub">${fmtMonth(last.month)}: ${money(last.amount, last.currency)}${billStatus(last) ? ` · ${billStatus(last)}` : ''}</div>` : '<div class="sub">No statements yet</div>'}</span>
      <span class="num">${owed ? `<span class="owed">${money(owed, base(), 0)}</span><div class="sub">owed</div>` : ''}</span><span class="chev" aria-hidden="true">›</span></li>`;
  }).join('');
  const rows = months.map((m) => {
    const entries = state.spending.filter((e) => e.month === m.month);
    return `<div class="spend-month">
      <div class="hbar"><span class="hbar-label"><strong>${fmtMonth(m.month)}</strong></span><span class="hbar-track"><span style="width:${(m.total / max) * 100}%"></span></span><span class="num"><strong>${money(m.total, base(), 0)}</strong></span></div>
      <ul class="spend-entries">${entries.map((e) => `<li class="clickable" data-action="edit" data-sec="spending" data-id="${esc(e.id)}" tabindex="0"><span>${esc(e.platform || 'Card')}${e.note ? ` <span class="sub">· ${esc(e.note)}</span>` : ''}${billStatus(e) ? ` <span class="sub">· ${billStatus(e)}</span>` : ''}</span><span class="num">${money(e.amount, e.currency)}</span></li>`).join('')}</ul>
    </div>`;
  }).join('');
  const avgNote = s.spendingSource === 'actual'
    ? `Average of the last ${plural(s.spendAvgMonths, 'month')}: <strong>${money(s.cardSpendAvg, base(), 0)}</strong>. Your cash flow uses this plus ${money(s.notOnCard, base(), 0)}/mo of bills not paid by card.`
    : '';
  return `<div class="card" id="spending" style="${barValueWidth(months.map((m) => money(m.total, base(), 0)))}">
    <div class="card-head"><h2>Credit cards &amp; monthly spending</h2><div class="row-actions"><button class="btn small" data-action="add" data-sec="cards">+ Add card</button><button class="btn small primary" data-action="add" data-sec="spending">+ Add statement</button></div></div>
    ${state.cards.length ? `<ul class="card-list">${cardRows}</ul>` : '<p class="sub">Add your credit cards once (name, due day, which account pays them), then record each month’s statement. Bills show up in “Next 30 days”, count as debt until paid, and you’re asked to confirm the payment on the due date. Your cash flow then uses what you really spent.</p>'}
    ${months.length ? `<h3>Spent per month</h3>${avgNote ? `<p class="sub">${avgNote}</p>` : ''}${rows}${moreMonths > 0 || spendAll ? `<button class="btn small" data-action="spend-all">${spendAll ? 'Show latest 3 months' : `Show all (${moreMonths} more)`}</button>` : ''}` : ''}
  </div>`;
}

// ---------------------------------------------------------------- one credit card

function renderCard(id) {
  const c = cardById(id);
  const back = '<a class="back" href="#cashflows">‹ Cash flow</a>';
  if (!c) return `${back}<div class="card empty">This card no longer exists.</div>`;
  const entries = state.spending.filter((e) => e.cardId === c.id).sort((a, b) => (a.month < b.month ? 1 : -1));
  const unpaid = entries.filter((e) => e.dueDate && !e.paidOn);
  const owed = unpaid.reduce((t, e) => t + (toBase(e.amount, e.currency) || 0), 0);
  const recent = entries.slice(0, 3);
  const avg = recent.length ? recent.reduce((t, e) => t + (toBase(e.amount, e.currency) || 0), 0) / recent.length : 0;
  const next = unpaid.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
  const meta = [c.platform ? `<a href="#platform/${encodeURIComponent(c.platform)}">${esc(c.platform)}</a>` : '', c.dueDay ? `due on day ${c.dueDay} each month` : 'no due day set', c.payFromAccountId ? `paid from <a href="#account/${encodeURIComponent(c.payFromAccountId)}">${esc(accountName(c.payFromAccountId))}</a>` : 'not linked to an account', esc(c.note || '')].filter(Boolean).join(' · ');
  const list = entries.map((e) => `<li class="clickable" data-action="edit" data-sec="spending" data-id="${esc(e.id)}" tabindex="0">
      <span class="grow"><strong>${fmtMonth(e.month)}</strong><div class="sub">${billStatus(e) || 'no due date'}${e.note ? ` · ${esc(e.note)}` : ''}</div></span>
      <span class="num">${money(e.amount, e.currency)}</span>
      ${e.dueDate && !e.paidOn ? `<button class="btn small" data-action="pay-card" data-id="${esc(e.id)}">Pay</button>` : ''}</li>`).join('');
  return `${back}
    <div class="page-head">
      <div><h1 class="keep-case">${esc(c.name)}</h1><p class="sub">${meta}</p></div>
      <div class="row-actions"><button class="btn" data-action="edit" data-sec="cards" data-id="${esc(c.id)}">Edit card</button><button class="btn primary" data-action="add" data-sec="spending" data-card="${esc(c.id)}">+ Add statement</button></div>
    </div>
    <section class="tiles">
      ${tile('Owed now', owed ? `<span class="owed">${money(owed)}</span>` : money(0), unpaid.length ? plural(unpaid.length, 'unpaid bill') : 'all paid', '', unpaid.length ? `${explainAttr('card-owed')} data-cat="${esc(c.id)}"` : '')}
      ${tile('Next due', next ? fmtDate(next.dueDate) : '—', next ? money(next.amount, next.currency) : '')}
      ${tile('Average / month', money(avg), recent.length ? `last ${plural(recent.length, 'statement')}` : '')}
    </section>
    <div class="section-head"><h2>Statements</h2></div>
    <div class="card">${entries.length ? `<ul class="acct-bals stmt-list">${list}</ul>` : '<p class="sub">No statements yet. Tap “+ Statement” after each monthly statement arrives, or record them in the monthly check-in.</p>'}</div>`;
}

// ---------------------------------------------------------------- start / end dates and amount changes

const thisMonth = () => todayISO().slice(0, 7);
// 'later' (starts after this month), 'ended' (ended before this month) or '' (counts now).
function cfStatus(c) {
  if (c.frequency === 'once' || c.active === false) return '';
  if (c.startDate && c.startDate.slice(0, 7) > thisMonth()) return 'later';
  if (c.endDate && c.endDate.slice(0, 7) < thisMonth()) return 'ended';
  return '';
}
// The next amount change still to come, if any.
const nextChange = (c) => (c.changes || []).filter((x) => x.from > todayISO()).sort((a, b) => (a.from < b.from ? -1 : 1))[0] || null;
// Small badges in the Items list: when it starts or ends, and the next price change.
function cfBadges(c) {
  if (c.frequency === 'once') return '';
  const t = todayISO();
  const out = [];
  if (c.startDate && c.startDate > t) out.push(`<span class="badge">Starts ${esc(fmtMonth(c.startDate.slice(0, 7)))}</span>`);
  if (c.endDate && c.endDate >= t) out.push(`<span class="badge">Ends ${esc(fmtMonth(c.endDate.slice(0, 7)))}</span>`);
  const ch = nextChange(c);
  if (ch && !(c.endDate && ch.from > c.endDate)) out.push(`<span class="badge">→ ${money(ch.amount, c.currency)} from ${esc(fmtMonth(ch.from.slice(0, 7)))}</span>`);
  return out.length ? ` ${out.join(' ')}` : '';
}

// End a recurring item today. It stays under "Ended" in Items, ready to restart.
function endCashflow(id) {
  const c = state.cashflows.find((x) => x.id === id);
  if (!c) return false;
  state.cashflows = state.cashflows.map((x) => (x.id === id ? { ...x, endDate: todayISO(), endAsked: todayISO(), _mt: Date.now() } : x));
  commit();
  toast(`“${c.name}” ended — find it under Ended in Items to restart it`);
  return true;
}
// Restart an ended item: its form, filled in, starting today with no end date.
function restartCashflow(id) {
  editItem('cashflows', id, {}, { startDate: todayISO(), endDate: '', nextDate: todayISO() }, 'Restart');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action="restart-cf"]');
  if (!b) return;
  e.stopPropagation();
  restartCashflow(b.dataset.id);
});

// Changes ahead in the next 12 months: items that start later, new amounts, items that end.
function renderComingUp() {
  const t = todayISO();
  const until = Calc.toISO(Calc.addMonths(new Date(), 12));
  const rows = [];
  const sign = (c) => (c.kind === 'income' ? '+' : c.kind === 'transfer' ? '' : '−');
  for (const c of state.cashflows) {
    if (c.frequency === 'once' || c.active === false || Calc.hasEnded(c, t)) continue;
    const per = labelOf(FREQ, c.frequency).toLowerCase();
    if (c.startDate && c.startDate > t && c.startDate <= until) rows.push([c.startDate, c, `starts · ${sign(c)}${money(Calc.amountOn(c, c.startDate), c.currency)} ${per}`]);
    for (const ch of c.changes || []) if (ch.from > t && ch.from <= until && !(c.endDate && ch.from > c.endDate)) rows.push([ch.from, c, `changes to ${money(ch.amount, c.currency)} (from ${money(Calc.amountOn(c, t), c.currency)})`]);
    if (c.endDate && c.endDate >= t && c.endDate <= until) rows.push([c.endDate, c, 'ends']);
  }
  if (!rows.length) return '';
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return `<div class="card"><h2>Coming up</h2><ul class="events">${rows.map(([date, c, what]) => `<li class="clickable has-chev" data-action="edit" data-sec="cashflows" data-id="${esc(c.id)}" tabindex="0"><span class="ev-date">${fmtDate(date)}</span><span class="ev-label"><span class="keep-case">${esc(c.name)}</span> <span class="sub">${what}</span></span><span class="num"></span><span class="chev" aria-hidden="true">›</span></li>`).join('')}</ul></div>`;
}

// Extend an item near its end: a new end date (quick +1 month / +6 months / +1 year), no end,
// and optionally a new amount from when it would have ended. Or let it end (asked once).
function openExtend(id) {
  const c = state.cashflows.find((x) => x.id === id);
  if (!c || !c.endDate) return;
  const after = (n) => Calc.toISO(Calc.addMonths(Calc.parseDate(c.endDate), n));
  const form = openForm({
    title: `Extend ${c.name}`,
    intro: `It ${c.endDate < todayISO() ? 'ended' : 'ends'} on ${fmtDate(c.endDate)}. Pick a new end date, or keep it going with no end. <span class="quick-ext"><button type="button" class="btn small" data-ext="1">+1 month</button><button type="button" class="btn small" data-ext="6">+6 months</button><button type="button" class="btn small" data-ext="12">+1 year</button></span>`,
    fields: [
      { key: 'newEnd', label: 'New end date', type: 'date', showIf: (v) => !v.noEnd },
      { key: 'noEnd', label: 'No end date', type: 'checkbox', span: true },
      { key: 'newAmount', label: `New amount from ${fmtDate(Calc.toISO(Calc.addDays(Calc.parseDate(c.endDate), 1)))} (optional)`, type: 'number', span: true, help: `Leave empty to keep ${money(Calc.amountOn(c, c.endDate), c.currency)}.` },
    ],
    values: { newEnd: after(12), noEnd: false },
    submitLabel: 'Extend',
    validate: (v) => (!v.noEnd && (!v.newEnd || v.newEnd <= c.endDate) ? 'Pick an end date after the current one, or tick “No end date”.' : null),
    buttons: [{ label: 'Let it end', onClick: () => { updateCashflow(id, { endAsked: c.endDate }); toast(`“${c.name}” will end on ${fmtDate(c.endDate)}`); } }],
    onSave: (v) => {
      const patch = { endAsked: undefined, endDate: v.noEnd ? undefined : v.newEnd };
      if (v.newAmount != null && isFinite(v.newAmount)) patch.changes = [...(c.changes || []), { from: Calc.toISO(Calc.addDays(Calc.parseDate(c.endDate), 1)), amount: v.newAmount }];
      updateCashflow(id, patch);
      toast(v.noEnd ? `“${c.name}” keeps going` : `“${c.name}” extended to ${fmtDate(v.newEnd)}`);
    },
  });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ext]');
    if (!b) return;
    form.elements.noEnd.checked = false;
    form.elements.newEnd.value = after(+b.dataset.ext);
    form.dispatchEvent(new Event('change'));
  });
}
// Changes some fields of one cash-flow item (undefined removes a field) and saves.
function updateCashflow(id, patch) {
  state.cashflows = state.cashflows.map((x) => {
    if (x.id !== id) return x;
    const next = { ...x, ...patch, _mt: Date.now() };
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete next[k];
    return next;
  });
  commit();
}

// ---------------------------------------------------------------- rent linked to an income item

// The income item holding a property's rent: linked to it (even if ended or paused), or matched.
function rentItem(p) {
  const own = state.cashflows.find((c) => c.kind === 'income' && c.propertyId === p.id);
  if (own) return own;
  const m = summary && summary.rentMatches.find((x) => x.propertyId === p.id);
  return m ? state.cashflows.find((c) => c.id === m.cashflowId) || null : null;
}
// Income items a property's rent could be: not linked to another property (or the one chosen now).
function rentCandidates(chosenId) {
  return state.cashflows.filter((c) => c.kind === 'income' && c.frequency !== 'once' && (!c.propertyId || c.id === chosenId || !state.properties.some((p) => p.id === c.propertyId)));
}
// Saving a property: its rent is one Cash Flow income item, created or updated here. Clearing
// the rent ends that item (it stays under Ended, ready to restart for the next tenancy).
function saveRentItem(p, prev) {
  const t = todayISO();
  const rent = +p.monthlyRent || 0;
  const old = prev ? rentItem(prev) : null;
  const now = Date.now();
  if (!(rent > 0)) {
    if (old && !Calc.hasEnded(old, t) && !(old.endDate && old.endDate <= t)) state.cashflows = state.cashflows.map((c) => (c.id === old.id ? { ...c, endDate: t, endAsked: t, _mt: now } : c));
    return;
  }
  const cf = p.rentItemId ? state.cashflows.find((c) => c.id === p.rentItemId) : null;
  const changes = (p.rentChanges || []).filter((c) => c.from && isFinite(c.amount)).sort((a, b) => (a.from < b.from ? -1 : 1));
  const wasEnded = cf && Calc.hasEnded(cf, t);
  const next = {
    ...(cf || { id: uid(), name: `Rent: ${p.name}`, category: 'Rent', active: true }),
    kind: 'income', frequency: 'monthly', amount: rent, currency: p.currency, propertyId: p.id,
    accountId: p.rentAccountId || '',
    _mt: now,
  };
  // Dates: a tenancy that had ended starts again today unless a start is given.
  next.startDate = p.rentStart || (wasEnded && !p.rentEnd ? t : '');
  next.endDate = p.rentEnd || '';
  for (const k of ['startDate', 'endDate']) if (!next[k]) delete next[k];
  if (changes.length) next.changes = changes; else delete next.changes;
  if (!cf || (cf.endDate || '') !== (next.endDate || '')) delete next.endAsked;
  delete next.notRent;
  delete next.rentLink;
  if (!next.nextDate || wasEnded) next.nextDate = next.startDate || t;
  if (next.startDate && next.nextDate < next.startDate) next.nextDate = next.startDate;
  if (!next.accountId) { delete next.trackFrom; delete next.lastHandled; } else if (!cf || cf.accountId !== next.accountId) { next.trackFrom = t; delete next.lastHandled; }
  // Another item that used to hold this property's rent is no longer linked to it.
  state.cashflows = state.cashflows.map((c) => (old && c.id === old.id && c.id !== next.id && c.propertyId === p.id ? (({ propertyId, ...rest }) => ({ ...rest, _mt: now }))(c) : c));
  state.cashflows = cf ? state.cashflows.map((c) => (c.id === cf.id ? next : c)) : [...state.cashflows, next];
}
// A property's rent this month, in the base currency: it follows its linked item's dates and amounts.
function rentThisMonth(p) {
  const cf = rentItem(p);
  return (cf ? toBase(Calc.monthlyAmount(cf, thisMonth()), cf.currency) : toBase(p.monthlyRent, p.currency)) || 0;
}
// " · starts Nov 2026" / " · ended Mar 2027" when the linked item's dates keep the rent out of this month.
function rentNote(p) {
  const cf = rentItem(p);
  if (!cf) return '';
  if (cf.startDate && cf.startDate.slice(0, 7) > thisMonth()) return ` · starts ${fmtMonth(cf.startDate.slice(0, 7))}`;
  if (cf.endDate && cf.endDate.slice(0, 7) < thisMonth()) return ` · ended ${fmtMonth(cf.endDate.slice(0, 7))}`;
  return '';
}

// ---------------------------------------------------------------- what a month included

// The items behind a month's regular income and fixed costs, worked out from your items for that
// month (their start / end dates and amount changes). Each line: [id, name, amount in base].
// Interest, dividends and loan repayments use today's figures.
function monthBreakdown(ym) {
  const s = summary;
  const rentIds = new Set(s.rentMatches.map((m) => m.cashflowId));
  const loanIds = new Set(s.loanMatches.map((m) => m.cashflowId));
  const amt = (c) => round2(toBase(Calc.monthlyAmount(c, ym), c.currency) || 0);
  const flows = state.cashflows.filter((c) => c.frequency !== 'once' && c.active !== false);
  const income = flows.filter((c) => c.kind === 'income' && !rentIds.has(c.id)).map((c) => [c.id, c.name, amt(c)]);
  for (const p of state.properties.filter((x) => +x.monthlyRent > 0)) {
    const cf = rentItem(p);
    const v = cf ? amt(cf) : round2(toBase(p.monthlyRent, p.currency) || 0);
    income.push([`p:${p.id}`, `Rent: ${p.name}`, v]);
  }
  if (s.interest.total > 0.5) income.push(['interest', 'Interest (savers & fixed deposits)', round2(s.interest.total)]);
  if (s.dividends.total > 0.5) income.push(['dividends', 'Dividends', round2(s.dividends.total)]);
  const isBill = (c) => c.kind === 'expense' || c.kind === 'subscription';
  const bills = flows.filter((c) => isBill(c) && !c.onCard && !loanIds.has(c.id)).map((c) => [c.id, c.name, amt(c)]);
  const cardBills = flows.filter((c) => isBill(c) && c.onCard).map((c) => [c.id, c.name, amt(c)]);
  const t = todayISO();
  const loans = state.liabilities.filter((l) => l.type !== 'credit' && +l.payment > 0 && Calc.loanBalance(l, t).balance > 0).map((l) => [`l:${l.id}`, l.name, round2(toBase(l.payment, l.currency) || 0)]);
  const keep = (list) => list.filter((x) => Math.abs(x[2]) >= 0.005);
  return { income: keep(income), bills: keep(bills), loans: keep(loans), cardBills: keep(cardBills) };
}

// What a month included: income, card spending, fixed bills, one-offs, left over, payments.
function monthDetailHtml(ym, m) {
  const saved = [...state.history].reverse().find((h) => h.date.slice(0, 7) === ym && (h.currency || base()) === base());
  const recorded = saved && saved.breakdown;
  const b = recorded || monthBreakdown(ym);
  const sum = (list) => list.reduce((t, x) => t + x[2], 0);
  // The month before, to show each line's change (▲▼).
  const prevYm = Calc.toISO(Calc.addMonths(Calc.parseDate(`${ym}-01`), -1)).slice(0, 7);
  const hasPrev = monthFigures({ withCurrent: true }).some((x) => x.month === prevYm);
  const before = hasPrev ? monthLines(prevYm) : new Map();
  const prevStatements = new Map(state.spending.filter((e) => e.month === prevYm).map((e) => [e.cardId, toBase(e.amount, e.currency) || 0]));
  // Each line: name, share of its side (income or spent), change since last month, and what it was if corrected.
  // `goodUp`: whether a rise is good (income) or bad (spending).
  const row = ({ id, name, v, was, sub = '', group = '', tap = '', prev = null }, side, goodUp) => {
    const tapAttr = tap || (id && group ? `data-month-line="${esc(id)}" data-group="${group}" data-ym="${ym}" tabindex="0"` : id && !group ? `data-action="edit" data-sec="cashflows" data-id="${esc(id)}" tabindex="0"` : '');
    const share = side > 0 && v > 0 ? (v / side < 0.0005 ? '<0.1%' : `${((v / side) * 100).toFixed(1)}%`) : '';
    const d = prev == null ? null : v - prev;
    const chg = d != null && Math.abs(d) >= 0.5 ? `<span class="${(d > 0) === goodUp ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${money(Math.abs(d), base(), 0)}</span>` : hasPrev && prev == null && id && !/^(other)$/.test(id) && v >= 0.5 ? '<span class="sub">new</span>' : '';
    const fixed = was != null ? `corrected (was ${money(was, base(), 0)})` : '';
    const notes = [sub, share, fixed].filter(Boolean).join(' · ');
    return `<li class="${tapAttr ? 'clickable' : ''}" ${tapAttr}><span class="grow"><span class="keep-case">${esc(name)}</span>${notes ? `<span class="sub">${notes}</span>` : ''}</span><span class="num">${money(v, base(), 0)}${chg ? `<span class="m-chg">${chg}</span>` : ''}</span></li>`;
  };
  // Biggest first; the "difference from what was saved" line always last.
  const lines = (list, side, goodUp) => list.sort((x, y) => y.v - x.v).map((x) => row(x, side, goodUp)).join('');
  const other = (want, have) => (Math.abs(want - have) >= 1 ? [{ id: '', name: 'Other (difference from what was saved)', v: want - have }] : []);
  const fromBreak = (group, sub = '') => (b[group] || []).map(([id, name, v, was]) => ({ id, name, v, was, sub, group, prev: before.has(id) ? before.get(id).v : null }));
  const statements = state.spending.filter((e) => e.month === ym);
  const oneOffs = state.cashflows.filter((c) => c.frequency === 'once' && c.active !== false && (c.nextDate || '').slice(0, 7) === ym);
  const paid = state.activity.filter((e) => e.kind === 'payment' && (e.date || '').slice(0, 7) === ym && e.outcome !== 'notpaid');
  const oneOff = (c) => ({ id: c.id, name: c.name, v: toBase(c.amount, c.currency) || 0, sub: 'one-off' });
  const income = fromBreak('income');
  const incomeLines = lines(income, m.income, true) + lines(other(m.regular, sum(b.income)), 0, true) + lines(oneOffs.filter((c) => c.kind === 'income').map(oneOff), m.income, true);
  const fixedLines = lines([...fromBreak('bills'), ...fromBreak('loans', 'loan repayment')], m.spending, false) + lines(other(m.fixed, sum(b.bills) + sum(b.loans)), 0, false);
  const noStatement = !statements.length;
  const cardLines = noStatement
    ? lines(fromBreak('cardBills', 'bill paid by card'), m.spending, false)
    : lines(statements.map((e) => { const c = cardById(e.cardId); return { name: c ? c.name : e.platform || 'Card', v: toBase(e.amount, e.currency) || 0, sub: 'statement', tap: `data-action="edit" data-sec="spending" data-id="${esc(e.id)}" tabindex="0"`, prev: hasPrev ? prevStatements.get(e.cardId) ?? null : null, id: `card:${e.cardId}` }; }), m.spending, false);
  const oneOffOut = lines(oneOffs.filter((c) => c.kind === 'expense' || c.kind === 'subscription').map(oneOff), m.spending, false);
  const group = (title, html, total, note = '') => (html ? `<h3>${title} <span class="sub">· ${money(total, base(), 0)}${note ? ` · ${note}` : ''}</span></h3><ul class="month-lines">${html}</ul>` : '');
  const status = recorded && !recorded.rebuilt
    ? '<span class="badge" title="Saved as it was during the month.">Saved</span>'
    : `<span class="badge" title="This month’s item list wasn’t saved, so it’s worked out from your items’ amounts and dates${recorded ? ', with your corrections' : ''}.">Rebuilt from your items${recorded ? ' · corrected' : ''}</span>`;
  return `<p class="sub m-status">${status} Tap a line to correct this month only, or to open it.${hasPrev ? ` ▲▼ vs ${esc(fmtMonth(prevYm))}.` : ''}</p>
    <div class="m-sheet">
      <div class="m-col m-in">
        ${group('Income', incomeLines, m.income)}
        <div class="m-col-total"><span>Total income</span><strong>${money(m.income, base(), 0)}</strong></div>
      </div>
      <div class="m-col m-out">
        ${group('Card spending', cardLines, m.card, noStatement ? '<span class="warn-text">no statement yet</span>' : '')}
        ${group('Fixed bills &amp; loan repayments', fixedLines, m.fixed)}
        ${oneOffOut ? group('One-off costs', oneOffOut, m.xout) : ''}
        <div class="m-col-total"><span>Total spent</span><strong>${money(m.spending, base(), 0)}</strong></div>
      </div>
    </div>
    <div class="month-total"><span>Left over</span><strong class="${m.net >= 0 ? 'pos' : 'neg'}">${m.net >= 0 ? '+' : '−'}${money(Math.abs(m.net), base(), 0)}</strong></div>
    ${paid.length ? `<h3>Payments confirmed</h3><ul class="month-lines">${paid.map((e) => `<li><span class="grow"><span class="sub">${fmtDate(e.date)}</span><span>${activityText(e)}</span></span></li>`).join('')}</ul>` : ''}`;
}

// ---------------------------------------------------------------- correcting past months

// Months before this one that the app has saved figures for (newest first).
function pastMonths() {
  const tm = thisMonth();
  return [...new Set(state.history.filter((h) => h.income != null).map((h) => h.date.slice(0, 7)))].filter((m) => m < tm).sort().reverse();
}
// Where an item's amount sits in a month's saved figures.
const planField = (c) => (c.kind === 'income' ? 'income' : c.kind === 'expense' || c.kind === 'subscription' ? (c.onCard ? 'cardFixed' : 'fixed') : null);
// The change an item's corrected amount makes to each month from `from` to last month.
function correctionDeltas(prev, next, from) {
  const field = planField(next);
  if (!field) return [];
  const months = pastMonths().filter((m) => m >= from).sort();
  return months.map((m) => ({ month: m, field, delta: round2((toBase(Calc.monthlyAmount(next, m), next.currency) || 0) - (toBase(Calc.monthlyAmount(prev, m), prev.currency) || 0)) })).filter((x) => Math.abs(x.delta) >= 0.005);
}
// Rewrite the saved figures (and saved item lists) of those months.
function correctPastMonths(prev, next, from) {
  const byMonth = new Map(correctionDeltas(prev, next, from).map((x) => [x.month, x]));
  for (const h of state.history) {
    const x = byMonth.get(h.date.slice(0, 7));
    if (!x || h[x.field] == null) continue;
    h[x.field] = round2(h[x.field] + x.delta);
    const list = h.breakdown && (x.field === 'income' ? h.breakdown.income : x.field === 'fixed' ? h.breakdown.bills : h.breakdown.cardBills);
    const row = list && list.find((r) => r[0] === next.id);
    if (row) row[2] = round2(row[2] + x.delta);
  }
}
// "Corrects Jul–Oct 2026: fixed costs +HK$200 a month".
function correctionPreview(v) {
  const prev = state.cashflows.find((c) => c.id === v.id) || { ...v, amount: v._origAmount };
  const next = { ...prev, ...v, amount: +v.amount };
  const list = correctionDeltas({ ...prev, amount: v._origAmount }, next, v.fixFrom);
  if (!list.length) return 'Nothing to correct: this item didn’t count in those months.';
  const what = { income: 'income', fixed: 'fixed costs', cardFixed: 'card-paid bills (used when there’s no statement)' }[list[0].field];
  const same = list.every((x) => Math.abs(x.delta - list[0].delta) < 0.01);
  const span = list.length > 1 ? `${fmtMonth(list[0].month)} – ${fmtMonth(list[list.length - 1].month)}` : fmtMonth(list[0].month);
  return `Corrects <strong>${span}</strong>: ${what} ${same ? `${list[0].delta > 0 ? '+' : '−'}${money(Math.abs(list[0].delta), base(), 0)} a month` : 'by each month’s difference'}.`;
}


// Tap a line in a month's breakdown: change it for that month only, or open the item.
function openMonthLine(ym, group, id) {
  const entry = monthEntry(ym);
  const b = (entry && entry.breakdown) || monthBreakdown(ym);
  const row = (b[group] || []).find((x) => x[0] === id);
  if (!row) return;
  const link = id.startsWith('p:') ? ['properties', id.slice(2)] : id.startsWith('l:') ? ['liabilities', id.slice(2)] : /^(interest|dividends)$/.test(id) ? null : ['cashflows', id];
  const past = ym < thisMonth();
  // This month is still being saved day by day, so only past months can be changed on their own.
  if (!past && link) return editItem(link[0], link[1]);
  openSheet(`${row[1]} · ${fmtMonth(ym)}`, `<p class="sub">${money(row[2], base(), 0)} this month${row[3] != null ? ` (corrected — was ${money(row[3], base(), 0)})` : ''}.</p>
    <div class="choice-list">
      ${past ? `<button class="btn" data-ml="one">Change for ${esc(fmtMonth(ym))} only</button>` : ''}
      ${past && row[3] != null ? `<button class="btn" data-ml="reset">Reset to ${money(row[3], base(), 0)}</button>` : ''}
      ${link ? `<button class="btn" data-ml="open">Open the item (change it from now on, or correct several months)</button>` : ''}
    </div>`, (e) => {
    const b2 = e.target.closest('[data-ml]');
    if (!b2) return;
    if (b2.dataset.ml === 'open') return editItem(link[0], link[1]);
    if (b2.dataset.ml === 'reset') { setMonthLine(ym, group, id, row[3]); toast(`${row[1]}: back to ${money(row[3], base(), 0)} for ${fmtMonth(ym)}`); return openMonth(ym); }
    openForm({
      title: `${row[1]} · ${fmtMonth(ym)}`,
      intro: `What it actually was in ${fmtMonth(ym)}, in ${base()}. Only this month changes; the item and other months stay as they are.`,
      fields: [{ key: 'amount', label: `Amount in ${fmtMonth(ym)} (${base()})`, type: 'number', required: true }],
      values: { amount: row[2] },
      onSave: (v) => { setMonthLine(ym, group, id, v.amount); toast(`${row[1]}: ${money(v.amount, base(), 0)} for ${fmtMonth(ym)}`); setTimeout(() => openMonth(ym)); },
    });
  });
}
// The record that holds a month's saved figures: its latest day.
const monthEntry = (ym) => [...state.history].reverse().find((h) => h.date.slice(0, 7) === ym && h.income != null && (h.currency || base()) === base()) || null;
// Change one line of a past month (keeping what it was), and that month's saved total with it.
function setMonthLine(ym, group, id, amount) {
  const entry = monthEntry(ym);
  if (!entry) return;
  if (!entry.breakdown) entry.breakdown = { ...monthBreakdown(ym), rebuilt: true };
  const row = (entry.breakdown[group] || []).find((x) => x[0] === id);
  if (!row) return;
  const delta = round2(+amount - row[2]);
  if (row[3] == null) row[3] = row[2];
  row[2] = round2(+amount);
  if (Math.abs(row[2] - row[3]) < 0.005) row.length = 3; // back to what it was: no longer corrected
  const field = group === 'income' ? 'income' : group === 'cardBills' ? 'cardFixed' : 'fixed';
  entry[field] = round2((+entry[field] || 0) + delta);
  entry.t = Date.now(); // the newest edit of this month syncs to your other devices
  commit();
}
document.addEventListener('click', (e) => {
  const li = e.target.closest('[data-month-line]');
  if (!li) return;
  openMonthLine(li.dataset.ym, li.dataset.group, li.dataset.monthLine);
});


// ---------------------------------------------------------------- Months tab

let cfMonth = null; // the month shown on the Months tab ("YYYY-MM")

// Open a month on the Months tab (from Month by month, or after correcting it).
function openMonth(ym) {
  if (dialog().open) dialog().close();
  cfTab = 'months';
  cfMonth = ym;
  if (currentView !== 'cashflows') location.hash = '#cashflows';
  else render();
}

// A month's lines by id (for comparing two months).
function monthLines(ym) {
  const entry = monthEntry(ym);
  const b = (entry && entry.breakdown) || monthBreakdown(ym);
  const out = new Map();
  for (const g of ['income', 'bills', 'loans']) for (const [id, name, v] of b[g] || []) out.set(id, { name, v, income: g === 'income' });
  return out;
}

function renderMonthsTab() {
  const all = monthFigures({ withCurrent: true });
  if (!all.length) return '<div class="card"><p class="sub">Months appear here once the app has saved your figures (it does every day you use it), or once you record a card statement.</p></div>';
  if (!cfMonth || !all.some((m) => m.month === cfMonth)) cfMonth = all[0].month;
  const i = all.findIndex((m) => m.month === cfMonth);
  const m = all[i];
  const prev = all[i + 1] || null; // older
  const newer = all[i - 1] || null;
  const isNow = cfMonth === thisMonth();
  const rate = (x) => (x.income ? (x.net / x.income) * 100 : null);
  const delta = (cur, old, goodUp = true) => {
    if (old == null || !isFinite(cur - old) || Math.abs(cur - old) < 0.5) return '';
    const up = cur > old;
    return `<span class="${up === goodUp ? 'pos' : 'neg'}">${up ? '▲' : '▼'} ${money(Math.abs(cur - old), base(), 0)}</span>`;
  };
  const stat = (label, value, d) => `<div class="m-stat"><span class="tile-label">${label}</span><strong>${value}</strong><span class="sub">${d || '&nbsp;'}</span></div>`;
  const sr = rate(m);
  const psr = prev ? rate(prev) : null;
  const summaryRow = `<div class="m-stats">
      ${stat('Income', money(m.income, base(), 0), prev ? delta(m.income, prev.income) : '')}
      ${stat('Spent', money(m.spending, base(), 0), prev ? delta(m.spending, prev.spending, false) : '')}
      ${stat('Left over', `<span class="${m.net >= 0 ? 'pos' : 'neg'}">${m.net >= 0 ? '+' : '−'}${money(Math.abs(m.net), base(), 0)}</span>`, prev ? delta(m.net, prev.net) : '')}
      ${stat('Savings rate', sr == null ? '—' : `${sr.toFixed(1)}%`, sr != null && psr != null && Math.abs(sr - psr) >= 0.05 ? `<span class="${sr > psr ? 'pos' : 'neg'}">${sr > psr ? '▲' : '▼'} ${Math.abs(sr - psr).toFixed(1)} pts</span>` : '')}
    </div>`;
  // What changed since the month before: card spending, then the items that moved.
  let compare = '';
  if (prev) {
    const a = monthLines(prev.month);
    const b = monthLines(cfMonth);
    const changes = [];
    if (Math.abs(m.card - prev.card) >= 0.5) changes.push({ v: m.card - prev.card, text: `Card spending ${m.card > prev.card ? '+' : '−'}${money(Math.abs(m.card - prev.card), base(), 0)}`, bad: m.card > prev.card });
    for (const [id, x] of b) {
      const old = a.get(id);
      if (!old) { if (x.v >= 0.5) changes.push({ v: x.v, text: `New: ${esc(x.name)} ${money(x.v, base(), 0)}`, bad: !x.income }); continue; }
      const d = x.v - old.v;
      if (Math.abs(d) >= 0.5) changes.push({ v: d, text: `${esc(x.name)} ${d > 0 ? '+' : '−'}${money(Math.abs(d), base(), 0)}`, bad: x.income ? d < 0 : d > 0 });
    }
    for (const [id, x] of a) if (!b.has(id) && x.v >= 0.5) changes.push({ v: x.v, text: `Gone: ${esc(x.name)}`, bad: x.income });
    if (Math.abs(m.xout - prev.xout) >= 0.5) changes.push({ v: m.xout - prev.xout, text: `One-off costs ${m.xout > prev.xout ? '+' : '−'}${money(Math.abs(m.xout - prev.xout), base(), 0)}`, bad: m.xout > prev.xout });
    if (Math.abs(m.xin - prev.xin) >= 0.5) changes.push({ v: m.xin - prev.xin, text: `Extra income ${m.xin > prev.xin ? '+' : '−'}${money(Math.abs(m.xin - prev.xin), base(), 0)}`, bad: m.xin < prev.xin });
    changes.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
    const diffSpent = m.spending - prev.spending;
    compare = `<div class="card"><h2>Compared with ${esc(fmtMonth(prev.month))}</h2>
      <p>${Math.abs(diffSpent) < 0.5 ? 'Spent the same' : `Spent <strong>${money(Math.abs(diffSpent), base(), 0)} ${diffSpent > 0 ? 'more' : 'less'}</strong>`}, ${Math.abs(m.net - prev.net) < 0.5 ? 'left over the same' : `left over <strong class="${m.net - prev.net >= 0 ? 'pos' : 'neg'}">${money(Math.abs(m.net - prev.net), base(), 0)} ${m.net - prev.net >= 0 ? 'more' : 'less'}</strong>`}.</p>
      ${changes.length ? `<ul class="m-changes">${changes.slice(0, 8).map((c) => `<li class="${c.bad ? 'neg' : 'pos'}">${c.text}</li>`).join('')}</ul>` : '<p class="sub">No item changed.</p>'}</div>`;
  }
  // The year so far (calendar year of the month shown).
  const yr = cfMonth.slice(0, 4);
  const yearMonths = all.filter((x) => x.month.slice(0, 4) === yr).slice().reverse();
  const tot = yearMonths.reduce((t, x) => ({ income: t.income + x.income, spending: t.spending + x.spending, net: t.net + x.net }), { income: 0, spending: 0, net: 0 });
  const year = `<div class="card"><h2>${yr} so far</h2>
      <ul class="m-year">${yearMonths.map((x) => `<li class="clickable${x.month === cfMonth ? ' on' : ''}" data-action="month-pick" data-month="${x.month}" tabindex="0"><span class="grow">${esc(fmtMonth(x.month))}${x.month === thisMonth() ? ' <span class="sub">so far</span>' : ''}</span><span class="num sub">${money(x.income, base(), 0)} in · ${money(x.spending, base(), 0)} out</span><span class="num ${x.net >= 0 ? 'pos' : 'neg'}">${x.net >= 0 ? '+' : '−'}${money(Math.abs(x.net), base(), 0)}</span></li>`).join('')}</ul>
      <div class="month-total"><span>Total · ${plural(yearMonths.length, 'month')}</span><strong class="${tot.net >= 0 ? 'pos' : 'neg'}">${tot.net >= 0 ? '+' : '−'}${money(Math.abs(tot.net), base(), 0)}</strong></div>
      <p class="sub">${money(tot.income, base(), 0)} income · ${money(tot.spending, base(), 0)} spent.</p></div>`;
  const switcher = `<div class="m-switch">
      <button class="btn icon-only" data-action="month-pick" data-month="${prev ? prev.month : ''}" ${prev ? '' : 'disabled'} aria-label="Earlier month">‹</button>
      <select class="range-select" data-month-select aria-label="Month">${all.map((x) => `<option value="${x.month}" ${x.month === cfMonth ? 'selected' : ''}>${esc(fmtMonth(x.month))}${x.month === thisMonth() ? ' (so far)' : ''}</option>`).join('')}</select>
      <button class="btn icon-only" data-action="month-pick" data-month="${newer ? newer.month : ''}" ${newer ? '' : 'disabled'} aria-label="Later month">›</button>
    </div>`;
  return `${switcher}
    <div class="card month-card"><div class="card-head"><h2>${esc(fmtMonth(cfMonth))}${isNow ? ' <span class="sub">so far</span>' : ''}</h2></div>
      ${summaryRow}
      ${monthDetailHtml(cfMonth, m)}
    </div>
    ${compare}
    ${year}`;
}
document.addEventListener('change', (e) => {
  if (!e.target.matches('[data-month-select]')) return;
  cfMonth = e.target.value;
  render();
});


// Past months the app has figures for, before this month, where a card has no statement
// (newest first). Only from the card's first statement on, if it has any.
function missingStatementMonths(card) {
  const thisM = todayISO().slice(0, 7);
  const months = new Set(state.history.map((h) => h.date.slice(0, 7)));
  const have = new Set(state.spending.filter((e) => e.cardId === card.id).map((e) => e.month));
  const first = [...have].sort()[0];
  return [...months].filter((m) => m < thisM && !have.has(m) && (!first || m >= first)).sort().reverse();
}


// ---------------------------------------------------------------- subscription audit

const SUB_REVIEW_DAYS = 90;
// Subscriptions that count now: active, started, not ended.
function activeSubs() {
  const t = todayISO();
  return state.cashflows.filter((c) => c.kind === 'subscription' && c.frequency !== 'once' && c.active !== false && !Calc.hasEnded(c, t) && cfStatus(c) !== 'later');
}
// Each one's cost: per year in the base currency, and its price rises in the last 12 months.
function subFacts(c) {
  const t = todayISO();
  const yearly = (toBase(Calc.monthlyAmount(c, thisMonth()), c.currency) || 0) * 12;
  const yearAgo = Calc.toISO(Calc.addDays(new Date(), -365));
  const list = [{ from: '', amount: +c.amount || 0 }, ...[...(c.changes || [])].sort((a, b) => (a.from < b.from ? -1 : 1))];
  const rises = [];
  for (let i = 1; i < list.length; i++) if (list[i].from >= yearAgo && list[i].from <= t && list[i].amount > list[i - 1].amount) rises.push({ from: list[i].from, was: list[i - 1].amount, now: list[i].amount });
  const upcoming = (c.changes || []).filter((x) => x.from > t).sort((a, b) => (a.from < b.from ? -1 : 1))[0] || null;
  return { yearly, rises, upcoming, reviewed: c.reviewedOn || null };
}
// Due a "still using it?" check: never checked, or checked over 3 months ago (and had for a month).
function subsToReview() {
  const since = Calc.toISO(Calc.addDays(new Date(), -SUB_REVIEW_DAYS));
  const month = Calc.toISO(Calc.addDays(new Date(), -30));
  return activeSubs().filter((c) => (c.reviewedOn ? c.reviewedOn < since : (c.startDate || c.trackFrom || month) <= month));
}

// The box on Cash Flow → Overview: the biggest few, and a link to the full audit.
function renderSubsCard() {
  const subs = activeSubs();
  if (!subs.length) return '';
  const rows = subs.map((c) => ({ c, f: subFacts(c) })).sort((a, b) => b.f.yearly - a.f.yearly);
  const total = rows.reduce((t, r) => t + r.f.yearly, 0);
  const due = subsToReview().length;
  return `<div class="card"><div class="card-head"><h2>Subscriptions <span class="sub">· ${money(total, base(), 0)} a year</span></h2><a href="#subscriptions" class="sub">${due ? `${plural(due, 'to review')} →` : 'Audit →'}</a></div>
    <ul class="month-lines">${rows.slice(0, 4).map((r) => `<li class="clickable" data-action="edit" data-sec="cashflows" data-id="${esc(r.c.id)}" tabindex="0"><span class="grow"><span class="keep-case">${esc(r.c.name)}</span>${r.f.rises.length ? `<span class="sub warn-text">price up ${fmtDate(r.f.rises[r.f.rises.length - 1].from)}</span>` : ''}</span><span class="num">${money(r.f.yearly, base(), 0)}<span class="sub">/yr</span></span></li>`).join('')}</ul>
    ${rows.length > 4 ? `<a href="#subscriptions" class="sub">+ ${plural(rows.length - 4, 'more')}</a>` : ''}</div>`;
}

// The audit page: every subscription by yearly cost, price rises, and a "still using it?" check.
function renderSubscriptions() {
  const t = todayISO();
  const subs = activeSubs().map((c) => ({ c, f: subFacts(c) })).sort((a, b) => b.f.yearly - a.f.yearly);
  const total = subs.reduce((x, r) => x + r.f.yearly, 0);
  const due = new Set(subsToReview().map((c) => c.id));
  const rises = subs.filter((r) => r.f.rises.length);
  const riseCost = rises.reduce((x, r) => x + r.f.rises.reduce((y, q) => y + (toBase(q.now - q.was, r.c.currency) || 0) * (12 / (({ weekly: 12 / 52, biweekly: 12 / 26, monthly: 1, quarterly: 3, semiannually: 6, yearly: 12 })[r.c.frequency] || 1)), 0), 0);
  const ended = state.cashflows.filter((c) => c.kind === 'subscription' && c.frequency !== 'once' && Calc.hasEnded(c, t) && c.endDate >= Calc.toISO(Calc.addDays(new Date(), -365)));
  const savedYearly = ended.reduce((x, c) => x + (toBase(Calc.monthlyAmount(c), c.currency) || 0) * 12, 0);
  const card = (r) => {
    const { c, f } = r;
    const per = labelOf(FREQ, c.frequency).toLowerCase();
    const share = total > 0 ? `${((f.yearly / total) * 100).toFixed(1)}%` : '';
    const facts = [
      `${money(Calc.amountOn(c, t), c.currency)} ${per}`,
      c.onCard ? `${icon('card')} card` : c.accountId && accountName(c.accountId) ? `↔ ${esc(accountName(c.accountId))}` : '',
      `next ${fmtDate(Calc.nextOccurrence(c, t))}`,
    ].filter(Boolean).join(' · ');
    const rise = f.rises.map((q) => `<span class="warn-text">Price up ${money(q.was, c.currency)} → ${money(q.now, c.currency)} on ${fmtDate(q.from)}</span>`).join('<br>');
    const soon = f.upcoming ? `<span class="warn-text">Going up to ${money(f.upcoming.amount, c.currency)} from ${fmtDate(f.upcoming.from)}</span>` : '';
    return `<div class="card sub-card${due.has(c.id) ? ' due' : ''}">
        <div class="sub-top"><span class="grow"><strong class="keep-case">${esc(c.name)}</strong><span class="sub">${facts}</span></span><span class="num"><strong>${money(f.yearly, base(), 0)}</strong><span class="sub">a year · ${share}</span></span></div>
        ${rise || soon ? `<p class="sub sub-rise">${[rise, soon].filter(Boolean).join('<br>')}</p>` : ''}
        <div class="row-actions sub-actions">
          <span class="sub grow">${due.has(c.id) ? '<strong>Still using it?</strong>' : f.reviewed ? `Checked ${fmtDate(f.reviewed)}` : ''}</span>
          ${due.has(c.id) ? `<button class="btn small" data-action="sub-keep" data-id="${esc(c.id)}">Still using it</button>` : ''}
          <button class="btn small ${due.has(c.id) ? 'primary' : 'ghost'}" data-action="sub-cancel" data-id="${esc(c.id)}">Cancelled — end it</button>
          <button class="btn small ghost" data-action="edit" data-sec="cashflows" data-id="${esc(c.id)}">Edit</button>
        </div>
      </div>`;
  };
  return `<a class="back" href="#cashflows">‹ Cash Flow</a>
    <div class="page-head"><div><h1>Subscriptions</h1><p class="sub intro">Every subscription by what it costs you a year. Every 3 months the app asks whether you still use each one.</p></div>
      <div class="row-actions"><button class="btn primary" data-action="add" data-sec="cashflows" data-kind="subscription">+ Add subscription</button></div></div>
    <section class="tiles">
      ${tile('Per year', money(total, base(), 0), `${money(total / 12, base(), 0)} a month · ${plural(subs.length, 'subscription')}`)}
      ${tile('To review', String(due.size), due.size ? 'still using them?' : 'all checked')}
      ${tile('Price rises', rises.length ? `+${money(riseCost, base(), 0)}` : '—', rises.length ? `a year, from ${plural(rises.length, 'subscription')} in the last 12 months` : 'none in the last 12 months')}
      ${tile('Saved by cancelling', savedYearly ? money(savedYearly, base(), 0) : '—', ended.length ? `a year · ${plural(ended.length, 'ended')} in the last 12 months` : 'nothing ended this year')}
    </section>
    ${subs.length ? subs.map(card).join('') : '<div class="card empty">No subscriptions yet.</div>'}
    ${ended.length ? `<h2 class="health-h">Ended this year</h2><div class="card"><ul class="month-lines">${ended.map((c) => `<li><span class="grow"><span class="keep-case">${esc(c.name)}</span><span class="sub">ended ${fmtDate(c.endDate)}</span></span><span class="num">${money((toBase(Calc.monthlyAmount(c), c.currency) || 0) * 12, base(), 0)}<span class="sub">/yr saved</span></span><button class="btn small" data-action="restart-cf" data-id="${esc(c.id)}">Restart</button></li>`).join('')}</ul></div>` : ''}`;
}
