// MoneyMonkey exchange-rate alerts: reads your alert settings from your sync Gist (the small
// unencrypted moneymonkey-alerts.json file), checks live rates, and sends a notification through
// ntfy when a rate crosses your target. Remembers what it last saw in fx-alerts-state.json, so you
// get one notification per crossing, not one every 30 minutes.
import { readFile, writeFile } from 'node:fs/promises';

const GIST = process.env.ALERTS_GIST;
const TOPIC = process.env.NTFY_TOPIC;
const OWNER = process.env.GITHUB_REPOSITORY_OWNER;
const STATE = 'fx-alerts-state.json';

if (!GIST || !TOPIC) {
  console.log('Not set up yet: add the NTFY_TOPIC and ALERTS_GIST secrets (MoneyMonkey → Settings → Exchange-rate alerts).');
  await writeFile(STATE, '{}');
  process.exit(0);
}

const getJson = async (url) => {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`${url.replace(GIST, '…')} → ${res.status}`);
  return res.json();
};

const { alerts = [] } = await getJson(`https://gist.githubusercontent.com/${OWNER}/${GIST}/raw/moneymonkey-alerts.json?t=${Date.now()}`);
let seen = {};
try { seen = JSON.parse(await readFile(STATE, 'utf8')); } catch { /* first run */ }
const rates = {};
const next = {};
for (const a of alerts) {
  if (!a || !a.from || !a.to || !(a.rate > 0)) continue;
  rates[a.from] = rates[a.from] || (await getJson(`https://open.er-api.com/v6/latest/${a.from}`)).rates;
  const now = rates[a.from][a.to];
  if (!now) { console.log(`No rate for ${a.from}→${a.to}`); continue; }
  const met = a.op === 'below' ? now <= a.rate : now >= a.rate;
  console.log(`${a.from}→${a.to} ${now} (${a.op} ${a.rate}): ${met ? 'met' : 'not met'}`);
  if (met && !seen[a.id]) {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(TOPIC)}`, {
      method: 'POST',
      body: `1 ${a.from} = ${now.toFixed(4)} ${a.to} — ${a.op === 'below' ? 'at or below' : 'at or above'} your ${a.rate} target.`,
      headers: { Title: `MoneyMonkey: ${a.from}→${a.to} alert`, Tags: 'chart_with_upwards_trend', Click: `https://${OWNER}.github.io/${(process.env.GITHUB_REPOSITORY || '').split('/')[1] || ''}/#alerts` },
    });
    console.log(`Notification sent: ${res.status}`);
  }
  next[a.id] = met;
}
await writeFile(STATE, JSON.stringify(next));
