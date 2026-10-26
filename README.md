# 🐒 MoneyMonkey

A personal net-worth tracker that updates live, built for your phone and synced across your devices. Put everything you own and owe in one place, across every bank, broker and country you use, and see your total wealth move in real time.

No server and no dependencies. Your data is stored on your devices and, if you turn on sync, encrypted in your own GitHub account.

## What it tracks

| Section | What you enter | What updates automatically |
|---|---|---|
| **Cash & Bank** | Accounts, e-wallets, cash. **Each account can hold several currencies** (e.g. HKD + USD + GBP in one HSBC One account) | Each balance converted with live FX rates; **Cash by currency** chart shows each currency's total and which accounts hold it |
| **Stocks & ETFs** | Ticker, shares, average cost | Live price, today's change, profit/loss (Finnhub) |
| **Crypto** | CoinGecko coin id, quantity, average cost | Live price, 24h change, profit/loss (CoinGecko) |
| **Fixed Deposits** | Bank, amount, start date, term in **months or an end date**, and either the **rate** or the **total interest** quoted | Interest accrued daily, "from → to · N months · X days left", maturity value. **On maturity, capital + interest move into a cash account automatically** (or the deposit renews, your choice) |
| **Property** | Purchase price and date, then a new valuation weekly or monthly | Gain since purchase, valuation history, reminder when an update is due |
| **Other Assets** | Car, gold, MPF / pension, insurance cash value… plus an optional yearly % change | Value drifts automatically (e.g. −15%/yr for a car) |
| **Loans & Debts** | Mortgage, car loan, credit card. Enter the balance yourself, or the loan terms | Balance falls each month on its repayment schedule, with a debt-free date |
| **Cash Flow** | Income, bills, subscriptions and regular saving, weekly to yearly | Monthly/yearly totals, savings rate, upcoming payments |
| **Actual spending** | What you really spent each month, e.g. each **credit card statement** | Cash flow, savings rate and runway use your real 3-month average instead of estimates |
| **Goals** | Target amount and optional date | Progress, and whether you're on track |

### Bank accounts hold cash and fixed deposits

Tap an account in **Cash & Bank** to open its overview: its total, its cash in every currency (tap to update the balances), and the **fixed deposits held in it**. Add a deposit there with **+ Add fixed deposit**. Every fixed deposit belongs to a bank account. When it matures, capital and interest go back into that account (or another account you pick), in the deposit's currency. Fixed deposits still count as their own category on the dashboard, and **Cash & Bank → Fixed deposits → see all** lists every deposit across your accounts.

### Multi-currency accounts

Add one line per currency inside an account (**+ Add currency** in the form). The account card shows each balance plus the converted total. On the Cash & Bank page, **Cash by currency** shows every currency's total across all accounts as a bar split by account. Tap a currency, or use the currency filter, to list only the accounts holding it. When a fixed deposit matures, the money is added to the matching currency in the payout account. If that account doesn't hold the currency yet, a new balance line is created, with no conversion. Older single-currency accounts are converted automatically.

### Platforms & regions

Every asset and loan has a **Platform** (HSBC HK, ZA Bank, Futu, Monzo, Trading 212, Nationwide…). The **Platforms** page shows cash, investments, deposits and debts per platform. Tap a platform to open its own page, with totals and every account, deposit, holding and loan on it, each tappable to edit. Add new items to that platform from there, or rename it and set its region. You can give each platform a **region** (e.g. Hong Kong, United Kingdom) to see totals by country. Regions are guessed from currency until you set them. You can also filter any list by platform, or rename a platform everywhere at once.

### Credit-card spending without double counting

If most of your spending goes on a credit card, record each month's statement total under **Cash Flow → Actual monthly spending** (or the **+** button). Tick **"Paid by credit card"** on fixed bills and subscriptions that are charged to the card. Your monthly spending is then:

> average of your last 3 recorded months + fixed bills **not** paid by card

so things like Netflix on the card aren't counted twice. When last month's spending hasn't been recorded yet, the dashboard reminds you.

### Dashboard

- Net worth, total assets and liabilities in your base currency
- **Interest earned today**, ticking every second
- Investment P&L, today's market move, net cash flow, savings rate, passive income, emergency runway, subscriptions
- Allocation donut, **by region & platform** breakdown, net-worth history chart (one snapshot per day)
- The next 30 days: bills, pay days, deposit maturities, property updates due
- Alerts: matured deposits that were moved to cash, stale property values, spending to record

## Use it on your phone (and every other device)

### 1. Host it (free) with GitHub Pages

Repo → **Settings → Pages** → *Deploy from a branch* → pick the branch and `/ (root)` → Save. After a minute it's live at `https://<your-username>.github.io/moneymonkey/`.

> GitHub Pages needs a **public** repo on a free plan. That's fine: the repo only contains the app's code, never your financial data.

### 2. Install it like an app

- **iPhone:** open the link in Safari → Share → **Add to Home Screen**
- **Android:** open it in Chrome → menu → **Install app**

It opens full-screen with a bottom tab bar and works offline.

### 3. Turn on sync

In **Settings & Sync → Set up sync**:

1. [Create a GitHub token](https://github.com/settings/tokens/new?scopes=gist&description=MoneyMonkey%20sync) with only the **gist** box ticked (it's pre-selected).
2. Paste it and choose a passphrase.
3. Do the same on your other devices with the **same passphrase**. Your data appears automatically.

How it works:
- Your data is **encrypted on the device** (AES-256-GCM, key derived from your passphrase with PBKDF2-SHA256, 310,000 rounds) and stored in a **secret gist** in your GitHub account. GitHub only ever sees scrambled text, and the passphrase never leaves your devices.
- Sync runs when you change something, when you open the app, and every 2 minutes. Each device keeps a full copy, so it works offline and catches up later.
- Edits are merged item by item. If you change your HSBC balance on your phone and add a stock on your laptop, both changes are kept. If the same item is edited on two devices, the later edit wins.
- **If you forget the passphrase, nobody (including GitHub) can decrypt the synced copy.** Your devices still have their own copies, so export a backup now and then.
- The token and passphrase are stored only on the device (you can choose not to remember the passphrase). They are never included in backups or in the gist.

## Live prices

- **Stocks:** paste a free [Finnhub API key](https://finnhub.io/register) in Settings (it syncs to your other devices). The free plan mainly covers US listings. For tickers it doesn't cover (e.g. many `.HK` or `.L` listings), set **Price source → Manual price** and update the price yourself.
- **Crypto:** CoinGecko ids, such as `bitcoin` or `ethereum`. No key needed.
- **Exchange rates:** open.er-api.com, with frankfurter.app as a fallback. No key needed.

Prices refresh every 60 seconds by default and whenever you return to the app.

## How the numbers are calculated

- **Fixed deposits:** simple interest `P × r × days/365`, or compound `P × (1 + r/n)^(n × years)`, accrued daily and capped at maturity. If you enter the total interest instead of a rate, the matching annual rate is solved for. At maturity, "move to cash" adds the maturity value to the chosen account (converting currency if needed), or to an automatic "‹bank› cash" account. "Renew" starts a new deposit with the matured amount on the same term and rate.
- **Amortizing loans:** standard annuity balance after *k* monthly payments, `B = P(1+i)^k − PMT((1+i)^k − 1)/i`.
- **Cash flow:** weekly × 52/12, every-2-weeks × 26/12, quarterly ÷ 3, yearly ÷ 12.
- **Spending:** recorded monthly spending (3 most recent months averaged) + fixed bills not paid by card. Without any records, the estimate from your bills is used.
- **Savings rate:** (income − spending) ÷ income.

## Development

```
npm test        # unit tests: money math, deposits, platforms, spending, sync merge & encryption
npm start       # serve on http://localhost:8080
```

| File | Purpose |
|---|---|
| `index.html` | App shell |
| `css/styles.css` | Styles: light/dark tokens, phone layout |
| `js/calc.js` | Pure calculations (unit-tested) |
| `js/sync.js` | Encryption, item-level merge, GitHub Gist API |
| `js/prices.js` | FX, stock and crypto price fetching |
| `js/charts.js` | Dependency-free SVG charts |
| `js/app.js` | UI, state, forms, live updates, sync loop |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app + offline support |
| `tests/` | Tests |
