// MoneyMonkey exchange-rate alerts: reads your alert settings from your sync Gist (the small
// unencrypted moneymonkey-alerts.json file), checks live rates, and sends a notification through
// ntfy when a rate crosses your target. Remembers what it last saw in fx-alerts-state.json, so you
// get one notification per crossing, not one every 30 minutes.
import { readFile, writeFile } from 'node:fs/promises';

// A Gist ID is 20–32 letters a–f and digits; this also copes with a pasted link, quotes or spaces.
const RAW_GIST = (process.env.ALERTS_GIST || '').trim();
const GIST = ((RAW_GIST.match(/[0-9a-f]{20,32}(?![0-9a-z])/gi) || []).pop() || RAW_GIST.replace(/^.*\//, '')).toLowerCase();
const TOPIC = (process.env.NTFY_TOPIC || '').trim();
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

// Your alert settings: from the Gist through GitHub's API, or its raw file address.
async function readAlerts() {
  try {
    const g = await getJson(`https://api.github.com/gists/${GIST}`);
    const f = g.files && g.files['moneymonkey-alerts.json'];
    if (f) return JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);
    return null;
  } catch (e) {
    console.log(`Gist API: ${e.message}`);
  }
  try { return await getJson(`https://gist.githubusercontent.com/${OWNER}/${GIST}/raw/moneymonkey-alerts.json?t=${Date.now()}`); } catch (e) { console.log(`Raw file: ${e.message}`); return null; }
}
if (GIST) console.log(`ALERTS_GIST: ${/^[0-9a-f]{20,32}$/.test(GIST) ? `a Gist ID ending in …${GIST.slice(-4)}` : `doesn’t look like a Gist ID (${RAW_GIST.length} characters) — it should be 32 letters a–f and digits`}.`);
const settings = await readAlerts();
if (!settings) {
  console.log('No alerts in that Gist yet. In MoneyMonkey → Settings → Exchange-rate alerts: tap + Add alert, then Sync now (the file appears once you have an alert), then run this again. If it still fails, check the ALERTS_GIST secret: its ending (above) should match the Gist ID shown in MoneyMonkey → Settings → Exchange-rate alerts. To fix it, open the secret on GitHub, tap Update, paste the ID again and save.');
  await writeFile(STATE, await readFile(STATE, 'utf8').catch(() => '{}')); // keep what the last check saw
  process.exit(0);
}
const { alerts = [] } = settings;
console.log(`Read ${alerts.length} alert(s) from your Gist.`);
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
