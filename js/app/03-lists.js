/* MoneyMonkey app — Generic list pages, bank accounts, platforms and regions.
 * The js/app/*.js files are loaded in order as plain scripts and share one scope (see index.html). */
'use strict';

// ---------------------------------------------------------------- generic list section

function sectionTiles(key, items) {
  const sec = SECTIONS[key];
  if (!sec.total) return '';
  const t = todayISO();
  let extra = '';
  if (key === 'accounts') {
    const rows = Calc.cashByCurrency({ ...state, accounts: items }, todayISO());
    const cur = filters.accountsCurrency;
    const r = cur && rows.find((x) => x.currency === cur);
    if (cur) {
      return `<section class="tiles">${tile(`${esc(cur)} across accounts`, money(r ? r.amount : 0, cur), r ? `${cur !== base() ? `≈ ${money(r.base, base(), 0)} · ` : ''}${plural(r.accounts.length, 'account')}` : '')}${tile(`All cash (${esc(base())})`, money(sec.total(state.accounts)))}</section>`;
    }
    const allRated = rows.every((x) => isFinite(x.base));
    const deps = state.deposits.filter((d) => items.some((a) => a.id === d.accountId));
    return `<section class="tiles">
      ${tile(`Cash (${esc(base())})`, money(sec.total(items)))}
      ${tile('Fixed deposits', money(depositsTotal(deps)), deps.length ? `${plural(deps.length, 'deposit')} · <a href="#deposits">see all</a>` : 'add one from an account')}
      ${tile('Currencies', String(rows.length), rows[0] && allRated ? `Largest: ${esc(rows[0].currency)} (${pct(rows[0].share, false)})` : rows.length ? 'waiting for exchange rates' : '')}
    </section>`;
  } else if (key === 'stocks' || key === 'crypto') {
    let mv = 0, cost = 0, day = 0, costPos = 0, pnlPos = 0, inHoldings = 0;
    for (const h of items) {
      const v = hv(h);
      mv += toBase(v.marketValue, h.currency) || 0;
      cost += toBase(v.cost, h.currency) || 0;
      day += toBase(v.dayChange, h.currency) || 0;
      inHoldings += toBase(v.realisedIn, h.currency) || 0;
      if (v.cost > 0) { costPos += toBase(v.cost, h.currency) || 0; pnlPos += toBase(v.pnl, h.currency) || 0; }
    }
    const cash = brokerCashAccounts(key).reduce((t, a) => t + (accountTotal(a) || 0), 0);
    const divYear = key === 'stocks' ? items.reduce((t, h) => t + (toBase(Calc.dividendPerYear(h), h.currency) || 0), 0) : 0;
    const tap = (what) => `${explainAttr(what)} data-cat="${key}"`;
    // The % only counts holdings with a positive cost (a zero or diluted-negative cost has no %).
    extra = tile('Profit / loss', signed(mv - cost), costPos ? `${pct(pnlPos / costPos)} on ${money(costPos, base(), 0)}${costPos !== cost ? ' (holdings with a cost)' : ''}` : 'no cost to compare', '', items.length ? tap('pnl') : '') + tile(key === 'crypto' ? 'Last 24h' : 'Today', signed(day), '', '', items.length ? tap('today') : '')
      + (cash ? tile('Uninvested cash', money(cash), 'in your investment accounts', '', tap('brokercash')) : '')
      + (state.trades.some((e) => e.section === key && e.side === 'sell') ? (() => {
        const year = todayISO().slice(0, 4);
        const r = Calc.realisedProfit(state.trades, (v, c) => toBase(v, c) || 0, key, `${year}-01-01`);
        return tile(`Realised profit ${year}`, signed(r.total), `${plural(r.sells.length, 'sale')} this year${inHoldings ? ' · diluted holdings already include their part' : ''}`, '', tap('realised'));
      })() : '')
      + (divYear ? tile('Dividends / yr', `<span class="pos">${money(divYear, base(), 0)}</span>`, `${money(divYear / 12, base(), 0)} a month on average`, '', explainAttr('dividends')) : '');
  } else if (key === 'deposits') {
    let interest = 0, daily = 0;
    for (const d of items) {
      const v = Calc.depositValue(d, t);
      interest += toBase(v.interest, d.currency) || 0;
      daily += toBase(v.dailyInterest, d.currency) || 0;
    }
    const next = items.map((d) => Calc.depositValue(d, t)).filter((v) => !v.matured).sort((a, b) => (a.maturityDate < b.maturityDate ? -1 : 1))[0];
    extra = tile('Interest so far', `<span class="pos">${money(interest)}</span>`, `${money(daily)} per day`, '', items.length ? explainAttr('fd-interest') : '') + tile('Next maturity', next ? fmtDate(next.maturityDate) : '—', next ? `in ${plural(next.daysLeft, 'day')}` : '', '', items.length ? explainAttr('maturities') : '');
  } else if (key === 'liabilities') {
    extra = tile('Repayments / mo', money(items.reduce((s, l) => s + (Calc.loanBalance(l, t).balance > 0 ? toBase(l.payment, l.currency) || 0 : 0), 0)));
  } else if (key === 'properties') {
    extra = tile('Rent / mo', money(items.reduce((s, p) => s + (toBase(p.monthlyRent, p.currency) || 0), 0)));
  }
  return `<section class="tiles">${tile(`Total (${esc(base())})`, `<span class="${sec.negative ? 'neg' : ''}">${money(sec.total(items))}</span>`)}${extra}</section>`;
}

function renderSection(key, opts = {}) {
  const sec = SECTIONS[key];
  const all = state[key];
  const platformNames = [...new Set(all.map((x) => x.platform || ''))].sort();
  const filter = filters[key] ?? null;
  let items = filter == null ? all : all.filter((x) => (x.platform || '') === filter);
  const showFilter = PLATFORM_SECTIONS.includes(key) && platformNames.length > 1;
  const curFilter = key === 'accounts' ? filters.accountsCurrency ?? null : null;
  const currencies = key === 'accounts' ? [...new Set(all.flatMap((a) => Calc.accountBalances(a).map((b) => b.currency)))].sort() : [];
  if (curFilter) items = items.filter((a) => Calc.accountBalances(a).some((b) => b.currency === curFilter));

  return `${key === 'deposits' ? '<a class="back" href="#accounts">‹ Cash &amp; Bank</a>' : ''}
    <div class="page-head">
      <div><h1>${sec.title}</h1><p class="sub intro">${sec.intro}</p></div>
      <div class="row-actions">
        ${showFilter ? `<select class="filter" data-filter="${key}" aria-label="Filter by platform"><option value="__all">All platforms</option>${platformNames.map((p) => `<option value="${esc(p)}" ${filter === p ? 'selected' : ''}>${esc(p || 'No platform')}</option>`).join('')}</select>` : ''}
        ${currencies.length > 1 ? `<select class="filter" data-filter="accountsCurrency" aria-label="Filter by currency"><option value="__all">All currencies</option>${currencies.map((c) => `<option value="${esc(c)}" ${curFilter === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
        ${key === 'stocks' || key === 'crypto' ? `<button class="btn" data-action="refresh">${icon('refresh')} Prices</button><button class="btn" data-action="trade-buy" data-sec="${key}">Buy / sell</button>` : ''}
        ${key === 'accounts' && state.accounts.length ? '<button class="btn" data-action="checkin">Check-in</button><button class="btn" data-action="transfer">Transfer / exchange</button>' : ''}
        ${key === 'cashflows' ? '<button class="btn" data-action="add" data-sec="cashflows" data-once="1">+ Extra / one-off</button>' : ''}
        <button class="btn primary" data-action="add" data-sec="${key}">+ Add</button>
      </div>
    </div>
    ${opts.tiles ?? sectionTiles(key, items)}
    ${opts.before || ''}
    ${opts.listTitle && items.length && opts.list === undefined ? `<div class="section-head" id="all-items"><h2>${opts.listTitle}</h2><button class="btn small primary" data-action="add" data-sec="${key}">+ Add</button></div>` : ''}
    ${key === 'accounts' ? renderCashByCurrency(filter == null ? all : all.filter((x) => (x.platform || '') === filter)) : ''}
    ${opts.list !== undefined ? opts.list : items.length ? renderItemsTable(key, items)
      : `<div class="card empty">No ${sec.singular}s${filter != null || curFilter ? ' match this filter' : ' yet'}. <button class="btn primary" data-action="add" data-sec="${key}">+ Add ${sec.singular}</button></div>`}
    ${key === 'deposits' ? renderDepositHistory() : ''}
    ${key === 'stocks' || key === 'crypto' ? renderBrokerCard(key) : ''}
    ${opts.after || ''}`;
}

// The list of items for a section, as a table on wide screens and tappable cards on phones.
// What an item is called, for labels and pinned boxes.
function itemName(key, item) {
  if (key === 'deposits') return `${item.platform || (item.kind === 'regular' ? 'Regular saver' : 'Fixed deposit')}${item.name ? ` · ${item.name}` : ''}`;
  return item.name || item.symbol || item.coinId || item.platform || '';
}

function renderItemsTable(key, items) {
  const sec = SECTIONS[key];
  const rows = items
    .map((item) => `<tr class="clickable" data-action="${sec.rowAction || 'edit'}" data-sec="${key}" data-id="${esc(item.id)}" data-box="${esc(item.id)}" data-name="${esc(itemName(key, item))}" tabindex="0">
      ${sec.columns.map((c) => `<td class="${c.num ? 'num' : ''} ${c.primary ? 'primary' : ''} ${c.wide ? 'wide' : ''}" data-label="${esc(c.label)}">${c.render(item)}</td>`).join('')}
      <td class="actions">${(sec.actions || []).map((a) => `<button class="btn small" data-action="${a.id}" data-sec="${key}" data-id="${esc(item.id)}">${a.label}</button>`).join('')}<span class="chev" aria-hidden="true">›</span></td></tr>`)
    .join('');
  // The rows can be reordered (and pinned to Home) with Edit layout, like the boxes.
  return `<div class="card table-card"><table class="data"><thead><tr>${sec.columns.map((c) => `<th class="${c.num ? 'num' : ''}">${c.label}</th>`).join('')}<th></th></tr></thead><tbody data-layout="list-${key}">${rows}</tbody></table></div>`;
}

// ---------------------------------------------------------------- investment accounts (holdings + cash)

// "Brokerage cash" accounts shown with a holdings section: those on a platform holding this
// kind of asset, plus (on Stocks) any not tied to a crypto platform.
function brokerCashAccounts(key) {
  const here = new Set(state[key].map((h) => h.platform || ''));
  const other = new Set(state[key === 'stocks' ? 'crypto' : 'stocks'].map((h) => h.platform || ''));
  return state.accounts.filter((a) => a.type === 'brokerage' && (here.has(a.platform || '') || (key === 'stocks' && !other.has(a.platform || ''))));
}

function renderBrokerCard(key) {
  const cashAccts = brokerCashAccounts(key);
  const names = [...new Set([...state[key].map((h) => h.platform || ''), ...cashAccts.map((a) => a.platform || '')])];
  if (!names.length) return '';
  const rows = names.map((name) => {
    const holdings = state[key].filter((h) => (h.platform || '') === name);
    const held = holdings.reduce((t, h) => t + (toBase(hv(h).marketValue, h.currency) || 0), 0);
    const accts = cashAccts.filter((a) => (a.platform || '') === name);
    const cash = accts.reduce((t, a) => t + (accountTotal(a) || 0), 0);
    const cashLines = accts.flatMap((a) => Calc.accountBalances(a).filter((b) => +b.amount).map((b) => `<a href="#account/${encodeURIComponent(a.id)}" class="cur-pill"><span class="cur-tag">${esc(b.currency)}</span> ${money(Calc.balanceValue(b, todayISO()).value, b.currency)}</a>`));
    const addBtn = name
      ? `<button class="btn small" data-action="${accts.length ? 'open-account' : 'add'}" ${accts.length ? `data-id="${esc(accts[0].id)}"` : `data-sec="accounts" data-type="brokerage" data-platform="${esc(name)}"`}>${accts.length ? 'Update cash' : '+ Cash'}</button>`
      : '';
    return `<div class="broker">
      <div class="broker-head"><a href="#platform/${encodeURIComponent(name)}"><strong>${esc(name || 'No platform set')}</strong></a><strong class="num">${money(held + cash)}</strong></div>
      <div class="broker-split">
        <span>Invested <strong>${money(held)}</strong>${holdings.length ? ` <span class="sub">· ${plural(holdings.length, key === 'crypto' ? 'coin' : 'holding')}</span>` : ''}</span>
        <span>Cash <strong>${money(cash)}</strong></span>
      </div>
      ${held + cash > 0 ? `<div class="stack" aria-hidden="true"><span style="flex-grow:${Math.max(held, 0)};background:var(--series-2)"></span><span style="flex-grow:${Math.max(cash, 0)};background:var(--series-1)"></span></div>` : ''}
      <div class="broker-cash">${cashLines.join('')}${addBtn}</div>
    </div>`;
  }).join('');
  return `<div class="section-head"><h2>By account</h2></div>
    <div class="card">
      <p class="sub">What’s invested and what’s sitting as cash in each ${key === 'crypto' ? 'exchange or wallet' : 'broker account'}. <span class="swatch" style="background:var(--series-2)"></span>invested <span class="swatch" style="background:var(--series-1)"></span>cash</p>
      ${rows}
    </div>`;
}

// ---------------------------------------------------------------- one bank account

function renderAccount(id) {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return '<a class="back" href="#accounts">‹ Cash &amp; Bank</a><div class="card empty">This account no longer exists.</div>';
  const t = todayISO();
  const deps = accountDeposits(a);
  const bals = Calc.accountBalances(a);
  const cash = accountTotal(a);
  const fd = depositsTotal(deps);
  let interest = 0, daily = 0, fdDaily = 0;
  for (const d of deps) {
    const v = Calc.depositValue(d, t);
    interest += toBase(v.interest, d.currency) || 0;
    fdDaily += toBase(v.dailyInterest, d.currency) || 0;
  }
  daily = fdDaily;
  const balRows = bals.map((b) => {
    const bv = Calc.balanceValue(b, t);
    interest += toBase(bv.accrued, b.currency) || 0;
    daily += toBase(bv.daily, b.currency) || 0;
    const saver = +b.rate ? `<div class="sub">${num(b.rate, 2)}% p.a. · +${money(bv.daily, b.currency)}/day${bv.accrued > 0.005 ? ` · incl. ~${money(bv.accrued, b.currency)} interest since ${fmtDate(b.asOf)}` : ''}</div>` : '';
    return `<li class="clickable" data-action="edit" data-sec="accounts" data-id="${esc(a.id)}" tabindex="0">
      <span class="cur-tag">${esc(b.currency)}</span><span class="grow"><strong>${money(bv.value, b.currency)}</strong>${saver}</span>
      <span class="sub">${b.currency !== base() ? `≈ ${money(toBase(bv.value, b.currency), base(), 0)}` : ''}</span></li>`;
  }).join('');
  const ACTIVITY_KINDS = ['deposit-cash', 'deposit-renew', 'payment', 'transfer'];
  const history = [...state.activity.filter((e) => ACTIVITY_KINDS.includes(e.kind) && (e.accountId === a.id || e.heldIn === a.id || e.toAccountId === a.id)), ...state.trades.filter((e) => e.accountId === a.id).map((e) => ({ ...e, kind: 'trade' }))]
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : (y._mt || 0) - (x._mt || 0)));
  const showAll = filters.activityAll === a.id;
  const moreActivity = showAll ? 0 : Math.max(0, history.length - 15);
  if (!showAll) history.length = Math.min(history.length, 15);
  const meta = [a.platform ? `<a href="#platform/${encodeURIComponent(a.platform)}">${esc(a.platform)}</a>` : '', esc(labelOf(ACCOUNT_TYPES, a.type)), esc(a.note || '')].filter(Boolean).join(' · ');
  return `<a class="back" href="#accounts">‹ Cash &amp; Bank</a>
    <div class="page-head">
      <div><h1 class="keep-case">${esc(a.name)}</h1><p class="sub">${meta}</p></div>
      <div class="row-actions"><button class="btn" data-action="transfer" data-account="${esc(a.id)}">Transfer / exchange</button><button class="btn" data-action="edit" data-sec="accounts" data-id="${esc(a.id)}">Edit account</button></div>
    </div>
    <section class="tiles">
      ${tile(`Total (${esc(base())})`, money(cash + fd))}
      ${tile('Cash', money(cash), bals.length ? currenciesWord(bals.length) : 'no balances yet')}
      ${tile('Fixed deposits', money(fd), deps.length ? `${plural(deps.length, 'deposit')} · +${money(fdDaily)}/day` : 'none yet')}
      ${daily > 0 ? tile('Interest', `<span class="pos">+${money(daily)}/day</span>`, `${money(interest)} earned so far${bals.some((b) => +b.rate) ? ' (saver part estimated)' : ''}`) : ''}
    </section>
    <div class="section-head"><h2>Cash</h2><button class="btn small" data-action="edit" data-sec="accounts" data-id="${esc(a.id)}">Update balances</button></div>
    <div class="card">
      ${bals.length ? `<ul class="acct-bals">${balRows}</ul>` : '<p class="sub">No cash in this account yet. Tap “Update balances” to add one line per currency.</p>'}
      <p class="sub">Balances updated ${ago(a.updatedAt)}</p>
    </div>
    <div class="section-head"><h2>Fixed deposits &amp; savers</h2><span class="row-actions"><button class="btn small" data-action="add" data-sec="deposits" data-kind="regular" data-account="${esc(a.id)}">+ Regular saver</button><button class="btn small primary" data-action="add" data-sec="deposits" data-account="${esc(a.id)}">+ Fixed deposit</button></span></div>
    ${deps.length ? renderItemsTable('deposits', deps) : '<div class="card"><p class="sub">No fixed deposits or regular savers in this account.</p></div>'}
    ${history.length ? `<div class="section-head"><h2>Activity</h2></div><div class="card"><ul class="events">${history.map((e) => `<li><span class="ev-date">${fmtDate(e.date)}</span><span class="ev-label">${activityText(e)}</span>${e.kind === 'payment' ? `<button class="btn small ghost" data-action="undo-payment" data-id="${esc(e.id)}">Undo</button>` : '<span></span>'}</li>`).join('')}</ul>${moreActivity ? `<button class="btn small" data-action="activity-all" data-id="${esc(a.id)}">Show all (${moreActivity} more)</button>` : ''}</div>` : ''}`;
}

// Each currency's total across accounts, as a stacked bar split by account plus a legend list.
function renderCashByCurrency(accounts) {
  const rows = Calc.cashByCurrency({ ...state, accounts }, todayISO());
  if (!rows.length) return '';
  const cur = filters.accountsCurrency;
  const blocks = rows.map((r) => {
    const segs = r.accounts.map((a, i) => ({ ...a, color: i < 6 ? `var(--series-${i + 1})` : 'var(--muted)' }));
    const bar = segs.map((g) => `<span style="flex-grow:${Math.max(g.amount, 0)};background:${g.color}" data-tip="${esc(g.name)}: ${esc(money(g.amount, r.currency))}"></span>`).join('');
    const list = segs.map((g) => `<li><span class="swatch" style="background:${g.color}"></span><span class="grow">${esc(g.name)}${g.platform ? ` <span class="sub">· ${esc(g.platform)}</span>` : ''}</span><span class="num">${money(g.amount, r.currency)}</span></li>`).join('');
    const share = isFinite(r.base) ? `${(r.share * 100).toFixed(1)}% of cash` : 'no exchange rate yet';
    return `<div class="cur-block ${cur === r.currency ? 'on' : ''}">
      <button class="cur-head" data-action="cur-filter" data-cur="${esc(r.currency)}" aria-pressed="${cur === r.currency}">
        <span class="cur-tag">${esc(r.currency)}</span><strong class="grow">${money(r.amount, r.currency)}</strong>
        <span class="sub">${r.currency !== base() && isFinite(r.base) ? `≈ ${money(r.base, base(), 0)} · ` : ''}${share}</span>
      </button>
      <div class="stack" aria-hidden="true">${bar}</div>
      <ul class="cur-accounts">${list}</ul>
    </div>`;
  }).join('');
  return `<div class="card">
    <div class="card-head"><h2>Cash by currency</h2>${cur ? '<button class="btn small" data-action="cur-filter" data-cur="">Show all currencies</button>' : ''}</div>
    <p class="sub">Each currency’s total across all your accounts. Tap a currency to list only the accounts holding it.</p>
    ${blocks}
  </div>`;
}

function renderDepositHistory() {
  const done = state.activity.filter((e) => e.kind && e.kind.startsWith('deposit-')).slice(0, 10);
  if (!done.length) return '';
  return `<div class="card"><h2>Matured deposits</h2><ul class="events">${done.map((e) => `<li><span class="ev-date">${fmtDate(e.date)}</span><span class="ev-label">${activityText(e)}</span><span></span></li>`).join('')}</ul></div>`;
}

// ---------------------------------------------------------------- platforms

function renderPlatforms() {
  const { platforms, regions } = Calc.platformBreakdown(state, todayISO());
  const net = summary.netWorth || 0;
  const regionTiles = regions.map((r) => tile(esc(r.region || 'No region'), money(r.net), `${plural(r.platforms, 'platform')}${net > 0 ? ` · ${((r.net / net) * 100).toFixed(1)}% of net worth` : ''}`, '', `data-action="open-region" data-name="${esc(r.region)}"`)).join('');
  return `<div class="page-head"><div><h1>Platforms</h1><p class="sub intro">Everything grouped by where it’s held — banks, brokers, exchanges, lenders. Tap a region or a platform to see what’s in it, edit items, or set a platform’s region (e.g. Hong Kong, United Kingdom).</p></div></div>
    ${regionTiles ? `<section class="tiles">${regionTiles}</section>` : ''}
    ${platforms.length ? renderPlatformTable(platforms) : '<div class="card empty">Nothing here yet. Add accounts, holdings or deposits with a platform name.</div>'}`;
}

function renderPlatformTable(platforms) {
  const net = summary.netWorth || 0;
  const cell = (v, cls = '') => (Math.abs(v) < 0.005 ? '<span class="sub">—</span>' : `<span class="${cls}">${money(v, base(), 0)}</span>`);
  const td = (label, v, cls = '') => `<td class="num ${Math.abs(v) < 0.005 ? 'empty-cell' : ''}" data-label="${label}">${cell(v, cls)}</td>`;
  // Each platform is a box you can move in Edit layout (the "no platform" row too).
  const rows = platforms.map((p) => `<tr class="clickable" data-action="open-platform" data-name="${esc(p.name)}" data-box="${esc(p.name || '__none')}" tabindex="0">
      <td data-label="Platform"><strong>${esc(p.name || 'No platform set')}</strong><div class="sub">${p.region ? `${esc(p.region)}${p.regionGuessed ? ' <span class="badge" title="Guessed from currency — tap to set">guess</span>' : ''}` : (p.name ? 'Tap to set a region' : 'Edit items to add a platform')} · ${plural(p.count, 'item')} · ${esc(p.currencies.join(', '))}</div></td>
      ${td('Cash', p.cash)}${td('Investments', p.invest)}${td('Deposits', p.deposits)}${td('Property &amp; other', p.property + p.other)}${td('Debts', -p.debt, 'neg')}
      <td class="num primary" data-label="Net">${money(p.net, base(), 0)}<div class="sub">${net > 0 ? `${((p.net / net) * 100).toFixed(1)}%` : ''}</div></td>
      <td class="actions"><span class="chev" aria-hidden="true">›</span></td></tr>`).join('');
  return `<div class="card table-card"><table class="data"><thead><tr><th>Platform</th><th class="num">Cash</th><th class="num">Investments</th><th class="num">Deposits</th><th class="num">Property & other</th><th class="num">Debts</th><th class="num">Net</th><th></th></tr></thead><tbody data-layout="list-platforms">${rows}</tbody></table></div>`;
}

// ---------------------------------------------------------------- one region

function renderRegion(name) {
  const { platforms } = Calc.platformBreakdown(state, todayISO());
  const list = platforms.filter((p) => (p.region || '') === name);
  const back = '<a class="back" href="#platforms">‹ Platforms</a>';
  const title = esc(name || 'No region');
  if (!list.length) return `${back}<div class="page-head"><div><h1>${title}</h1></div></div><div class="card empty">No platforms in this region any more.</div>`;
  const sum = (k) => list.reduce((t, p) => t + p[k], 0);
  const regionNet = sum('net');
  const net = summary.netWorth || 0;
  const currencies = [...new Set(list.flatMap((p) => p.currencies))].sort();
  const guessed = list.some((p) => p.regionGuessed);
  const tiles = [
    tile('Net', money(regionNet), net > 0 ? `${((regionNet / net) * 100).toFixed(1)}% of net worth` : ''),
    sum('cash') ? tile('Cash', money(sum('cash')), '', '', partAttr('region', name, 'cash')) : '',
    sum('deposits') ? tile('Fixed deposits', money(sum('deposits')), '', '', partAttr('region', name, 'deposits')) : '',
    sum('invest') ? tile('Investments', money(sum('invest')), '', '', partAttr('region', name, 'invest')) : '',
    sum('property') + sum('other') ? tile('Property & other', money(sum('property') + sum('other')), '', '', partAttr('region', name, 'property')) : '',
    sum('debt') ? tile('Debts', `<span class="owed">${money(sum('debt'))}</span>`, '', '', partAttr('region', name, 'debt')) : '',
  ].join('');
  return `${back}
    <div class="page-head"><div><h1>${title}</h1><p class="sub">${plural(list.length, 'platform')} · ${esc(currencies.join(', '))}</p></div></div>
    <section class="tiles">${tiles}</section>
    ${guessed ? '<p class="sub">Some platforms here were placed by their currency (marked “guess”). Open a platform and use “Edit name &amp; region” to set it for sure.</p>' : ''}
    <div class="section-head"><h2>Platforms</h2></div>
    ${renderPlatformTable(list)}`;
}

// ---------------------------------------------------------------- one platform

const PLATFORM_GROUP_TITLES = [['accounts', 'Cash accounts'], ['deposits', 'Fixed deposits'], ['stocks', 'Stocks & ETFs'], ['crypto', 'Crypto'], ['properties', 'Property'], ['others', 'Other assets'], ['liabilities', 'Debts']];

function renderPlatformDetail(name) {
  const p = Calc.platformBreakdown(state, todayISO()).platforms.find((x) => x.name === name);
  const back = '<a class="back" href="#platforms">‹ Platforms</a>';
  const title = esc(name || 'No platform set');
  if (!p) {
    return `${back}<div class="page-head"><div><h1>${title}</h1></div></div>
      <div class="card empty">Nothing on this platform any more.</div>`;
  }
  const net = summary.netWorth || 0;
  const tiles = [
    tile('Net', money(p.net), net > 0 ? `${((p.net / net) * 100).toFixed(1)}% of net worth` : ''),
    p.cash ? tile('Cash', money(p.cash), '', '', partAttr('platform', name, 'cash')) : '',
    p.deposits ? tile('Fixed deposits', money(p.deposits), '', '', partAttr('platform', name, 'deposits')) : '',
    p.invest ? tile('Investments', money(p.invest), '', '', partAttr('platform', name, 'invest')) : '',
    p.property + p.other ? tile('Property & other', money(p.property + p.other), '', '', partAttr('platform', name, 'property')) : '',
    p.debt ? tile('Debts', `<span class="owed">${money(p.debt)}</span>`, '', '', partAttr('platform', name, 'debt')) : '',
  ].join('');
  const groups = PLATFORM_GROUP_TITLES.map(([k, label]) => {
    const items = state[k].filter((x) => (x.platform || '') === name);
    if (!items.length) return '';
    return `<div class="section-head"><h2>${label}</h2><button class="btn small" data-action="add" data-sec="${k}" data-platform="${esc(name)}">+ Add</button></div>${renderItemsTable(k, items)}`;
  }).join('');
  const addMore = PLATFORM_GROUP_TITLES.filter(([k]) => !state[k].some((x) => (x.platform || '') === name))
    .map(([k, label]) => `<button class="btn small" data-action="add" data-sec="${k}" data-platform="${esc(name)}">+ ${label}</button>`).join('');
  const meta = [p.region ? `${esc(p.region)}${p.regionGuessed ? ' <span class="badge" title="Guessed from currency">guess</span>' : ''}` : '', esc(p.currencies.join(', '))].filter(Boolean).join(' · ');
  return `${back}
    <div class="page-head">
      <div><h1>${title}</h1><p class="sub">${meta}</p></div>
      ${name ? `<div class="row-actions"><button class="btn" data-action="edit-platform" data-name="${esc(name)}">Edit name &amp; region</button></div>` : ''}
    </div>
    <section class="tiles">${tiles}</section>
    ${groups}
    ${name && addMore ? `<div class="card"><p class="sub">Add something else held at ${title}:</p><div class="row-actions wrap">${addMore}</div></div>` : ''}`;
}

function editPlatform(name) {
  const meta = state.platformMeta[name] || {};
  const guess = Calc.platformBreakdown(state, todayISO()).platforms.find((p) => p.name === name);
  openForm({
    title: `Platform — ${name}`,
    fields: [
      { key: 'name', label: 'Name', required: true, list: 'platform-list', help: 'Renaming updates every item on this platform.' },
      { key: 'region', label: 'Region / country', list: 'region-list', placeholder: 'e.g. Hong Kong', help: 'Used for the “by region” totals.' },
    ],
    values: { name, region: meta.region || (guess && guess.region) || '' },
    onSave: (v) => {
      const now = Date.now();
      if (v.name !== name) {
        for (const s of PLATFORM_SECTIONS) for (const item of state[s]) if (item.platform === name) { item.platform = v.name; item._mt = now; }
        delete state.platformMeta[name];
      }
      state.platformMeta[v.name] = { region: v.region, _mt: now };
      if (currentView === 'platform' && viewParam === name) {
        viewParam = v.name;
        history.replaceState(null, '', `#platform/${encodeURIComponent(v.name)}`);
      }
      commit();
      toast('Platform updated');
    },
  });
}
