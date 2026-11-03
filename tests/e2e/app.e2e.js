'use strict';
// Browser tests: run the real app on demo data in a phone-sized Chromium.
//   npm run test:e2e
// Needs Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`).
// Prices and exchange rates are faked, so no network access is needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { /* skipped below */ }

const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const RATES = { HKD: 1, USD: 0.128, GBP: 0.099, EUR: 0.118 };

let server, base, browser;

test.before(async () => {
  if (!chromium) return;
  server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

// A fresh page with the demo loaded. The daily pop-ups are suppressed unless `prompts`.
async function demo({ prompts = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, serviceWorkers: 'block' });
  if (!prompts) await ctx.addInitScript(() => { try { localStorage.setItem('moneymonkey.prompted', new Date().toISOString().slice(0, 10)); } catch (e) { /* ignore */ } });
  await ctx.route('https://open.er-api.com/**', (r) => r.fulfill({ json: { result: 'success', rates: RATES }, headers: { 'access-control-allow-origin': '*' } }));
  await ctx.route('https://api.coingecko.com/**', (r) => r.fulfill({ json: { bitcoin: { usd: 68000, usd_24h_change: 1.2 } }, headers: { 'access-control-allow-origin': '*' } }));
  await ctx.route('https://api.frankfurter.app/**', (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(base);
  await page.click('text=Try demo data');
  await page.waitForTimeout(1200);
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('moneymonkey.v1')));
  const balance = async (name, cur) => (await state()).accounts.find((a) => a.name === name).balances.find((b) => b.currency === cur).amount;
  const go = async (hash) => { await page.goto(base + hash); await page.waitForTimeout(400); };
  return { page, ctx, errors, state, balance, go };
}

const skip = () => !chromium && 'Playwright is not installed';

test('every page renders and every tappable box opens something', { skip: skip() }, async () => {
  const { page, ctx, errors, state, go } = await demo();
  const s = await state();
  for (const v of ['dashboard', 'platforms', 'accounts', 'stocks', 'crypto', 'deposits', 'properties', 'others', 'liabilities', 'cashflows', 'goals', 'reports', 'settings',
    `account/${s.accounts[0].id}`, `card/${s.cards[0].id}`, 'platform/Futu', 'region/Hong%20Kong']) {
    await go(`#${v}`);
    assert.ok((await page.textContent('#main')).trim().length > 50, `${v} rendered`);
  }
  for (const v of ['dashboard', 'cashflows', 'stocks', 'crypto', 'deposits']) {
    await go(`#${v}`);
    const n = await page.$$eval('.tiles .tile.clickable', (e) => e.length);
    for (let i = 0; i < n; i++) {
      await (await page.$$('.tiles .tile.clickable'))[i].click();
      await page.waitForTimeout(150);
      const opened = (await page.$eval('dialog', (d) => d.open)) || !page.url().endsWith(`#${v}`);
      assert.ok(opened, `${v} box ${i} opens`);
      if (await page.$eval('dialog', (d) => d.open)) await page.click('dialog [data-close]');
      else await go(`#${v}`);
    }
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('check-in opens first, marks due payments done without changing balances, and Undo refills it', { skip: skip() }, async () => {
  const { page, ctx, errors, state, balance } = await demo({ prompts: true });
  // Pop-ups show once a day: forget that it already showed, then open the app again.
  await page.evaluate(() => { localStorage.removeItem('moneymonkey.prompted'); });
  await page.reload();
  await page.waitForTimeout(2000);
  assert.match(await page.textContent('dialog h2'), /Monthly check-in/i);
  assert.ok((await page.$$('.ci-pay')).length >= 4);
  const hk = await balance('HSBC One', 'HKD');
  await page.uncheck('.ci-pay:has-text("Salary") input');
  await page.fill('.ci-x-name', 'Tax refund');
  await page.fill('.ci-x-amt', '5000');
  await page.click('[data-ci=save]');
  await page.waitForTimeout(400);
  let s = await state();
  assert.equal(await balance('HSBC One', 'HKD'), hk);
  assert.ok(s.cashflows.some((c) => c.name === 'Tax refund' && c.frequency === 'once'));
  assert.ok(s.deposits.find((d) => d.kind === 'regular').paid);
  await page.click('#toasts .toast-undo button');
  await page.waitForTimeout(500);
  s = await state();
  assert.ok(!s.cashflows.some((c) => c.name === 'Tax refund'));
  assert.equal(await page.inputValue('.ci-x-name'), 'Tax refund');
  assert.equal(await page.isChecked('.ci-pay:has-text("Salary") input'), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('payments: change account, deduct, and undo', { skip: skip() }, async () => {
  const { page, ctx, errors, state, balance } = await demo();
  const s = await state();
  const za = s.accounts.find((a) => a.name === 'Savings');
  await page.click('[data-action=attention]');
  await page.click('dialog a[data-action=review-payments]');
  await page.waitForTimeout(300);
  const before = await balance('Savings', 'HKD');
  await page.click('dialog .pay-item:has-text("Salary") [data-pay-change]');
  await page.selectOption('dialog .pay-item:has-text("Salary") .pay-acct', za.id);
  await page.waitForTimeout(200);
  await page.click('dialog .pay-item:has-text("Salary") [data-pay=apply]');
  await page.waitForTimeout(300);
  assert.equal(await balance('Savings', 'HKD'), before + 62000);
  const salary = (await state()).cashflows.find((c) => c.name === 'Salary');
  assert.equal(salary.accountId, s.accounts.find((a) => a.name === 'HSBC One').id, 'usual account unchanged');
  await page.click('dialog .toast-undo button');
  await page.waitForTimeout(300);
  assert.equal(await balance('Savings', 'HKD'), before);
  assert.ok(await page.$('dialog .pay-item:has-text("Salary")'), 'asked again');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('buy with a top-up, sell with realised profit, dividend and split', { skip: skip() }, async () => {
  const { page, ctx, errors, state, balance, go } = await demo();
  let s = await state();
  const aapl = s.stocks.find((h) => h.symbol === 'AAPL');
  const vusa = s.stocks.find((h) => h.symbol === 'VUSA.L');
  const tc = s.stocks.find((h) => h.symbol === '0700.HK');
  await go('#stocks');
  await page.click(`[data-action=trade-sell][data-id="${aapl.id}"]`);
  await page.fill('[name=quantity]', '5');
  await page.fill('[name=price]', '700');
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(300);
  s = await state();
  assert.equal(s.stocks.find((h) => h.id === aapl.id).avgCost, aapl.avgCost);
  assert.equal(s.trades[0].realised, 5 * (700 - aapl.avgCost));
  await page.click(`[data-action=trade-buy][data-id="${vusa.id}"]`);
  await page.fill('[name=quantity]', '10');
  await page.fill('[name=price]', '90');
  await page.selectOption('[name=topUpFrom]', s.accounts.find((a) => a.name === 'Current account').id);
  await page.waitForTimeout(150);
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(300);
  assert.equal(await balance('Trading 212 cash', 'GBP'), 0);
  await page.click(`[data-action=trade-more][data-id="${tc.id}"]`);
  await page.fill('[name=amount]', '680');
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(300);
  assert.equal(await balance('Futu cash', 'HKD'), 15680);
  await page.click(`[data-action=trade-more][data-id="${tc.id}"]`);
  await page.selectOption('[name=side]', 'split');
  await page.fill('[name=ratio]', '2');
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(300);
  const after = (await state()).stocks.find((h) => h.id === tc.id);
  assert.deepEqual([after.quantity, after.avgCost], [tc.quantity * 2, tc.avgCost / 2]);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a regular transfer moves money out of one account and into another', { skip: skip() }, async () => {
  const { page, ctx, errors, state, balance, go } = await demo();
  const s = await state();
  await go('#cashflows');
  await page.click('.page-head [data-action=add][data-sec=cashflows]:not([data-once])');
  await page.fill('[name=name]', 'Top up T212');
  await page.selectOption('[name=kind]', 'transfer');
  await page.fill('[name=amount]', '500');
  await page.fill('[name=currency]', 'GBP');
  await page.selectOption('[name=accountId]', s.accounts.find((a) => a.name === 'Current account').id);
  await page.waitForTimeout(150);
  await page.selectOption('[name=toAccountId]', s.accounts.find((a) => a.name === 'Trading 212 cash').id);
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(300);
  // Make it due today, then confirm it.
  await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('moneymonkey.v1')); const c = st.cashflows.find((x) => x.name === 'Top up T212'); c.nextDate = c.trackFrom; localStorage.setItem('moneymonkey.v1', JSON.stringify(st)); });
  await go('#dashboard');
  await page.reload();
  await page.waitForTimeout(800);
  const monzo = await balance('Current account', 'GBP');
  const t212 = await balance('Trading 212 cash', 'GBP');
  await page.click('[data-action=attention]');
  await page.click('dialog a[data-action=review-payments]');
  await page.click('dialog .pay-item:has-text("Top up T212") [data-pay=apply]');
  await page.waitForTimeout(300);
  assert.equal(await balance('Current account', 'GBP'), monzo - 500);
  assert.equal(await balance('Trading 212 cash', 'GBP'), t212 + 500);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('month by month keeps past months when a bill changes; search; reports export', { skip: skip() }, async () => {
  const { page, ctx, errors, state, go } = await demo();
  await go('#cashflows');
  await page.click('[data-action=month-range][data-range="6"]');
  const rows = () => page.$$eval('.hist-row', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join('|'));
  const before = await rows();
  const rent = (await state()).cashflows.find((c) => c.name === 'Rent (HK)');
  await page.click('[data-tab=items]');
  await page.click(`.flow-lines [data-id="${rent.id}"]`);
  await page.fill('[name=amount]', '20000');
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(300);
  await page.click('[data-tab=overview]');
  await page.click('[data-action=month-range][data-range="6"]');
  assert.equal(await rows(), before);
  await page.click('[data-action=search]');
  await page.fill('.search-input', 'netflix');
  assert.equal((await page.$$('.search-results .ex-row')).length, 1);
  await page.click('dialog [data-close]');
  await go('#reports');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export-report][data-what=year]')]);
  assert.match(dl.suggestedFilename(), /^moneymonkey-report-\d{4}\.csv$/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('layout: reorder with arrows and drag, hide, pin to Home, reset', { skip: skip() }, async () => {
  const { page, ctx, errors, state, go } = await demo();
  const order = (sel) => page.$$eval(`${sel} > [data-box]`, (e) => e.filter((x) => !x.hidden).map((x) => x.dataset.box));
  await page.click('[data-lay=edit]');
  await page.click('[data-layout="tiles"] > [data-box="net-cash-flow-mo"] [data-lay=up]');
  assert.deepEqual((await order('[data-layout="tiles"]')).slice(0, 2), ['net-cash-flow-mo', 'investment-p-l']);
  assert.equal(await page.$eval('dialog', (d) => d.open), false, 'controls don’t open the box');
  // Drag the last box to the top (auto-scrolls).
  const h = await page.$('[data-layout="tiles"] > [data-box="subscriptions-mo"] [data-lay=drag]');
  await h.scrollIntoViewIfNeeded();
  const hb = await h.boundingBox();
  await page.mouse.move(hb.x + 10, hb.y + 10);
  await page.mouse.down();
  // Move up (the page scrolls near the edge) until the first box is on screen, then drop on it.
  const first = await page.$('[data-layout="tiles"] > [data-box]:not([data-box="subscriptions-mo"])');
  let top = null;
  for (let i = 1; i <= 80 && !top; i++) {
    await page.mouse.move(60, Math.max(20, hb.y - i * 20));
    await page.waitForTimeout(30);
    const b = await first.boundingBox();
    if (b && b.y > 90 && b.y < 600) top = b;
  }
  assert.ok(top, 'first box came into view while dragging');
  await page.mouse.move(60, 400); // away from the edge, so the page stops scrolling
  await page.waitForTimeout(100);
  if ((await order('[data-layout="tiles"]'))[0] !== 'subscriptions-mo') {
    top = await (await page.$('[data-layout="tiles"] > [data-box]')).boundingBox();
    await page.mouse.move(top.x + 30, top.y + 40, { steps: 3 });
  }
  await page.mouse.up();
  assert.equal((await order('[data-layout="tiles"]'))[0], 'subscriptions-mo');
  await page.click('[data-layout="tiles"] > [data-box="emergency-runway"] [data-lay=hide]');
  await page.click('[data-lay=done]');
  assert.ok(!(await order('[data-layout="tiles"]')).includes('emergency-runway'));
  // Pin a Stocks box to Home.
  await go('#stocks');
  await page.click('[data-lay=edit]');
  await page.click('[data-layout="tiles"] > [data-box="profit-loss"] [data-lay=pin]');
  await page.click('[data-lay=done]');
  await go('#dashboard');
  assert.deepEqual(await order('[data-layout="pinned"]'), ['stocks|profit-loss']);
  const saved = (await state()).settings.layout;
  assert.equal(saved.pages['dashboard:tiles'].order[0], 'subscriptions-mo');
  // Reset puts Home back and unpins.
  await page.click('[data-lay=edit]');
  await page.click('[data-lay=reset]');
  assert.equal((await order('[data-layout="tiles"]'))[0], 'investment-p-l');
  assert.equal(await page.$$eval('[data-layout="pinned"]', (e) => e.length), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('layout: accounts and holdings can be reordered and pinned to Home', { skip: skip() }, async () => {
  const { page, ctx, errors, go } = await demo();
  const rows = (k) => page.$$eval(`[data-layout="list-${k}"] > tr`, (e) => e.map((x) => x.dataset.name));
  await go('#accounts');
  const before = await rows('accounts');
  await page.click('[data-lay=edit]');
  await page.click('[data-layout="list-accounts"] > tr:nth-child(3) [data-lay=up]');
  await page.click('[data-layout="list-accounts"] > tr:nth-child(1) [data-lay=pin]');
  await page.click('[data-lay=done]');
  await page.reload();
  await page.waitForTimeout(600);
  assert.deepEqual((await rows('accounts')).slice(0, 3), [before[0], before[2], before[1]]);
  await go('#dashboard');
  const pinned = await page.$$eval('[data-layout="pinned"] > [data-box]', (e) => e.map((x) => x.dataset.box));
  assert.equal(pinned.length, 1);
  assert.match(pinned[0], /^item\|accounts\|/);
  await page.click('[data-layout="pinned"] > [data-box]');
  await page.waitForTimeout(300);
  assert.match(page.url(), /#account\//);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('lists sort by a column: high to low, low to high, then back to your own order', { skip: skip() }, async () => {
  const { page, ctx, errors, go } = await demo();
  const names = () => page.$$eval('[data-layout="list-stocks"] > tr', (r) => r.map((x) => x.dataset.name));
  await go('#stocks');
  const own = await names();
  // Phone: the Sort menu. Market value is compared in one currency (HK$91,000 > £5,304 > $4,125).
  const mv = await page.$$eval('[data-sort-menu="stocks"] option', (o) => o.find((x) => /market value: high/i.test(x.textContent)).value);
  await page.selectOption('[data-sort-menu="stocks"]', mv);
  await page.waitForTimeout(200);
  const order = async () => (await names()).map((n) => (/0700|tencent/i.test(n) ? 'tencent' : /vusa|vanguard/i.test(n) ? 'vanguard' : /aapl|apple/i.test(n) ? 'apple' : n));
  assert.deepEqual(await order(), ['tencent', 'vanguard', 'apple']);
  await page.selectOption('[data-sort-menu="stocks"]', mv.replace('desc', 'asc'));
  await page.waitForTimeout(200);
  assert.deepEqual(await order(), ['apple', 'vanguard', 'tencent']);
  await page.selectOption('[data-sort-menu="stocks"]', '');
  await page.waitForTimeout(200);
  assert.deepEqual(await names(), own);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('cash-flow items: a later start isn’t counted yet, the end reminder extends, End now and Restart', { skip: skip() }, async () => {
  const { page, ctx, errors, state, go } = await demo();
  const income = () => page.evaluate(() => summary.flow.income);
  const before = await income();
  const today = await page.evaluate(() => todayISO());
  // The demo's tutoring income starts next month: not in this month's income.
  const s0 = await state();
  const tutor = s0.cashflows.find((c) => c.name === 'Tutoring income');
  assert.ok(tutor.startDate > today);
  // Starting it today adds it.
  await page.evaluate((id) => updateCashflow(id, { startDate: todayISO(), nextDate: todayISO() }), tutor.id);
  assert.ok(Math.abs((await income()) - before - 4000) < 1);
  // Spotify ends within a week: Needs attention asks; extend by a year.
  await go('#dashboard');
  await page.click('[data-action="attention"]');
  await page.click('dialog [data-action="extend-cf"]');
  await page.click('dialog [data-ext="12"]');
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(200);
  const spotify = (await state()).cashflows.find((c) => c.name === 'Spotify');
  assert.ok(spotify.endDate > await page.evaluate(() => Calc.toISO(Calc.addDays(new Date(), 300))), 'extended about a year');
  // End now keeps it under Ended; Restart brings it back with no end.
  await page.evaluate((id) => endCashflow(id), spotify.id);
  await go('#cashflows');
  await page.click('[data-tab="items"]');
  await page.evaluate(() => document.querySelectorAll('details.flow-group').forEach((d) => { d.open = true; }));
  const s1 = await state();
  assert.equal(s1.cashflows.find((c) => c.id === spotify.id).endDate, today);
  await page.click('[data-action="restart-cf"]'); // Disney+ (ended in the demo)
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(200);
  const disney = (await state()).cashflows.find((c) => c.name === 'Disney+');
  assert.ok(!disney.endDate && disney.startDate === today);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('rent entered on a property is one Cash Flow item, with its start date, edited from either page', { skip: skip() }, async () => {
  const { page, ctx, errors, state, go } = await demo();
  const nextMonth = await page.evaluate(() => Calc.toISO(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)));
  await go('#properties');
  await page.evaluate(() => editItem('properties', null));
  await page.fill('dialog [name=name]', 'Studio');
  await page.fill('dialog [name=currency]', 'HKD');
  await page.fill('dialog [name=currentValue]', '3000000');
  await page.fill('dialog [name=monthlyRent]', '12000');
  await page.dispatchEvent('dialog form', 'change');
  assert.equal(await page.isVisible('dialog [name=rentStart]'), true, 'rent fields appear once there is rent');
  await page.fill('dialog [name=rentStart]', nextMonth);
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(200);
  let s = await state();
  const studio = s.properties.find((p) => p.name === 'Studio');
  const item = s.cashflows.find((c) => c.propertyId === studio.id);
  assert.ok(item && item.kind === 'income' && item.amount === 12000 && item.startDate === nextMonth, 'one linked income item with the start date');
  // Not counted this month.
  assert.equal(await page.evaluate((id) => rentThisMonth(state.properties.find((p) => p.id === id)), studio.id), 0);
  // Edit the item on Cash Flow: the property shows the new rent.
  await page.evaluate((id) => editItem('cashflows', id), item.id);
  await page.fill('dialog [name=amount]', '12500');
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(200);
  s = await state();
  assert.equal(s.properties.find((p) => p.id === studio.id).monthlyRent, 12500);
  // Clearing the rent on the property ends the item (kept under Ended).
  await page.evaluate((id) => editItem('properties', id), studio.id);
  await page.fill('dialog [name=monthlyRent]', '');
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(200);
  s = await state();
  assert.ok(s.cashflows.find((c) => c.id === item.id).endDate, 'rent item ended, not deleted');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('target mix on Goals: must add up to 100%, then shows gaps and suggested moves', { skip: skip() }, async () => {
  const { page, ctx, errors, state, go } = await demo();
  await go('#goals');
  await page.click('[data-action="target-mix"]');
  for (const [k, v] of [['cash', 15], ['stocks', 45], ['crypto', 10], ['deposits', 20], ['other', 5]]) await page.fill(`dialog [name=t_${k}]`, String(v));
  await page.click('dialog button[type=submit]');
  assert.match(await page.textContent('dialog .form-error'), /100%/);
  await page.fill('dialog [name=t_other]', '10');
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(200);
  const s = await state();
  assert.deepEqual(s.settings.targetMix, { targets: { cash: 15, stocks: 45, crypto: 10, deposits: 20, other: 10 }, includeProperty: false, tolerance: 5 });
  assert.ok(await page.isVisible('.mix-card .mix-moves'), 'suggested moves shown');
  assert.match(await page.textContent('.mix-card'), /property not included/i);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('side panel on a laptop: pages other than Home keep their full width', { skip: skip() }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { localStorage.setItem('moneymonkey.prompted', new Date().toISOString().slice(0, 10)); localStorage.setItem('moneymonkey.side', '1'); });
  await ctx.route('https://open.er-api.com/**', (r) => r.fulfill({ json: { result: 'success', rates: RATES }, headers: { 'access-control-allow-origin': '*' } }));
  const page = await ctx.newPage();
  await page.goto(base);
  await page.click('text=Try demo data');
  await page.waitForTimeout(800);
  const width = async (hash) => { await page.goto(base + hash); await page.waitForTimeout(300); return (await (await page.$('#main')).boundingBox()).width; };
  assert.ok(await width('#accounts') > 1100, 'Cash & Bank uses the full width');
  assert.ok(await width('#stocks') > 1100, 'Stocks uses the full width');
  assert.equal(await page.$eval('#side', (e) => getComputedStyle(e).display), 'none');
  assert.ok(await width('#dashboard') > 800, 'Home shares the width with the panel');
  await ctx.close();
});

test('a stock’s currency is filled in from its ticker, with a warning and a badge when it doesn’t match', { skip: skip() }, async () => {
  const { page, ctx, errors, go } = await demo();
  await go('#stocks');
  await page.evaluate(() => editItem('stocks', null));
  await page.fill('dialog [name=symbol]', 'LLY');
  assert.equal(await page.inputValue('dialog [name=currency]'), 'USD', 'US ticker → USD');
  await page.fill('dialog [name=symbol]', '0700.HK');
  assert.equal(await page.inputValue('dialog [name=currency]'), 'HKD', 'follows the ticker until you pick one');
  await page.fill('dialog [name=symbol]', 'LLY');
  await page.fill('dialog [name=currency]', 'GBP');
  assert.match(await page.textContent('dialog .cur-warn'), /trades in USD/);
  await page.fill('dialog [name=quantity]', '1');
  await page.fill('dialog [name=avgCost]', '1052.20');
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(200);
  assert.ok(await page.isVisible('[data-layout="list-stocks"] tr:has-text("LLY") .badge.warn'), 'Check currency badge');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('selling everything keeps the sale in Trade History and the platform stays (locked)', { skip: skip() }, async () => {
  const { page, ctx, errors, go } = await demo();
  await go('#stocks');
  const id = await page.evaluate(() => { state.accounts = state.accounts.filter((a) => a.platform !== 'Trading 212'); commit(); return state.stocks.find((h) => h.symbol === 'VUSA.L').id; });
  await page.evaluate((x) => openTrade('stocks', x, 'sell'), id);
  await page.selectOption('dialog [name=accountId]', '');
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => state.stocks.some((h) => h.symbol === 'VUSA.L')), false, 'holding removed');
  await page.click('a[href="#history/stocks"]');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('.trade-history'), /Sold 60 VUSA\.L[\s\S]*no longer held/);
  await page.selectOption('[data-trade-side="stocks"]', 'buy');
  assert.doesNotMatch(await page.textContent('.trade-history'), /Sold 60/);
  await go('#platforms');
  assert.ok(await page.isVisible('[data-layout="list-platforms"] tr:has-text("Trading 212")'), 'locked platform still listed');
  // Unlocking an empty platform lets it go.
  await page.click('[data-layout="list-platforms"] tr:has-text("Trading 212") [data-lock-platform]');
  await page.waitForTimeout(200);
  assert.equal(await page.isVisible('[data-layout="list-platforms"] tr:has-text("Trading 212")'), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a past month opens with what it included, and a wrong amount can be corrected from that month', { skip: skip() }, async () => {
  const { page, ctx, errors, go } = await demo();
  await go('#cashflows');
  const month = await page.$eval('[data-action="month-detail"]', (r) => r.dataset.month);
  await page.click(`[data-action="month-detail"][data-month="${month}"]`);
  assert.match(await page.textContent('.month-card'), /Income[\s\S]*Rent \(HK\)/);
  const before = await page.evaluate((m) => monthFigures().find((x) => x.month === m).fixed, month);
  await page.evaluate(() => editItem('cashflows', state.cashflows.find((c) => c.name === 'Rent (HK)').id));
  await page.fill('dialog [name=amount]', '18500');
  await page.dispatchEvent('dialog form', 'change');
  await page.selectOption('dialog [name=fixFrom]', month);
  await page.dispatchEvent('dialog form', 'change');
  assert.match(await page.textContent('dialog .form-preview'), /Corrects/);
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(200);
  const after = await page.evaluate((m) => monthFigures().find((x) => x.month === m).fixed, month);
  assert.ok(Math.abs(after - before - 500) < 0.01, `fixed costs +500 (${before} → ${after})`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('one past month can be corrected on its own from its breakdown, and reset', { skip: skip() }, async () => {
  const { page, ctx, errors, go } = await demo();
  await go('#cashflows');
  const month = await page.$eval('[data-action="month-detail"]', (r) => r.dataset.month);
  const fig = () => page.evaluate((m) => monthFigures().find((x) => x.month === m).fixed, month);
  const others = () => page.evaluate((m) => monthFigures().filter((x) => x.month !== m).map((x) => x.fixed), month);
  const before = await fig();
  const othersBefore = await others();
  await page.click(`[data-action="month-detail"][data-month="${month}"]`);
  await page.click('.month-card [data-month-line]:has-text("Electricity")');
  await page.click('dialog [data-ml="one"]');
  await page.fill('dialog [name=amount]', '750');
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await fig()) - before - 150) < 0.01, 'only that month: +150');
  assert.deepEqual(await others(), othersBefore, 'other months unchanged');
  assert.match(await page.textContent('.month-card'), /corrected \(was/i);
  await page.click('.month-card [data-month-line]:has-text("Electricity")');
  await page.click('dialog [data-ml="reset"]');
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await fig()) - before) < 0.01, 'reset');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the Months tab: switch months, see the summary, the comparison and the year so far', { skip: skip() }, async () => {
  const { page, ctx, errors, go } = await demo();
  await go('#cashflows');
  await page.click('[data-tab="months"]');
  assert.ok(await page.isVisible('.month-card'));
  const first = await page.inputValue('[data-month-select]');
  await page.click('.m-switch [aria-label="Earlier month"]');
  const second = await page.inputValue('[data-month-select]');
  assert.ok(second < first, 'went back a month');
  assert.match(await page.textContent('#main'), /Compared with/);
  assert.match(await page.textContent('#main'), /so far/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Home: What changed adds up to the net worth change, and Goals shows the target mix', { skip: skip() }, async () => {
  const { page, ctx, errors, go } = await demo();
  await go('#dashboard');
  assert.ok(await page.isVisible('[data-box="changed"] .chg-row'));
  const ok = await page.evaluate(() => {
    const p = changePeriod('this');
    const r = Calc.changeBreakdown(p.start, p.end, {});
    return Math.abs(r.parts.reduce((t, x) => t + (x.value || 0), 0) - r.total) < 0.02;
  });
  assert.ok(ok, 'the causes add up to the total');
  await page.click('[data-changed="last"]');
  assert.match(await page.textContent('[data-box="changed"]'), /\(/);
  assert.equal(await page.isVisible('[data-box="goals"] .mix-home'), false);
  await page.evaluate(() => setTargetMix({ targets: { cash: 50, stocks: 50 }, includeProperty: false, tolerance: 5 }));
  await page.waitForTimeout(200);
  assert.ok(await page.isVisible('[data-box="goals"] .mix-home'), 'target mix on Home');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Home: the Liquid view leaves out property and its mortgage, and is remembered', { skip: skip() }, async () => {
  const { page, ctx, errors, go } = await demo();
  await go('#dashboard');
  const all = await page.evaluate(() => summary.netWorth);
  await page.click('[data-nw-view="liquid"]');
  const liquid = await page.evaluate(() => nwValueNow());
  const expected = await page.evaluate(() => {
    const v = Calc.itemValues(state, todayISO());
    const prop = state.properties.reduce((t, p) => t + v[p.id], 0) + state.others.reduce((t, o) => t + v[o.id], 0);
    const mort = state.liabilities.filter((l) => l.type === 'mortgage' || l.type === 'car').reduce((t, l) => t + v[l.id], 0);
    return summary.netWorth - prop + mort;
  });
  assert.ok(Math.abs(liquid - expected) < 0.05, `${liquid} vs ${expected}`);
  assert.notEqual(Math.round(liquid), Math.round(all));
  assert.match(await page.textContent('.nw-card'), /Liquid net worth/i);
  // What changed follows the switch and still shows its lines.
  assert.ok(await page.isVisible('[data-box="changed"] .chg-row'), 'What changed shows lines in Liquid');
  assert.match(await page.textContent('[data-box="changed"]'), /liquid net worth/i);
  await page.click('[data-changed="last"]');
  assert.ok(await page.isVisible('[data-box="changed"] .chg-row'), 'and for last month');
  await page.click('[data-changed="this"]');
  await page.reload();
  await page.waitForTimeout(800);
  assert.match(await page.textContent('.nw-card'), /Liquid net worth/i, 'remembered');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('data health check finds a wrong currency, rent counted twice and unconfirmed payments, and fixes the rent', { skip: skip() }, async () => {
  const { page, ctx, errors, go } = await demo();
  await page.evaluate(() => {
    state.stocks.push({ id: 'lly', symbol: 'LLY', platform: 'Trading 212', quantity: 1, avgCost: 1052.2, currency: 'GBP', source: 'live' });
    state.properties.push({ id: 'studio', name: 'Studio', currency: 'GBP', purchasePrice: 100000, monthlyRent: 1100, valuations: [], updateFrequency: 'monthly' });
    state.cashflows.push({ id: 'roomrent', name: 'Room rent', kind: 'income', category: 'Rent', amount: 1050, currency: 'GBP', frequency: 'monthly', nextDate: todayISO(), active: true });
    const c = state.cashflows.find((x) => x.name === 'Rent (HK)');
    c.trackFrom = Calc.toISO(Calc.addDays(new Date(), -100)); c.nextDate = c.trackFrom; delete c.lastHandled;
    commit();
  });
  await go('#health');
  const text = await page.textContent('#main');
  assert.match(text, /LLY: currency GBP, but it trades in USD/);
  assert.match(text, /Room rent.*may be counted twice/);
  assert.match(text, /Rent \(HK\).*payments not confirmed/);
  await page.click('[data-fix="link-rent"]');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => state.cashflows.find((c) => c.id === 'roomrent').propertyId), 'studio');
  assert.doesNotMatch(await page.textContent('#main'), /Room rent.*may be counted twice/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('5 years of heavy use: data stays well under the storage limit and every page draws', { skip: skip() }, async () => {
  const { page, ctx, errors, go } = await demo();
  const kb = await page.evaluate(() => {
    const t = new Date(); const day = (n) => Calc.toISO(Calc.addDays(t, n)); const rnd = (a, b) => a + Math.random() * (b - a);
    const cur = ['HKD', 'GBP', 'USD', 'EUR'];
    for (let i = 0; i < 40; i++) state.accounts.push({ id: 'a' + i, name: 'Account ' + i, platform: 'P' + (i % 10), type: 'savings', balances: [{ currency: cur[i % 4], amount: rnd(1e3, 1e5) }] });
    for (let i = 0; i < 60; i++) state.stocks.push({ id: 's' + i, symbol: 'T' + i, platform: 'P' + (i % 10), quantity: rnd(1, 500), avgCost: rnd(5, 500), manualPrice: rnd(5, 600), source: 'manual', currency: 'USD' });
    for (let i = 0; i < 80; i++) state.cashflows.push({ id: 'f' + i, name: 'Bill ' + i, kind: 'expense', category: 'C' + (i % 12), amount: rnd(50, 5000), currency: 'HKD', frequency: 'monthly', nextDate: day(i % 28), active: true });
    for (let i = 0; i < 1500; i++) state.trades.push({ id: 'tr' + i, date: day(-i), side: 'buy', section: 'stocks', holdingId: 's' + (i % 60), symbol: 'T' + (i % 60), platform: 'P1', quantity: 1, price: 10, currency: 'USD', total: 10, _mt: i });
    for (let i = 0; i < 3000; i++) state.activity.push({ id: 'pay-' + i, date: day(-i * 0.6), kind: 'payment', name: 'Bill', outcome: 'applied', applied: true, amount: -100, currency: 'HKD', accountId: 'a1', accountName: 'A', _mt: i });
    const tmpl = state.history[state.history.length - 1];
    const ids = [...state.accounts, ...state.stocks].map((x) => x.id);
    state.history = Array.from({ length: 1825 }, (_, k) => ({ ...tmpl, demo: undefined, raise: undefined, breakdown: undefined, date: day(k - 1825), items: Object.fromEntries(ids.map((id) => [id, rnd(100, 1e5)])), t: k }));
    commit(); // trims old item values
    return Math.round(JSON.stringify(state).length / 1024);
  });
  assert.ok(kb < 2600, `data is ${kb} KB — should stay well under 5 MB`);
  for (const v of ['dashboard', 'accounts', 'stocks', 'history/stocks', 'cashflows', 'goals', 'reports', 'health']) {
    await go(`#${v}`);
    const ms = await page.evaluate(() => { const a = performance.now(); render(); return performance.now() - a; });
    assert.ok(ms < 1500, `${v} took ${Math.round(ms)} ms`);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('Undo right after selling everything brings the holding, cash and trade back', { skip: skip() }, async () => {
  const { page, ctx, errors, go } = await demo();
  await go('#stocks');
  const before = await page.evaluate(() => ({ n: state.stocks.length, trades: state.trades.length, qty: state.stocks.find((h) => h.symbol === 'VUSA.L').quantity }));
  const id = await page.evaluate(() => state.stocks.find((h) => h.symbol === 'VUSA.L').id);
  await page.evaluate((x) => openTrade('stocks', x, 'sell'), id);
  await page.click('dialog button[type=submit]');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => state.stocks.some((h) => h.symbol === 'VUSA.L')), false, 'removed by the sale');
  assert.match(await page.textContent('#toasts'), /holding removed/);
  await page.click('#toasts .toast-undo button');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ n: state.stocks.length, trades: state.trades.length, qty: (state.stocks.find((h) => h.symbol === 'VUSA.L') || {}).quantity }));
  assert.deepEqual(after, before);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the check-in asks for earlier months without a card statement and saves them as paid', { skip: skip() }, async () => {
  const { page, ctx, errors } = await demo();
  const card = await page.evaluate(() => {
    // Remove a middle statement so that month is missing.
    const c = state.cards[0];
    const mine = state.spending.filter((e) => e.cardId === c.id).sort((a, b) => (a.month < b.month ? -1 : 1));
    state.spending = state.spending.filter((e) => e !== mine[mine.length - 2]);
    commit();
    return { id: c.id, month: mine[mine.length - 2].month };
  });
  await page.evaluate(() => openCheckin());
  const input = `dialog input[data-card="${card.id}"][data-month="${card.month}"]`;
  assert.ok(await page.isVisible(input), 'missing month asked for');
  await page.fill(input, '1234');
  await page.click('[data-ci=save]');
  await page.waitForTimeout(300);
  const saved = await page.evaluate((c) => state.spending.find((e) => e.cardId === c.id && e.month === c.month), card);
  assert.ok(saved && saved.amount === 1234 && saved.paidOn, 'saved, as already paid');
  assert.equal(await page.evaluate((c) => Calc.unpaidCardBills(state).some((e) => e.cardId === c.id && e.month === c.month), card), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});
