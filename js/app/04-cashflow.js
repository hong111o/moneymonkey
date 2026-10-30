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
  const tabs = [['overview', 'Overview'], ['cards', 'Cards & spending'], ['items', `Items (${state.cashflows.length})`]];
  const tabBar = `<div class="seg tabs" role="tablist" aria-label="Cash flow">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${cfTab === k}" data-action="cf-tab" data-tab="${k}" class="${cfTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (cfTab === 'cards') return renderSection('cashflows', { tiles: tabBar, before: renderCardsCard(), list: '' });
  if (cfTab === 'items') return renderSection('cashflows', { tiles: tabBar, before: '', list: renderFlowGroups() });
  // Each part is a box you can move or hide (Edit layout).
  const part = (id, name, html) => (html ? `<div data-box="${id}" data-name="${name}">${html}</div>` : '');
  const before = `<div class="boxes" data-layout="sections">${part('coming', 'Coming up', renderComingUp())}${part('split', 'Where your income goes', renderIncomeSplit())}${part('history', 'Month by month', renderHistory())}${part('categories', 'Fixed bills by category', cats.length ? `<div class="card"><h2>Fixed bills by category</h2><div class="hbars" style="${barValueWidth(cats.map(([, v]) => money(v, base(), 0)))}">${catBars}</div></div>` : '')}</div>`;
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
function monthFigures() {
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
  return [...new Set([...cardByMonth.keys(), ...extras.keys()])].sort().reverse().map((month) => {
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
  const rows = h.map((m) => `<div class="hist-row">
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
