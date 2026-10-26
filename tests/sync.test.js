'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/sync.js');

const state = (over = {}) => ({
  settings: { baseCurrency: 'HKD', privacy: false, theme: 'auto', finnhubKey: 'k' },
  settingsMt: 1,
  accounts: [], stocks: [], crypto: [], deposits: [], properties: [], others: [], liabilities: [], cashflows: [], spending: [], goals: [], activity: [],
  deleted: {}, platformMeta: {}, history: [],
  fx: { base: 'HKD', rates: { HKD: 1 } },
  ...over,
});

test('toSyncable strips live prices, device settings and today’s snapshot', () => {
  const doc = S.toSyncable(state({
    stocks: [{ id: 's', symbol: 'AAPL', lastPrice: 200, prevClose: 199, _mt: 1 }],
    history: [{ date: '2026-01-01', netWorth: 1 }, { date: '2026-01-02', netWorth: 2 }],
  }), '2026-01-02');
  assert.equal(doc.stocks[0].lastPrice, undefined);
  assert.equal(doc.settings.privacy, undefined);
  assert.equal(doc.settings.finnhubKey, 'k');
  assert.deepEqual(doc.history.map((h) => h.date), ['2026-01-01']);
  assert.equal(doc.fx, undefined);
});

test('merge keeps the newest version of each item and honours deletions', () => {
  const local = S.toSyncable(state({
    accounts: [{ id: 'a', balance: 100, _mt: 5 }, { id: 'b', balance: 1, _mt: 1 }, { id: 'new-local', _mt: 9 }],
    deleted: { c: 10 },
  }), '2026-01-02');
  const remote = S.toSyncable(state({
    accounts: [{ id: 'b', balance: 2, _mt: 3 }, { id: 'a', balance: 50, _mt: 4 }, { id: 'c', _mt: 2 }, { id: 'new-remote', _mt: 1 }],
    settings: { baseCurrency: 'GBP' },
    settingsMt: 7,
  }), '2026-01-02');
  const m = S.mergeSyncable(local, remote);
  assert.deepEqual(m.accounts.map((a) => [a.id, a.balance]), [['b', 2], ['a', 100], ['new-remote', undefined], ['new-local', undefined]]);
  assert.equal(m.settings.baseCurrency, 'GBP');
  assert.equal(m.deleted.c, 10);
  // A merge of the result with the same remote is stable (no ping-pong pushes).
  assert.equal(S.canonical(S.mergeSyncable(m, m)), S.canonical(m));
});

test('an edit made after a deletion brings the item back', () => {
  const m = S.mergeSyncable(S.toSyncable(state({ deleted: { x: 5 } }), 't'), S.toSyncable(state({ goals: [{ id: 'x', _mt: 8 }] }), 't'));
  assert.equal(m.goals.length, 1);
});

test('applySyncable keeps this device’s prices, theme and today’s snapshot', () => {
  const local = state({
    settings: { baseCurrency: 'HKD', privacy: true, theme: 'dark' },
    stocks: [{ id: 's', symbol: 'AAPL', currency: 'USD', source: 'live', lastPrice: 200, _mt: 1 }],
    history: [{ date: '2026-01-02', netWorth: 9 }],
  });
  const doc = S.toSyncable(state({ stocks: [{ id: 's', symbol: 'AAPL', currency: 'USD', source: 'live', quantity: 5, _mt: 2 }], history: [{ date: '2026-01-01', netWorth: 1 }] }), '2026-01-02');
  const next = S.applySyncable(local, doc, '2026-01-02');
  assert.equal(next.stocks[0].quantity, 5);
  assert.equal(next.stocks[0].lastPrice, 200);
  assert.equal(next.settings.privacy, true);
  assert.equal(next.settings.theme, 'dark');
  assert.deepEqual(next.history.map((h) => h.date), ['2026-01-01', '2026-01-02']);
});

test('encrypt / decrypt round trip, wrong passphrase rejected', async () => {
  const doc = { hello: 'world', n: [1, 2, 3] };
  const env = await S.encrypt(doc, 'correct horse battery');
  assert.ok(!JSON.stringify(env).includes('world'));
  assert.deepEqual(await S.decrypt(env, 'correct horse battery'), doc);
  await assert.rejects(S.decrypt(env, 'wrong'), (e) => e.code === 'BAD_PASSPHRASE');
  const env2 = await S.encrypt(doc, 'correct horse battery', env.kdf.salt);
  assert.equal(env2.kdf.salt, env.kdf.salt);
  assert.notEqual(env2.iv, env.iv);
});
