/* MoneyMonkey app — Live prices and sync.
 * The js/app/*.js files are loaded in order as plain scripts and share one scope (see index.html). */
'use strict';

// ================================================================== live data

let refreshing = false;
let lastErrors = [];

async function refreshPrices({ force = false, announce = false } = {}) {
  if (refreshing) return;
  refreshing = true;
  renderStatus();
  const errors = [];
  try {
    const fxStale = !state.fx.updatedAt || state.fx.base !== base() || Date.now() - new Date(state.fx.updatedAt) > FX_MAX_AGE_MS;
    if (force || fxStale) {
      try { state.fx = await Prices.fetchFx(base()); } catch (e) { errors.push(`exchange rates (${e.message})`); }
    }

    const liveStocks = state.stocks.filter((s) => s.source !== 'manual');
    if (liveStocks.length && state.settings.finnhubKey) {
      const symbols = [...new Set(liveStocks.map((s) => s.symbol))];
      for (const sym of symbols) {
        try {
          const q = await Prices.fetchStockQuote(sym, state.settings.finnhubKey);
          for (const s of state.stocks) if (s.symbol === sym && s.source !== 'manual') { s.lastPrice = q.price; s.prevClose = q.prevClose; }
        } catch (e) { errors.push(`${sym} (${e.message})`); }
        if (symbols.length > 1) await Prices.sleep(250);
      }
    }

    const liveCoins = state.crypto.filter((c) => c.source !== 'manual');
    if (liveCoins.length) {
      try {
        const data = await Prices.fetchCrypto([...new Set(liveCoins.map((c) => c.coinId))], [...new Set(liveCoins.map((c) => c.currency))]);
        for (const c of liveCoins) {
          const q = data[c.coinId] && data[c.coinId][c.currency];
          if (!q) { errors.push(`${c.coinId} in ${c.currency} (not found)`); continue; }
          c.lastPrice = q.price;
          c.prevClose = isFinite(q.changePct) ? q.price / (1 + q.changePct / 100) : null;
        }
      } catch (e) { errors.push(`crypto (${e.message})`); }
    }

    if (liveStocks.length || liveCoins.length) state.pricesUpdatedAt = new Date().toISOString();
  } finally {
    refreshing = false;
    lastErrors = errors;
    // Deposits paying into an account in another currency wait for FX rates to settle.
    const settled = Calc.settleDeposits(state, todayISO(), Date.now());
    recordSnapshot();
    save();
    if (settled.length) queueSync();
    // Don't yank a form the user is filling in; the next tick re-renders.
    if (!dialog().open) render();
    else renderStatus();
    // Only when you tapped refresh; otherwise the status at the top (and Needs attention) says it.
    if (announce && errors.length) toast(`Some prices failed: ${errors.slice(0, 2).join('; ')}`, 'error');
    else if (announce) toast('Prices updated');
  }
}

// Total profit / loss of a section ('stocks' or 'crypto') in the base currency: what the holdings
// gained (value − cost) plus profit already taken by selling. Buying or selling doesn't move it.
function investProfit(sec) {
  return investProfitParts(sec).total;
}
// The same, split into what's still held (unrealised) and profit already taken by selling (realised).
function investProfitParts(sec) {
  const list = state[sec] || [];
  const ids = new Set(list.map((h) => h.id));
  let total = 0;
  for (const h of list) {
    const v = hv(h);
    // The diluted cost already includes some sale profit; that part isn't counted twice.
    total += (toBase(v.pnl, h.currency) || 0) - (toBase(v.realisedIn, h.currency) || 0);
  }
  let realised = 0;
  for (const t of state.trades || []) {
    if (t.realised == null || !(t.section === sec || ids.has(t.holdingId))) continue;
    realised += toBase(t.realised, t.currency) || 0;
  }
  return { total: total + realised, realised };
}

function recordSnapshot() {
  const s = Calc.summarize(state, todayISO());
  if (!s.assets && !s.liabilities) return;
  // The regular plan of the day is saved too, so Month by month can show each month as it was
  // (a raise or a cancelled subscription doesn't rewrite earlier months).
  const plan = { income: round2(s.incomeTotal), fixed: round2(s.split.bills + s.loanRepayments), cardFixed: round2(s.cardPaidBills) };
  // Each category's and item's value too, for the trend lines in the Assets card and side panel.
  const cats = { ...Object.fromEntries(Object.entries(s.totals).map(([k, v]) => [k, round2(v)])), debt: round2(s.liabilities), loans: round2(SECTIONS.liabilities.total(state.liabilities)) };
  const items = Calc.itemValues(state, todayISO());
  // Profit / loss of stocks and of crypto, for the charts on those pages.
  const pnl = { stocks: round2(investProfit('stocks')), crypto: round2(investProfit('crypto')) };
  state.history = Calc.upsertHistory(state.history, { date: todayISO(), netWorth: round2(s.netWorth), assets: round2(s.assets), liabilities: round2(s.liabilities), currency: base(), ...plan, cats, items, pnl, t: Date.now() }, HISTORY_MAX);
  // Item values are only kept for the last 400 days, so the saved history stays small.
  const keepItems = Calc.toISO(Calc.addDays(new Date(), -400));
  for (const h of state.history) if (h.items && h.date < keepItems) delete h.items;
  // Demo history is stored as a share of today's net worth, so the chart joins up with
  // today's figure whatever prices and exchange rates have loaded.
  for (const h of state.history) {
    if (h.demo == null) continue;
    h.netWorth = round2(s.netWorth * h.demo);
    h.currency = base();
    h.liabilities = round2(s.liabilities);
    h.assets = round2(h.netWorth + s.liabilities);
    // Made-up category and item history: today's values with a gentle wave (stronger for shares).
    const day = Date.parse(h.date) / 864e5;
    // Loans were a little higher in the past (repayments bring them down).
    const ago = Math.max(0, (Date.parse(todayISO()) - Date.parse(h.date)) / 864e5);
    const owed = h.demo * (1 + ago * 0.0003);
    // The wave settles over the last ten days, so the lines meet today's real figures.
    const settle = Math.min(1, ago / 10);
    const wave = (key, amp) => { let seed = 0; for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) % 997; return h.demo * (1 + settle * (amp * Math.sin(day / 9 + seed) + amp * 0.4 * Math.sin(day / 2.7 + seed * 2))); };
    const amp = (k) => (k === 'stocks' || k === 'crypto' ? 0.05 : k === 'property' ? 0.01 : 0.004);
    h.cats = Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, round2(v * (k === 'debt' || k === 'loans' ? owed : wave(k, amp(k))))]));
    const kindOf = (id) => (state.stocks.some((x) => x.id === id) ? 'stocks' : state.crypto.some((x) => x.id === id) ? 'crypto' : state.properties.some((x) => x.id === id) ? 'property' : 'cash');
    h.items = Object.fromEntries(Object.entries(items).map(([id, v]) => [id, round2(v * (state.liabilities.some((x) => x.id === id) ? owed : wave(id, amp(kindOf(id)))))]));
    // Profit moved with the market: today's profit less what the value has gained since that day.
    h.pnl = { stocks: round2(pnl.stocks - (cats.stocks - h.cats.stocks)), crypto: round2(pnl.crypto - (cats.crypto - h.cats.crypto)) };
    // The demo's past plans are filled in once, then kept like real saved months.
    if (h.raise != null && h.income == null) Object.assign(h, plan, { income: round2(plan.income - h.raise) });
  }
}

// Ticks the "interest earned today" figure every second without a full re-render.
function tickLive() {
  const clock = $('#clock');
  if (clock) clock.textContent = clockText();
  const sideClock = $('#side-clock');
  if (sideClock) sideClock.textContent = clockText();
  if (!summary) return;
  const now = new Date();
  const frac = (now - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000;
  for (const el of [$('#live-interest'), $('#side-interest')]) if (el) el.textContent = money(summary.interestDaily * frac, base(), 2);
}

let priceTimer = null;
function schedule() {
  clearInterval(priceTimer);
  const sec = Math.max(15, +state.settings.refreshSec || 60);
  priceTimer = setInterval(() => { if (!document.hidden) refreshPrices(); }, sec * 1000);
}

// ================================================================== sync

let syncing = false;
let syncAgain = false;
let syncTimer = null;

function queueSync(delay = 1500) {
  if (!syncCfg.token || !sessionPass) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), delay);
}

function hasData() {
  return LIST_SECTIONS.some((k) => state[k].length);
}

function askFirstSync() {
  return new Promise((resolve) => {
    openSheet('Synced data found', `<p>Your GitHub already has MoneyMonkey data, and this device has data too. What should happen?</p>
      <div class="choice-list">
        <button class="choice" data-choice="replace"><strong>Use the synced data</strong><span class="sub">Replace what’s on this device. Best for a new phone or laptop.</span></button>
        <button class="choice" data-choice="merge"><strong>Combine both</strong><span class="sub">Keep items from both. Pick this if you’ve entered different things on each device.</span></button>
      </div>`, (e) => {
      const b = e.target.closest('[data-choice]');
      if (!b) return;
      resolve(b.dataset.choice);
      dialog().close();
    });
    dialog().addEventListener('close', () => resolve('cancel'), { once: true });
  });
}

async function syncNow({ firstConnect = false, manual = false } = {}) {
  if (!syncCfg.token || !sessionPass) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  renderSyncStatus();
  try {
    const token = syncCfg.token;
    let gist = null;
    if (syncCfg.gistId) {
      try { gist = await Sync.getGist(token, syncCfg.gistId); } catch (e) { if (e.status !== 404) throw e; }
    }
    if (!gist) gist = await Sync.findGist(token);

    const t = todayISO();
    const local = Sync.toSyncable(state, t);
    let remote = null;
    let salt;
    if (gist) {
      const env = await Sync.readEnvelope(gist);
      if (env) { remote = await Sync.decrypt(env, sessionPass); salt = env.kdf.salt; }
    }

    let merged = local;
    if (remote) {
      let choice = 'merge';
      if (firstConnect) choice = hasData() ? await askFirstSync() : 'replace';
      if (choice === 'cancel') { syncCfg.lastError = 'First sync cancelled — tap Sync now to choose again.'; return; }
      merged = choice === 'replace' ? remote : Sync.mergeSyncable(local, remote);
    }

    const oldBase = base();
    const changedLocally = Sync.canonical(merged) !== Sync.canonical(local);
    state = normalize(Sync.applySyncable(state, merged, t));
    if (Calc.settleDeposits(state, t, Date.now()).length) merged = Sync.toSyncable(state, t);

    if (!remote || Sync.canonical(merged) !== Sync.canonical(remote)) {
      const env = await Sync.encrypt(merged, sessionPass, salt);
      gist = gist ? await Sync.updateGist(token, gist.id, env) : await Sync.createGist(token, env);
    }
    syncCfg.gistId = gist.id;
    syncCfg.lastSync = new Date().toISOString();
    syncCfg.lastError = null;
    recordSnapshot();
    save();
    if (changedLocally) {
      fillDatalists();
      schedule();
      if (!dialog().open) render();
      if (base() !== oldBase) refreshPrices({ force: true });
      else if (state.stocks.some((s) => s.lastPrice == null) || state.crypto.some((c) => c.lastPrice == null)) refreshPrices();
    }
    if (manual) toast(firstConnect ? 'Sync is set up' : 'Synced');
  } catch (e) {
    syncCfg.lastError = e.message;
    if (e.code === 'BAD_PASSPHRASE') {
      sessionPass = '';
      delete syncCfg.passphrase;
    }
    if (manual || e.code === 'BAD_PASSPHRASE') toast(`Sync: ${e.message}`, 'error');
  } finally {
    syncing = false;
    saveSyncCfg();
    if (currentView === 'settings' && !dialog().open) render();
    else renderStatus();
    if (syncAgain) { syncAgain = false; queueSync(500); }
  }
}

function setupSync() {
  openForm({
    title: 'Set up sync',
    intro: 'Use the same passphrase on every device. It never leaves your devices — if you lose it, the synced copy can’t be recovered.',
    fields: [
      { key: 'token', label: 'GitHub token (gist permission only)', type: 'password', required: true, autocomplete: 'off', help: '<a href="https://github.com/settings/tokens/new?scopes=gist&description=MoneyMonkey%20sync" target="_blank" rel="noopener">Create one here</a> — only “gist” ticked.', span: true },
      { key: 'passphrase', label: 'Passphrase', type: 'password', required: true, autocomplete: 'new-password' },
      { key: 'confirm', label: 'Repeat passphrase', type: 'password', required: true, autocomplete: 'new-password' },
      { key: 'remember', label: 'Remember the passphrase on this device', type: 'checkbox', default: () => true, span: true },
    ],
    validate: (v) => {
      if (v.passphrase !== v.confirm) return 'The passphrases don’t match.';
      if (v.passphrase.length < 8) return 'Use at least 8 characters — a few random words works well.';
      return null;
    },
    submitLabel: 'Connect',
    onSave: (v) => {
      syncCfg = { token: v.token.trim(), remember: v.remember, passphrase: v.passphrase };
      sessionPass = v.passphrase;
      saveSyncCfg();
      setTimeout(() => syncNow({ firstConnect: true, manual: true }), 0);
    },
  });
}

function unlockSync() {
  openForm({
    title: 'Unlock sync',
    fields: [
      { key: 'passphrase', label: 'Passphrase', type: 'password', required: true, autocomplete: 'current-password' },
      { key: 'remember', label: 'Remember on this device', type: 'checkbox', default: () => !!syncCfg.remember },
    ],
    submitLabel: 'Unlock',
    onSave: (v) => {
      sessionPass = v.passphrase;
      syncCfg.remember = v.remember;
      syncCfg.passphrase = v.passphrase;
      syncCfg.lastError = null;
      saveSyncCfg();
      setTimeout(() => syncNow({ manual: true }), 0);
    },
  });
}

function disconnectSync() {
  if (!confirm('Disconnect sync on this device? Your data stays here and in the gist; this device just stops syncing.')) return;
  syncCfg = {};
  sessionPass = '';
  try { localStorage.removeItem(SYNC_KEY); } catch (e) { /* ignore */ }
  render();
  toast('Sync disconnected on this device');
}
