/*
 * MoneyMonkey — UI, state, live prices and sync.
 * Data lives in this browser's localStorage and, if sync is set up, in an encrypted secret
 * GitHub Gist. Price APIs only ever see ticker symbols / coin ids / your base currency.
 */
// The js/app/*.js files are loaded in order as plain scripts and share one scope (see index.html).
'use strict';


const { Calc, Charts, Prices, Sync } = window;
const STORE_KEY = 'moneymonkey.v1';
const SYNC_KEY = 'moneymonkey.sync';
const PROMPT_KEY = 'moneymonkey.prompted'; // last day the confirm / check-in box popped up on this device
const HISTORY_MAX = 3650;
const FX_MAX_AGE_MS = 60 * 60 * 1000;
const SYNC_INTERVAL_MS = 2 * 60 * 1000;
const LIST_SECTIONS = ['accounts', 'stocks', 'crypto', 'deposits', 'properties', 'others', 'liabilities', 'cashflows', 'spending', 'cards', 'goals'];
const PLATFORM_SECTIONS = ['accounts', 'stocks', 'crypto', 'deposits', 'properties', 'others', 'liabilities'];

const todayISO = () => Calc.toISO(new Date());
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, el = document) => el.querySelector(sel);
const round2 = (v) => Math.round(v * 100) / 100;

// ===================================================================== state

function defaultState() {
  return {
    version: 2,
    settings: { baseCurrency: 'USD', finnhubKey: '', refreshSec: 60, theme: 'auto', privacy: false, checkinDay: 1 },
    settingsMt: 0,
    accounts: [], stocks: [], crypto: [], deposits: [], properties: [], others: [], liabilities: [], cashflows: [], spending: [], cards: [], goals: [],
    activity: [],
    platformMeta: {},
    deleted: {},
    history: [],
    fx: { base: 'USD', rates: { USD: 1 }, updatedAt: null },
    pricesUpdatedAt: null,
  };
}

function normalize(raw) {
  const d = defaultState();
  const s = { ...d, ...(raw || {}) };
  s.settings = { ...d.settings, ...(raw && raw.settings) };
  for (const k of [...LIST_SECTIONS, 'activity', 'history', 'trades']) if (!Array.isArray(s[k])) s[k] = [];
  for (const k of ['platformMeta', 'deleted']) if (!s[k] || typeof s[k] !== 'object') s[k] = {};
  if (!s.fx || !s.fx.rates) s.fx = d.fx;
  Calc.migratePlatforms(s);
  Calc.migrateAccounts(s);
  Calc.linkDeposits(s);
  Calc.linkCards(s);
  s.version = 2;
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch (e) {
    return defaultState();
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save — browser storage is unavailable or full. Export a backup in Settings.', 'error');
  }
}

let state = load();

// Sync credentials are kept apart from the data so they never end up in backups or in the gist.
function loadSyncCfg() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; }
}
function saveSyncCfg() {
  const toStore = { ...syncCfg };
  if (!toStore.remember) delete toStore.passphrase;
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(toStore)); } catch (e) { /* storage unavailable */ }
}
let syncCfg = loadSyncCfg();
let sessionPass = syncCfg.passphrase || '';

// ================================================================ formatting

const base = () => state.settings.baseCurrency;
const hidden = () => state.settings.privacy;

function money(v, cur = base(), dp = 2) {
  if (hidden()) return '••••••';
  if (v == null || !isFinite(v)) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, minimumFractionDigits: dp, maximumFractionDigits: dp }).format(v);
  } catch (e) {
    return `${cur} ${(+v).toFixed(dp)}`;
  }
}

function signed(v, cur = base(), dp = 2) {
  if (hidden()) return '<span>••••••</span>';
  if (!isFinite(v)) return '—';
  const cls = v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : '';
  const arrow = v > 0.005 ? '▲ ' : v < -0.005 ? '▼ ' : '';
  return `<span class="${cls}">${arrow}${money(Math.abs(v), cur, dp)}</span>`;
}

function pct(v, withSign = true) {
  if (v == null || !isFinite(v)) return '—';
  const s = (v * 100).toFixed(2) + '%';
  if (!withSign) return s;
  const cls = v > 0.00005 ? 'pos' : v < -0.00005 ? 'neg' : '';
  return `<span class="${cls}">${v > 0 ? '+' : ''}${s}</span>`;
}

// Phone number pads have no minus key: a ± button next to fields that can be negative flips the sign.
const pmWrap = (input) => `<span class="pm-wrap">${input}<button type="button" class="btn pm" data-pm aria-label="Switch between positive and negative" title="Positive / negative">±</button></span>`;
const COST_METHODS = [['average', 'Average cost'], ['diluted', 'Diluted — like Futu / moomoo']];
// A holding's own choice, or "use the setting" (shows which one that is).
const COST_METHODS_FIELD = () => [{ value: '', label: `Use the setting (${labelOf(opt(COST_METHODS), state.settings.costMethod || 'average')})` }, ...opt(COST_METHODS)];
// A holding's value and profit, with its cost shown by the chosen cost method (average / diluted).
const hv = (h) => Calc.holdingView(state, h);
const num = (v, dp = 4) => (v == null || !isFinite(v) ? '—' : (+v).toLocaleString(undefined, { maximumFractionDigits: dp }));
const toBase = (amt, cur) => {
  const v = Calc.convert(+amt || 0, cur || base(), base(), state.fx);
  return isFinite(v) ? v : NaN;
};
const fmtDate = (iso) => {
  const d = Calc.parseDate(iso);
  return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
};
const ago = (iso) => {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const opt = (pairs) => pairs.map(([value, label]) => ({ value, label }));
const labelOf = (options, v) => (options.find((o) => o.value === v) || {}).label || v || '';
const lastMonth = () => Calc.toISO(Calc.addMonths(new Date(), -1)).slice(0, 7);
const fmtMonth = (ym) => {
  const d = Calc.parseDate(`${ym}-01`);
  return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : ym;
};
// Amount column for a group of bars, as wide as its longest amount, so every row lines up
// (keeping bar lengths comparable) and long numbers never spill out of the card.
const barValueWidth = (texts) => `--val-w:${Math.max(6, ...texts.map((t) => String(t).replace(/<[^>]*>/g, '').length)) + 2}ch`;
const icon = (name, cls) => Icons.svg(name, cls);
const plural = (n, word, many) => `${n} ${n === 1 ? word : many || `${word}s`}`;

// "12 months", "3 months 5 days", "45 days"
function termText(v) {
  const m = v.termMonths;
  const rest = Calc.daysBetween(Calc.toISO(Calc.addMonths(Calc.parseDate(v.startDate), m)), v.maturityDate);
  if (!m) return plural(v.termDays, 'day');
  return rest > 0 ? `${plural(m, 'month')} ${plural(rest, 'day')}` : plural(m, 'month');
}

// ============================================================ field options

const FREQ = opt([['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['semiannually', 'Every 6 months'], ['yearly', 'Yearly'], ['once', 'One-off']]);
const COMPOUNDING = opt([['simple', 'Simple / paid at maturity'], ['monthly', 'Compounded monthly'], ['quarterly', 'Compounded quarterly'], ['semiannually', 'Compounded semi-annually'], ['annually', 'Compounded annually']]);
const FLOW_KINDS = opt([['income', 'Income'], ['expense', 'Expense'], ['subscription', 'Subscription'], ['saving', 'Saving / investing'], ['transfer', 'Transfer between my accounts']]);
const ACCOUNT_TYPES = opt([['savings', 'Savings'], ['saver', 'Saver (earns interest)'], ['current', 'Current / checking'], ['brokerage', 'Brokerage cash (uninvested)'], ['ewallet', 'E-wallet'], ['cash', 'Cash on hand'], ['moneymarket', 'Money market'], ['other', 'Other']]);
const OTHER_CATS = opt([['vehicle', 'Vehicle'], ['gold', 'Gold / precious metals'], ['retirement', 'Retirement / pension (MPF, SIPP…)'], ['insurance', 'Insurance cash value'], ['business', 'Business stake'], ['receivable', 'Money owed to me'], ['collectible', 'Collectibles'], ['other', 'Other']]);
const LOAN_TYPES = opt([['mortgage', 'Mortgage'], ['car', 'Car loan'], ['personal', 'Personal loan'], ['credit', 'Credit card'], ['student', 'Student loan'], ['other', 'Other']]);
const ON_MATURITY = opt([['cash', 'Move capital + interest to cash'], ['renew', 'Renew automatically (same term & rate)'], ['keep', 'Do nothing — I’ll update it myself']]);
const EVENT_LABELS = { transfer: 'Transfer', income: 'Income', expense: 'Expense', subscription: 'Subscription', saving: 'Saving', deposit: 'Deposit', property: 'Property', card: 'Card bill', saver: 'Saver' };
const CATEGORY_COLORS = { cash: 'var(--series-1)', stocks: 'var(--series-2)', crypto: 'var(--series-3)', deposits: 'var(--series-4)', property: 'var(--series-5)', other: 'var(--series-6)' };
const CATEGORY_LABELS = { cash: 'Cash & bank', stocks: 'Stocks & ETFs', crypto: 'Crypto', deposits: 'Fixed deposits', property: 'Property', other: 'Other assets' };
const CATEGORY_VIEW = { cash: 'accounts', stocks: 'stocks', crypto: 'crypto', deposits: 'deposits', property: 'properties', other: 'others' };
const PLATFORM_SUGGESTIONS = [
  'HSBC HK', 'Hang Seng Bank', 'Bank of China (HK)', 'Standard Chartered HK', 'ZA Bank', 'Mox', 'Futu / moomoo', 'Interactive Brokers', 'Tiger Brokers', 'MPF',
  'HSBC UK', 'Barclays', 'Lloyds', 'NatWest', 'Monzo', 'Starling', 'Chase UK', 'Revolut', 'Wise', 'Trading 212', 'Hargreaves Lansdown', 'Vanguard UK', 'AJ Bell', 'Freetrade', 'NS&I Premium Bonds',
];
const REGION_SUGGESTIONS = ['Hong Kong', 'United Kingdom', 'United States', 'Singapore', 'Mainland China', 'Eurozone', 'Japan', 'Australia', 'Canada', 'Taiwan', 'Malaysia', 'Global'];

const currencyField = { key: 'currency', label: 'Currency', type: 'currency', default: () => base() };
const platformField = (label, placeholder, extra = {}) => ({ key: 'platform', label, list: 'platform-list', placeholder, ...extra });
// NaN when a non-zero balance has no exchange rate yet, so we never show a misleading total.
const accountTotal = (a) => Calc.accountBalances(a).reduce((t, b) => { const v = Calc.balanceValue(b, todayISO()).value; return t + (v ? toBase(v, b.currency) : 0); }, 0);
const accountDeposits = (a) => state.deposits.filter((d) => d.accountId === a.id);
const depositsTotal = (deps) => deps.reduce((t, d) => t + (toBase(Calc.depositValue(d, todayISO()).value, d.currency) || 0), 0);
const accountName = (id) => (state.accounts.find((a) => a.id === id) || {}).name || '';
const cardById = (id) => state.cards.find((c) => c.id === id);
const accountOptions = () => state.accounts.map((a) => ({ value: a.id, label: `${a.name}${a.platform ? ` · ${a.platform}` : ''}` }));
// "due 25 Nov", "paid ✓", "overdue since 25 Oct" for a card statement
function billStatus(e) {
  if (e.paidOn) return 'paid ✓';
  if (!e.dueDate) return '';
  return e.dueDate < todayISO() ? `<span class="warn-text">overdue since ${fmtDate(e.dueDate)}</span>` : `due ${fmtDate(e.dueDate)}`;
}
const currenciesWord = (n) => `${n} ${n === 1 ? 'currency' : 'currencies'}`;
const balanceList = (a) => `<div class="bal-list">${Calc.accountBalances(a).map((b) => `<div><span class="cur-tag">${esc(b.currency)}</span> ${money(Calc.balanceValue(b, todayISO()).value, b.currency)}${+b.rate ? ` <span class="sub">${num(b.rate, 2)}%</span>` : ''}</div>`).join('')}</div>`;
const platformLine = (item, more = '') => [item.platform, more].filter(Boolean).map(esc).join(' · ');
