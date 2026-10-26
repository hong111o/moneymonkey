/*
 * MoneyMonkey — encrypted cross-device sync via a secret GitHub Gist.
 *
 * Data is encrypted in the browser (PBKDF2-SHA256 -> AES-256-GCM) with a passphrase that
 * never leaves the device, so GitHub only ever stores ciphertext.
 *
 * Devices merge item by item: every user edit stamps the item with `_mt` (modified time),
 * deletions leave a tombstone in `deleted`, and the newer side wins per item. Volatile data
 * (live prices, FX, today's net-worth snapshot) is not synced, so pushes only happen when
 * something you entered actually changed.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Sync = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SECTIONS = ['accounts', 'stocks', 'crypto', 'deposits', 'properties', 'others', 'liabilities', 'cashflows', 'spending', 'goals', 'activity'];
  const VOLATILE_ITEM_KEYS = ['lastPrice', 'prevClose'];
  const LOCAL_ONLY_SETTINGS = ['privacy', 'theme'];
  const GIST_DESCRIPTION = 'MoneyMonkey encrypted sync';
  const GIST_FILE = 'moneymonkey.json';
  const KDF_ITERATIONS = 310000;

  // ---------- canonical JSON (stable key order) for change detection ----------

  function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v ?? null);
  }

  // ---------- state <-> syncable document ----------

  function toSyncable(state, todayISO) {
    const doc = { app: 'moneymonkey', v: 1 };
    const settings = { ...state.settings };
    for (const k of LOCAL_ONLY_SETTINGS) delete settings[k];
    doc.settings = settings;
    doc.settingsMt = state.settingsMt || 0;
    for (const s of SECTIONS) {
      doc[s] = (state[s] || []).map((item) => {
        const copy = { ...item };
        for (const k of VOLATILE_ITEM_KEYS) delete copy[k];
        return copy;
      });
    }
    doc.deleted = { ...(state.deleted || {}) };
    doc.platformMeta = { ...(state.platformMeta || {}) };
    // Today's snapshot keeps changing with live prices; only finished days are synced.
    doc.history = (state.history || []).filter((h) => h.date < todayISO);
    return doc;
  }

  function mergeSection(localItems, remoteItems, deleted) {
    const localById = new Map(localItems.map((x) => [x.id, x]));
    const remoteIds = new Set(remoteItems.map((x) => x.id));
    const alive = (x) => !(deleted[x.id] && deleted[x.id] >= (x._mt || 0));
    // Remote order first so devices converge on one order (otherwise they'd re-push forever).
    const out = remoteItems.map((r) => {
      const l = localById.get(r.id);
      return l && (l._mt || 0) > (r._mt || 0) ? l : r;
    });
    for (const l of localItems) if (!remoteIds.has(l.id)) out.push(l);
    return out.filter(alive);
  }

  function mergeSyncable(local, remote) {
    const deleted = { ...remote.deleted };
    for (const [id, t] of Object.entries(local.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);

    const merged = { app: 'moneymonkey', v: 1, deleted };
    const localSettingsNewer = (local.settingsMt || 0) > (remote.settingsMt || 0);
    merged.settings = localSettingsNewer ? local.settings : remote.settings;
    merged.settingsMt = Math.max(local.settingsMt || 0, remote.settingsMt || 0);

    for (const s of SECTIONS) merged[s] = mergeSection(local[s] || [], remote[s] || [], deleted);

    merged.platformMeta = { ...(remote.platformMeta || {}) };
    for (const [name, meta] of Object.entries(local.platformMeta || {})) {
      const r = merged.platformMeta[name];
      if (!r || (meta._mt || 0) > (r._mt || 0)) merged.platformMeta[name] = meta;
    }

    const byDate = new Map();
    for (const h of [...(remote.history || []), ...(local.history || [])]) {
      const prev = byDate.get(h.date);
      if (!prev || (h.t || 0) > (prev.t || 0)) byDate.set(h.date, h);
    }
    merged.history = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    return merged;
  }

  // Writes a synced document back into local state, keeping this device's live prices,
  // FX rates, today's snapshot and device-only settings.
  function applySyncable(state, doc, todayISO) {
    const next = { ...state };
    next.settings = { ...doc.settings };
    for (const k of LOCAL_ONLY_SETTINGS) next.settings[k] = state.settings[k];
    next.settingsMt = doc.settingsMt || 0;
    for (const s of SECTIONS) {
      const localById = new Map((state[s] || []).map((x) => [x.id, x]));
      next[s] = (doc[s] || []).map((item) => {
        const l = localById.get(item.id);
        const copy = { ...item };
        if (l) for (const k of VOLATILE_ITEM_KEYS) if (l[k] != null && sameInstrument(l, item)) copy[k] = l[k];
        return copy;
      });
    }
    next.deleted = { ...(doc.deleted || {}) };
    next.platformMeta = { ...(doc.platformMeta || {}) };
    next.history = [...(doc.history || []).filter((h) => h.date < todayISO), ...(state.history || []).filter((h) => h.date >= todayISO)];
    return next;
  }

  const sameInstrument = (a, b) => a.symbol === b.symbol && a.coinId === b.coinId && a.currency === b.currency && a.source === b.source;

  // ---------- encryption ----------

  const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;

  function toB64(bytes) {
    let s = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  const keyCache = new Map();
  async function deriveKey(passphrase, saltB64, iterations) {
    const cacheKey = `${saltB64}|${iterations}|${passphrase}`;
    if (keyCache.has(cacheKey)) return keyCache.get(cacheKey);
    if (!subtle()) throw new Error('Encryption is not available in this browser (needs HTTPS or localhost).');
    const base = await subtle().importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key = await subtle().deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    keyCache.clear(); // keep at most one derived key in memory
    keyCache.set(cacheKey, key);
    return key;
  }

  async function encrypt(doc, passphrase, saltB64) {
    const salt = saltB64 || toB64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
    const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(doc)));
    return { app: 'moneymonkey', v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, salt }, iv: toB64(iv), data: toB64(data), updatedAt: new Date().toISOString() };
  }

  async function decrypt(envelope, passphrase) {
    if (!envelope || envelope.app !== 'moneymonkey' || !envelope.kdf) throw new Error('The synced file is not MoneyMonkey data.');
    const key = await deriveKey(passphrase, envelope.kdf.salt, envelope.kdf.iterations);
    let plain;
    try {
      plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(envelope.iv) }, key, fromB64(envelope.data));
    } catch (e) {
      const err = new Error('Wrong passphrase — could not decrypt the synced data.');
      err.code = 'BAD_PASSPHRASE';
      throw err;
    }
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ---------- GitHub Gist API ----------

  async function gh(token, path, opts = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...opts,
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (res.status === 401) throw new Error('GitHub rejected the token (expired or wrong?).');
    if (res.status === 403 || res.status === 404) {
      const err = new Error(res.status === 404 ? 'Gist not found.' : 'GitHub refused access — the token needs the “gist” permission.');
      err.status = res.status;
      throw err;
    }
    if (!res.ok) throw new Error(`GitHub error ${res.status}`);
    return res.json();
  }

  async function findGist(token) {
    for (let page = 1; page <= 10; page++) {
      const list = await gh(token, `/gists?per_page=100&page=${page}`);
      const hit = list.find((g) => g.description === GIST_DESCRIPTION && g.files && g.files[GIST_FILE]);
      if (hit) return getGist(token, hit.id);
      if (list.length < 100) return null;
    }
    return null;
  }

  const getGist = (token, id) => gh(token, `/gists/${encodeURIComponent(id)}`);

  async function readEnvelope(gist) {
    const f = gist.files && gist.files[GIST_FILE];
    if (!f) return null;
    if (f.truncated && f.raw_url) {
      const res = await fetch(f.raw_url, { cache: 'no-store' });
      return res.json();
    }
    return JSON.parse(f.content);
  }

  const createGist = (token, envelope) =>
    gh(token, '/gists', { method: 'POST', body: JSON.stringify({ description: GIST_DESCRIPTION, public: false, files: { [GIST_FILE]: { content: JSON.stringify(envelope) } } }) });

  const updateGist = (token, id, envelope) =>
    gh(token, `/gists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(envelope) } } }) });

  return {
    SECTIONS, canonical,
    toSyncable, mergeSyncable, applySyncable,
    encrypt, decrypt,
    findGist, getGist, readEnvelope, createGist, updateGist,
  };
});
