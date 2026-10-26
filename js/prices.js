/*
 * MoneyMonkey — live market data.
 *  - Exchange rates: open.er-api.com (free, no key), fallback frankfurter.app
 *  - Stocks/ETFs:    Finnhub (free API key from finnhub.io)
 *  - Crypto:         CoinGecko public API (no key)
 */
(function (root) {
  'use strict';

  async function getJSON(url, timeoutMs = 12000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchFx(base) {
    try {
      const data = await getJSON(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`);
      if (data.result === 'success' && data.rates) return { base, rates: data.rates, updatedAt: new Date().toISOString() };
      throw new Error(data['error-type'] || 'bad response');
    } catch (err) {
      const data = await getJSON(`https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`);
      return { base, rates: { ...data.rates, [base]: 1 }, updatedAt: new Date().toISOString() };
    }
  }

  // Returns { price, prevClose, change, changePct, time } or throws.
  async function fetchStockQuote(symbol, apiKey) {
    if (!apiKey) throw new Error('No Finnhub API key set (Settings)');
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
    const q = await getJSON(url);
    if (!q || !q.c) throw new Error(`No quote for ${symbol}`);
    return { price: q.c, prevClose: q.pc, change: q.d, changePct: q.dp, time: q.t ? new Date(q.t * 1000).toISOString() : null };
  }

  // ids: CoinGecko coin ids (e.g. "bitcoin"); currencies: ISO codes.
  // Returns { [id]: { [cur]: { price, changePct } } }
  async function fetchCrypto(ids, currencies) {
    if (!ids.length) return {};
    const vs = [...new Set(currencies.map((c) => c.toLowerCase()))].join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true`;
    const data = await getJSON(url);
    const out = {};
    for (const id of Object.keys(data)) {
      out[id] = {};
      for (const cur of currencies) {
        const c = cur.toLowerCase();
        if (data[id][c] != null) out[id][cur] = { price: data[id][c], changePct: data[id][`${c}_24h_change`] };
      }
    }
    return out;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  root.Prices = { fetchFx, fetchStockQuote, fetchCrypto, sleep };
})(typeof self !== 'undefined' ? self : this);
